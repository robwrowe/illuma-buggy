/**
 * WandSimulator — ESP32 BLE broadcaster for Disney park packet testing.
 *
 * Targets:
 *   - IllumaBuggy StrollerController (receiver / scanner)
 *   - Physical MagicBand+ bands (listen for 0x8301 manufacturer data)
 *   - Starlight wand pairing experiments
 *
 * Protocol: Adafruit CLUE_BLE_Beacon_Remote / magicband_protocol.py
 * Flash any ESP32 DevKit, NimBLE 2.x, USB Serial @ 115200.
 *
 * Keep the board ~0.5–2 m from bands / stroller controller.
 */

#include <NimBLEDevice.h>

static const uint8_t WAND_CAST_SIG[6] = {0xCF, 0x0B, 0x00, 0xC4, 0x20, 0x22};
static const uint8_t IDLE_PAYLOAD[19] = {
  0x0F, 0x11, 0x01, 0x4B, 0x72, 0x99, 0x08, 0x83, 0x0A, 0x66,
  0xD4, 0x85, 0xCD, 0x9F, 0x95, 0x75, 0xA8, 0xA3, 0x21
};

NimBLEAdvertising* adv = nullptr;

enum LoopMode { LOOP_NONE, LOOP_WAND_CAST, LOOP_MB_SWEEP, LOOP_MB_PALETTE, LOOP_SW_FX };
LoopMode loopMode = LOOP_NONE;
uint8_t loopPalette = 4;
uint8_t mbSweepIdx = 0;
uint8_t swFxLoopIdx = 0;
unsigned long loopNextMs = 0;

// Named park/show payloads (Adafruit command_library.py — wands hear E9 commands too)
struct HexPreset {
  const char* name;
  const char* desc;
  const uint8_t* data;
  size_t len;
  bool pingFirst;
};

static const uint8_t PRESET_RAINBOW[] = {
  0xE1,0x00,0xE9,0x0C,0x00,0x0F,0x0F,0x5D,0x46,0x5B,0xF0,0x05,0x32,0x37,0x48,0xB0
};
static const uint8_t PRESET_BLINK[] = {
  0xE1,0x00,0xE9,0x0C,0x00,0x0F,0x0F,0x5D,0x46,0x5B,0xF0,0x05,0x32,0x37,0x48,0x95
};
static const uint8_t PRESET_PALETTE5[] = {
  0xE1,0x00,0xE9,0x0C,0x00,0x0F,0x0F,0xB1,0xB9,0xB5,0xB1,0xA2,0x30,0x7B,0x7D,0xB0
};
static const uint8_t PRESET_FLASH[] = {
  0xE1,0x00,0xE9,0x0E,0x00,0x01,0x0F,0xBD,0xA0,0xA0,0xBD,0xA0,0x59,0x07,0x00,0x48,0xAE,0xB5
};
static const uint8_t PRESET_SPARKLE[] = {
  0xE1,0x00,0xE9,0x10,0x00,0x13,0x48,0x97,0xD0,0x0E,0xA0,0xD1,0x46,0x06,0x0F,0x30,0xD0,0x4E,0x07,0xB0
};
static const uint8_t PRESET_PULSE[] = {
  0xE1,0x00,0xE9,0x13,0x00,0x02,0xD0,0x37,0xF0,0xD2,0x3D,0x05,0x05,0x00,0x0E,0xFA,0x89,0x83,0x51,0x0E,0xE7,0xA0,0xB0
};
static const uint8_t PRESET_CIRCLE[] = {
  0xE2,0x00,0xE9,0x12,0x00,0x03,0x0F,0xA2,0xA2,0xA4,0xA4,0xA2,0x30,0xD0,0x37,0xF4,0xD2,0x46,0x00,0x64,0xFC,0xB8
};
static const uint8_t PRESET_FADE[] = {
  0xE1,0x00,0xE9,0x11,0x00,0x6F,0x0F,0x56,0x48,0x58,0xF4,0x48,0x82,0xD1,0x46,0x02,0x08,0xD0,0x65,0x00,0xB0
};
static const uint8_t PRESET_FADE2[] = {
  0xE1,0x00,0xE9,0x11,0x00,0x0F,0x0F,0x48,0x59,0x58,0xF4,0x48,0x82,0xD1,0x46,0x02,0x0D,0xD0,0x65,0x05,0xB0
};

static const HexPreset SW_FX_PRESETS[] = {
  { "rainbow",  "E90C Taste the Rainbow",      PRESET_RAINBOW,  sizeof(PRESET_RAINBOW),  false },
  { "blink",    "E90C white blink",            PRESET_BLINK,    sizeof(PRESET_BLINK),    false },
  { "palette5", "E90C five-palette cycle",     PRESET_PALETTE5, sizeof(PRESET_PALETTE5), false },
  { "flash",    "E90E purple/white flash",     PRESET_FLASH,    sizeof(PRESET_FLASH),    false },
  { "sparkle",  "E910 blue sparkle",           PRESET_SPARKLE,  sizeof(PRESET_SPARKLE),  true  },
  { "pulse",    "E913 purple pulse",           PRESET_PULSE,    sizeof(PRESET_PULSE),    false },
  { "circle",   "E912 blue circle + vibe",     PRESET_CIRCLE,   sizeof(PRESET_CIRCLE),   true  },
  { "fade",     "E911 cyan to pink",           PRESET_FADE,     sizeof(PRESET_FADE),     true  },
  { "fade2",    "E911 pink to green",          PRESET_FADE2,    sizeof(PRESET_FADE2),    false },
};
static const size_t SW_FX_PRESET_COUNT = sizeof(SW_FX_PRESETS) / sizeof(SW_FX_PRESETS[0]);

// ── Adafruit magicband_protocol.py builders ────────────────────────────────

static uint8_t mbVibByte(uint8_t vibration = 0) {
  return (uint8_t)(0xB0 | (vibration & 0x0F));
}

static uint8_t mbColorByte(uint8_t paletteIdx, uint8_t patternNibble) {
  return (uint8_t)((patternNibble << 5) | (paletteIdx & 0x1F));
}

// E905 single palette — mask 0 = all 5 LEDs on band
static size_t buildMbSingle(uint8_t* out, uint8_t paletteIdx, uint8_t mask = 0,
                            uint8_t timing = 0x09, uint8_t vibration = 0) {
  out[0] = 0xE1; out[1] = 0x00; out[2] = 0xE9; out[3] = 0x05;
  out[4] = 0x00; out[5] = timing; out[6] = 0x0E;
  out[7] = (uint8_t)(((mask & 0x07) << 5) | (paletteIdx & 0x1F));
  out[8] = mbVibByte(vibration);
  return 9;
}

// E906 dual palette (inner ring + outer ring)
static size_t buildMbDual(uint8_t* out, uint8_t innerIdx, uint8_t outerIdx,
                          uint8_t timing = 0x22, uint8_t vibration = 0) {
  out[0] = 0xE2; out[1] = 0x00; out[2] = 0xE9; out[3] = 0x06;
  out[4] = 0x00; out[5] = timing; out[6] = 0x0F;
  out[7] = (uint8_t)(0x40 | (innerIdx & 0x1F));
  out[8] = (uint8_t)(0x40 | (outerIdx & 0x1F));
  out[9] = mbVibByte(vibration);
  return 10;
}

// E908 raw 6-bit RGB (each channel 0–63)
static size_t buildMbRgb(uint8_t* out, uint8_t red, uint8_t green, uint8_t blue,
                         uint8_t timing = 0x0E, uint8_t vibration = 0) {
  out[0] = 0xE1; out[1] = 0x00; out[2] = 0xE9; out[3] = 0x08;
  out[4] = 0x00; out[5] = timing; out[6] = 0xD2; out[7] = 0x55;
  out[8] = (uint8_t)((red & 0x3F) << 1);
  out[9] = (uint8_t)((green & 0x3F) << 1);
  out[10] = (uint8_t)((blue & 0x3F) << 1);
  out[11] = mbVibByte(vibration);
  return 12;
}

// E909 five palette slots — TL, BL, BR, TR, center (Adafruit byte order)
// patternNibble: emcot wiki — 3=spin, 4=solid A, 8=4/5 corners, B=all on B
static size_t buildMbFive(uint8_t* out, uint8_t topLeft, uint8_t bottomLeft,
                          uint8_t bottomRight, uint8_t topRight, uint8_t center,
                          uint8_t timing = 0x0E, uint8_t vibration = 0,
                          uint8_t patternNibble = 0x05) {
  out[0] = 0xE1; out[1] = 0x00; out[2] = 0xE9; out[3] = 0x09;
  out[4] = 0x00; out[5] = timing; out[6] = 0x0F;
  out[7] = mbColorByte(topLeft, patternNibble);
  out[8] = mbColorByte(bottomLeft, patternNibble);
  out[9] = mbColorByte(bottomRight, patternNibble);
  out[10] = mbColorByte(topRight, patternNibble);
  out[11] = mbColorByte(center, patternNibble);
  out[12] = mbVibByte(vibration);
  return 13;
}

static size_t buildMbFiveUniform(uint8_t* out, uint8_t paletteIdx, uint8_t patternNibble) {
  paletteIdx &= 0x1F;
  return buildMbFive(out, paletteIdx, paletteIdx, paletteIdx, paletteIdx, paletteIdx,
                     0x0E, 0, patternNibble);
}

// CC03000000 — park "ping" (bands may respond / wake)
static size_t buildPing(uint8_t* out) {
  out[0] = 0xCC; out[1] = 0x03; out[2] = 0x00; out[3] = 0x00; out[4] = 0x00;
  return 5;
}

// ── BLE TX ─────────────────────────────────────────────────────────────────

void mfrHex(const uint8_t* data, size_t len) {
  for (size_t i = 0; i < len; i++) {
    if (data[i] < 0x10) Serial.print('0');
    Serial.print(data[i], HEX);
  }
  Serial.println();
}

void pushAdvert(const uint8_t* mfr, size_t mfrLen) {
  NimBLEAdvertisementData advData;
  advData.setManufacturerData(std::string((char*)mfr, mfrLen));
  adv->stop();
  adv->setAdvertisementData(advData);
  adv->setScanResponseData(advData);
  adv->start();
}

// Re-broadcast every refreshMs so nearby MagicBands catch the packet
void broadcastMfr(const uint8_t* payload, size_t plen,
                  uint32_t durationMs, uint32_t refreshMs = 250) {
  if (plen > 27) {
    Serial.println("[TX] payload too long");
    return;
  }
  uint8_t mfr[29];
  mfr[0] = 0x83;
  mfr[1] = 0x01;
  memcpy(mfr + 2, payload, plen);
  size_t mfrLen = plen + 2;

  Serial.printf("[TX] Broadcasting %ums (%u bytes, refresh %ums): ",
                durationMs, (unsigned)mfrLen, refreshMs);
  mfrHex(mfr, mfrLen);

  unsigned long end = millis() + durationMs;
  while ((long)(millis() - end) < 0) {
    pushAdvert(mfr, mfrLen);
    unsigned long slice = refreshMs;
    while (slice > 0) {
      if (Serial.available()) {
        adv->stop();
        Serial.println("[TX] Interrupted");
        return;
      }
      delay(20);
      if (slice >= 20) slice -= 20; else slice = 0;
    }
  }
  adv->stop();
  Serial.println("[TX] Done");
}

void broadcastPayload(const uint8_t* payload, size_t plen, uint32_t durationMs = 4000) {
  broadcastMfr(payload, plen, durationMs, 200);
}

// ── High-level broadcasts ───────────────────────────────────────────────────

void broadcastWandCast(uint8_t palette) {
  uint8_t payload[13];
  memcpy(payload, WAND_CAST_SIG, 6);
  for (int i = 6; i < 12; i++) payload[i] = (uint8_t)random(0, 256);
  payload[12] = palette & 0x1F;
  broadcastPayload(payload, 13, 3000);
}

void broadcastLegacyCast(uint8_t palette) {
  uint8_t payload[12] = {
    0xCF, 0x9B, 0x00, 0xC4, 0x29, 0x22, 0xEF, 0xD8, 0x19, 0xF2, 0x2A, 0x00
  };
  payload[11] = palette & 0x1F;
  broadcastPayload(payload, 12, 3000);
}

void broadcastMbSingle(uint8_t palette, uint8_t mask = 0) {
  uint8_t payload[16];
  size_t n = buildMbSingle(payload, palette, mask);
  broadcastPayload(payload, n, 4000);
}

void broadcastMbDual(uint8_t inner, uint8_t outer) {
  uint8_t payload[16];
  size_t n = buildMbDual(payload, inner, outer);
  broadcastPayload(payload, n, 4000);
}

void broadcastMbRgb(uint8_t r, uint8_t g, uint8_t b) {
  uint8_t payload[16];
  size_t n = buildMbRgb(payload, r, g, b);
  broadcastPayload(payload, n, 4000);
}

void broadcastMbFive(uint8_t tl, uint8_t bl, uint8_t br, uint8_t tr, uint8_t c) {
  uint8_t payload[16];
  size_t n = buildMbFive(payload, tl, bl, br, tr, c);
  broadcastPayload(payload, n, 4000);
}

void broadcastMbRainbowFive() {
  // Classic park-style five-corner rainbow
  broadcastMbFive(0, 2, 21, 8, 19);  // cyan, blue, red, pink, orange
}

void broadcastPing() {
  uint8_t payload[8];
  size_t n = buildPing(payload);
  Serial.println("[TX] CC03 ping — bands may blink/respond");
  broadcastPayload(payload, n, 5000);
}

void broadcastIdle() {
  broadcastPayload(IDLE_PAYLOAD, sizeof(IDLE_PAYLOAD), 5000);
}

const HexPreset* findSwFx(const String& name) {
  for (size_t i = 0; i < SW_FX_PRESET_COUNT; i++) {
    if (name.equalsIgnoreCase(SW_FX_PRESETS[i].name)) return &SW_FX_PRESETS[i];
  }
  return nullptr;
}

void broadcastHexPreset(const HexPreset& fx) {
  Serial.printf("[SW] %s — %s\n", fx.name, fx.desc);
  if (fx.pingFirst) {
    uint8_t ping[8];
    size_t pn = buildPing(ping);
    broadcastPayload(ping, pn, 800);
  }
  broadcastPayload(fx.data, fx.len, 4000);
}

// Color + pattern (E909) — wands/MB+ treat pattern nibble as LED animation mode
void broadcastSwPattern(uint8_t palette, uint8_t patternNibble) {
  uint8_t payload[16];
  size_t n = buildMbFiveUniform(payload, palette, patternNibble);
  Serial.printf("[SW] pattern=%u palette=%u (E909)\n", patternNibble, palette);
  broadcastPayload(payload, n, 4000);
}

// Wand-to-wand color cast + optional follow-up animation on same color
void broadcastSwCombo(uint8_t palette, const char* fxName) {
  stopLoops();
  broadcastWandCast(palette);
  const HexPreset* fx = findSwFx(String(fxName));
  if (fx) {
    delay(400);
    broadcastHexPreset(*fx);
  } else {
    Serial.printf("[SW] unknown fx '%s' — cast only\n", fxName);
  }
}

void printSwFxList() {
  Serial.println("[SW] Named animation presets (E9 show codes):");
  for (size_t i = 0; i < SW_FX_PRESET_COUNT; i++) {
    Serial.printf("  %-10s %s%s\n", SW_FX_PRESETS[i].name, SW_FX_PRESETS[i].desc,
                  SW_FX_PRESETS[i].pingFirst ? " (+ping)" : "");
  }
  Serial.println("[SW] Pattern modes (E909 color+pattern): solid spin all corners");
}

// ── Serial parsing ──────────────────────────────────────────────────────────

int splitWords(const String& line, String out[], int maxOut) {
  int n = 0;
  int start = 0;
  while (start < (int)line.length() && n < maxOut) {
    while (start < (int)line.length() && line[start] == ' ') start++;
    if (start >= (int)line.length()) break;
    int end = start;
    while (end < (int)line.length() && line[end] != ' ') end++;
    out[n++] = line.substring(start, end);
    start = end + 1;
  }
  return n;
}

uint8_t parsePaletteWord(const String& w) {
  String s = w;
  s.toLowerCase();
  if (s == "cyan") return 0;
  if (s == "purple") return 1;
  if (s == "blue") return 2;
  if (s == "pink") return 8;
  if (s == "yellow") return 15;
  if (s == "lime") return 18;
  if (s == "orange") return 19;
  if (s == "red") return 21;
  if (s == "green") return 25;
  if (s == "white") return 27;
  return (uint8_t)s.toInt();
}

uint8_t parsePatternWord(const String& w) {
  String s = w;
  s.toLowerCase();
  if (s == "solid") return 0x04;
  if (s == "spin") return 0x03;
  if (s == "all") return 0x0B;
  if (s == "corners") return 0x08;
  if (s == "middle") return 0x02;
  return (uint8_t)s.toInt();
}

void stopLoops() {
  loopMode = LOOP_NONE;
}

void printHelp() {
  Serial.println("[WandSim] Commands:");
  Serial.println("  --- Starlight wand ---");
  Serial.println("  cast <color>             CF0B wand-to-wand color cast");
  Serial.println("  legacy <color>           CF9B wiki color cast");
  Serial.println("  idle                     0F11 idle beacon");
  Serial.println("  loop <color>             repeat wand cast every 5s");
  Serial.println("  --- Starlight effects (color + pattern / animation) ---");
  Serial.println("  sw list                  list named animation presets");
  Serial.println("  sw solid <color>         E905 solid (wands hear MB codes)");
  Serial.println("  sw pattern <mode> <color> E909 — mode: solid|spin|all|corners");
  Serial.println("  sw fx <name>             park animation (rainbow|flash|sparkle|…)");
  Serial.println("  sw combo <color> <fx>    CF0B cast then animation");
  Serial.println("  swfxloop                 cycle all sw fx presets every 4s");
  Serial.println("  --- MagicBand+ (Adafruit E9 builders) ---");
  Serial.println("  mb <0-31|name>           E905 single color (all 5 LEDs)");
  Serial.println("  mb <pal> mask <0-7>      E905 with LED mask (1=TR only, etc.)");
  Serial.println("  mb dual <in> <out>       E906 inner + outer ring colors");
  Serial.println("  mb rgb <r> <g> <b>       E908 6-bit RGB (0-63 each)");
  Serial.println("  mb five <tl bl br tr c>  E909 five palette slots");
  Serial.println("  mb rainbow               E909 preset rainbow corners");
  Serial.println("  ping                     CC03000000 wake ping");
  Serial.println("  mbsweep                  cycle palettes 0-31 every 3s (both bands)");
  Serial.println("  mbloop <0-31|name>       repeat single MB color every 3s");
  Serial.println("  stop                     cancel loop / mbsweep / mbloop");
  Serial.println("  help");
  Serial.println("  Names: cyan purple blue pink yellow lime orange red green white");
}

void handleLine(String line) {
  line.trim();
  if (line.length() == 0) return;

  String lower = line;
  lower.toLowerCase();

  if (lower == "help") {
    printHelp();
    return;
  }
  if (lower == "stop") {
    stopLoops();
    adv->stop();
    Serial.println("[WandSim] Loops stopped");
    return;
  }
  if (lower == "idle") {
    stopLoops();
    broadcastIdle();
    return;
  }
  if (lower == "ping") {
    stopLoops();
    broadcastPing();
    return;
  }
  if (lower == "mb rainbow") {
    stopLoops();
    broadcastMbRainbowFive();
    return;
  }
  if (lower == "mbsweep") {
    loopMode = LOOP_MB_SWEEP;
    mbSweepIdx = 0;
    loopNextMs = 0;
    Serial.println("[WandSim] MB sweep — cycling palettes (stop to cancel)");
    return;
  }
  if (lower == "sw list" || lower == "swlist") {
    printSwFxList();
    return;
  }
  if (lower == "swfxloop") {
    loopMode = LOOP_SW_FX;
    swFxLoopIdx = 0;
    loopNextMs = 0;
    Serial.println("[WandSim] SW fx loop — stop to cancel");
    return;
  }

  String parts[8];
  int n = splitWords(lower, parts, 8);

  // sw fx <name>
  if (n >= 3 && parts[0] == "sw" && parts[1] == "fx") {
    stopLoops();
    const HexPreset* fx = findSwFx(parts[2]);
    if (fx) broadcastHexPreset(*fx);
    else Serial.printf("[SW] Unknown fx '%s' — try 'sw list'\n", parts[2].c_str());
    return;
  }
  // sw combo <color> <fx>
  if (n >= 4 && parts[0] == "sw" && parts[1] == "combo") {
    broadcastSwCombo(parsePaletteWord(parts[2]), parts[3].c_str());
    return;
  }
  // sw pattern <mode> <color>
  if (n >= 4 && parts[0] == "sw" && parts[1] == "pattern") {
    stopLoops();
    broadcastSwPattern(parsePaletteWord(parts[3]), parsePatternWord(parts[2]));
    return;
  }
  // sw solid <color>
  if (n >= 3 && parts[0] == "sw" && parts[1] == "solid") {
    stopLoops();
    broadcastMbSingle(parsePaletteWord(parts[2]));
    return;
  }
  // sw cast <color> — alias
  if (n >= 3 && parts[0] == "sw" && parts[1] == "cast") {
    stopLoops();
    broadcastWandCast(parsePaletteWord(parts[2]));
    return;
  }

  if (n >= 2 && parts[0] == "cast") {
    stopLoops();
    broadcastWandCast(parsePaletteWord(parts[1]));
    return;
  }
  if (n >= 2 && parts[0] == "legacy") {
    stopLoops();
    broadcastLegacyCast(parsePaletteWord(parts[1]));
    return;
  }
  if (n >= 2 && parts[0] == "loop") {
    loopPalette = parsePaletteWord(parts[1]);
    loopMode = LOOP_WAND_CAST;
    loopNextMs = 0;
    Serial.printf("[WandSim] Wand cast loop palette %u\n", loopPalette);
    return;
  }
  if (n >= 2 && parts[0] == "mbloop") {
    loopPalette = parsePaletteWord(parts[1]);
    loopMode = LOOP_MB_PALETTE;
    loopNextMs = 0;
    Serial.printf("[WandSim] MB loop palette %u\n", loopPalette);
    return;
  }
  if (n >= 2 && parts[0] == "mb" && parts[1] == "dual" && n >= 4) {
    stopLoops();
    broadcastMbDual(parsePaletteWord(parts[2]), parsePaletteWord(parts[3]));
    return;
  }
  if (n >= 5 && parts[0] == "mb" && parts[1] == "rgb") {
    stopLoops();
    broadcastMbRgb((uint8_t)parts[2].toInt(), (uint8_t)parts[3].toInt(), (uint8_t)parts[4].toInt());
    return;
  }
  if (n >= 7 && parts[0] == "mb" && parts[1] == "five") {
    stopLoops();
    broadcastMbFive(parsePaletteWord(parts[2]), parsePaletteWord(parts[3]),
                    parsePaletteWord(parts[4]), parsePaletteWord(parts[5]),
                    parsePaletteWord(parts[6]));
    return;
  }
  if (n >= 4 && parts[0] == "mb" && parts[2] == "mask") {
    stopLoops();
    broadcastMbSingle(parsePaletteWord(parts[1]), (uint8_t)parts[3].toInt());
    return;
  }
  if (n >= 2 && parts[0] == "mb") {
    stopLoops();
    broadcastMbSingle(parsePaletteWord(parts[1]));
    return;
  }

  Serial.printf("[WandSim] Unknown: %s\n", line.c_str());
  printHelp();
}

void serviceLoops() {
  if (loopMode == LOOP_NONE) return;
  unsigned long now = millis();
  if (now < loopNextMs) return;

  switch (loopMode) {
    case LOOP_WAND_CAST:
      broadcastWandCast(loopPalette);
      loopNextMs = now + 5000;
      break;
    case LOOP_MB_PALETTE:
      broadcastMbSingle(loopPalette);
      loopNextMs = now + 3000;
      break;
    case LOOP_MB_SWEEP: {
      Serial.printf("[WandSim] Sweep palette %u\n", mbSweepIdx);
      broadcastMbSingle(mbSweepIdx);
      mbSweepIdx = (uint8_t)((mbSweepIdx + 1) & 0x1F);
      loopNextMs = now + 3000;
      break;
    }
    case LOOP_SW_FX: {
      const HexPreset& fx = SW_FX_PRESETS[swFxLoopIdx % SW_FX_PRESET_COUNT];
      broadcastHexPreset(fx);
      swFxLoopIdx = (uint8_t)((swFxLoopIdx + 1) % SW_FX_PRESET_COUNT);
      loopNextMs = now + 4000;
      break;
    }
    default:
      break;
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  randomSeed(esp_random());

  Serial.println();
  Serial.println("[WandSim] Starlight wand + MagicBand+ BLE broadcaster");
  Serial.println("[WandSim] Adafruit magicband_protocol.py packet builders");
  NimBLEDevice::init("WandSim");
  adv = NimBLEDevice::getAdvertising();
  adv->setMinInterval(32);
  adv->setMaxInterval(64);
  printHelp();
}

void loop() {
  if (Serial.available()) {
    handleLine(Serial.readStringUntil('\n'));
  }
  serviceLoops();
  delay(10);
}
