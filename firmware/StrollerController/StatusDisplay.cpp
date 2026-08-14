#include "StatusDisplay.h"
#include "Globals.h"
#include "Config.h"

void statusDisplaySetWledOk(bool ok) { wledHttpOk = ok; }

#if !HAS_OLED

void statusDisplaySetLastRule(const char* name) { (void)name; }

bool statusDisplayInit() {
  Serial.println("[Display] skipped (HAS_OLED=0)");
  return false;
}

bool statusDisplayReady() { return false; }

void statusDisplayReassertWire() {}

void statusDisplayUpdate() {}

#else

#include "PayloadTransport.h"
#include "MbRuleEngine.h"
#include "PresetStore.h"
#include "Types.h"
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

static Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
static bool displayReady = false;
static String lastFiredRuleName = "";
static unsigned long lastDisplayMs = 0;

// Default GFX font is 6×8 → 21 cols × 8 rows on 128×64.
static const int OLED_COLS = OLED_WIDTH / 6;
static const int OLED_ROWS = OLED_HEIGHT / 8;

void statusDisplaySetLastRule(const char* name) {
  lastFiredRuleName = name ? String(name) : "";
  lastDisplayMs = 0;  // redraw ASAP
}

static void i2cBusScan() {
  Serial.printf("[Display] I2C scan SDA=%d SCL=%d …\n", OLED_SDA_PIN, OLED_SCL_PIN);
  uint8_t found = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("[Display]   device at 0x%02X\n", addr);
      found++;
    }
  }
  if (!found) Serial.println("[Display]   (no devices — check wiring / 3V3 / GND)");
}

static bool tryOledBegin(uint8_t addr) {
  const uint8_t vcc = OLED_USE_EXTERNAL_VCC ? SSD1306_EXTERNALVCC : SSD1306_SWITCHCAPVCC;
  if (!display.begin(vcc, addr)) return false;
  display.ssd1306_command(SSD1306_DISPLAYON);
  display.ssd1306_command(SSD1306_SETCONTRAST);
  display.ssd1306_command(0xFF);
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Illuma Buggy");
  display.println("OLED OK");
  display.print("SDA ");
  display.print(OLED_SDA_PIN);
  display.print(" SCL ");
  display.println(OLED_SCL_PIN);
  display.print("addr 0x");
  display.println(addr, HEX);
  display.display();
  Serial.printf("[Display] OLED ready (SDA=%d SCL=%d addr=0x%02X vcc=%s)\n",
                OLED_SDA_PIN, OLED_SCL_PIN, addr,
                OLED_USE_EXTERNAL_VCC ? "EXT" : "SWITCHCAP");
  return true;
}

bool statusDisplayInit() {
  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
  Wire.setClock(OLED_I2C_HZ);
  delay(100);
  i2cBusScan();

  // Most modules are 0x3C; some are 0x3D.
  if (tryOledBegin(OLED_I2C_ADDR) || tryOledBegin(0x3D) ||
      (OLED_I2C_ADDR != 0x3C && tryOledBegin(0x3C))) {
    displayReady = true;
    lastDisplayMs = 0;
    return true;
  }

  Serial.printf("[Display] SSD1306 init failed (SDA=%d SCL=%d)\n",
                OLED_SDA_PIN, OLED_SCL_PIN);
  displayReady = false;
  return false;
}

bool statusDisplayReady() { return displayReady; }

void statusDisplayReassertWire() {
  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
  Wire.setClock(OLED_I2C_HZ);
}

static int linesNeeded(const String& s) {
  if (s.length() == 0) return 1;
  return (int)((s.length() + OLED_COLS - 1) / OLED_COLS);
}

/** Print up to maxLines of text, wrapping at OLED_COLS. Returns lines used. */
static int printWrapped(const String& text, int maxLines) {
  if (maxLines <= 0) return 0;
  int len = (int)text.length();
  int pos = 0;
  int used = 0;
  while (pos < len && used < maxLines) {
    int take = len - pos;
    if (take > OLED_COLS) take = OLED_COLS;
    display.println(text.substring(pos, pos + take));
    pos += take;
    used++;
  }
  if (used == 0) {
    display.println();
    used = 1;
  }
  return used;
}

static String cachedPresetId;
static String cachedPresetName;

/** Prefer live currentPresetName; fall back to NVS lookup. */
static String presetDisplayName(const String& id) {
  if (id.length() == 0) return "(none)";
  if (id == currentPresetId && currentPresetName.length() > 0) return currentPresetName;
  if (id == cachedPresetId && cachedPresetName.length() > 0) return cachedPresetName;

  String name = getPresetName(id);
  cachedPresetId = id;
  cachedPresetName = name.length() ? name : id;
  return cachedPresetName;
}

void statusDisplayUpdate() {
  if (!displayReady) return;
  unsigned long now = millis();
  if (lastDisplayMs != 0 && (now - lastDisplayMs) < STATUS_DISPLAY_INTERVAL_MS) return;
  lastDisplayMs = now;

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);

  int rowsUsed = 0;

  // 1. WLED status / uptime
  display.print("WLED:");
  display.print(wledHttpOk ? "OK" : "FAIL");
  display.print(" Up:");
  display.print(now / 1000UL);
  display.println("s");
  rowsUsed++;

  // 2. Board role (+ Link on its own line when dual-board logic)
  display.print("Role:");
  display.println(boardRole == BoardRole::LOGIC_BOARD ? "LOGIC" : "STD");
  rowsUsed++;

  if (boardRole == BoardRole::LOGIC_BOARD) {
    bool linkOk = (lastScannerPacketMs != 0) &&
                  ((now - lastScannerPacketMs) < SCANNER_ALIVE_MS);
    float ageSec = lastScannerPacketMs ? ((now - lastScannerPacketMs) / 1000.0f) : 0.0f;
    display.print("Link:");
    display.print(linkOk ? "OK" : "LOST");
    if (lastScannerPacketMs) {
      display.print(" (");
      display.print(ageSec, 1);
      display.print("s)");
    }
    display.println();
    rowsUsed++;
  }

  // 3. HEAP / PSRAM
  display.print("Heap:");
  display.print((unsigned)(ESP.getFreeHeap() / 1024));
  display.print("k PSRAM:");
  display.print((unsigned)(ESP.getFreePsram() / 1024 / 1024));
  display.println("M");
  rowsUsed++;

  // 4. Show / Override
  static const char* showTypeStr[] = {"NONE", "PARADE", "FWORKS"};
  static const char* showPhaseStr[] = {"-", "PRE", "BLACK", "LIVE", "POST"};
  static const char* overrideStr[] = {"NONE", "ZONE", "MANUAL", "SHOW", "MB", "SW"};
  int st = (int)showModeType;
  int sp = (int)showModePhase;
  int ov = (int)currentOverride;
  if (st < 0 || st > 2) st = 0;
  if (sp < 0 || sp > 4) sp = 0;
  if (ov < 0 || ov > 5) ov = 0;
  display.print("Show:");
  display.print(showTypeStr[st]);
  display.print("/");
  display.print(showPhaseStr[sp]);
  display.print(" Ov:");
  display.println(overrideStr[ov]);
  rowsUsed++;

  // 5–6. Preset + Rules (may wrap into remaining rows; rules preferred)
  unsigned ruleCount = 0;
  {
    JsonArray rules = mbRulesJsonArray();
    if (!rules.isNull()) ruleCount = (unsigned)rules.size();
  }

  String presetText = String("Preset:") + presetDisplayName(currentPresetId);
  String rulesText = mbRulesFsDegraded
                     ? String("Rules:NOT ON FS")
                     : (String("Rules:") + String(ruleCount) + " | " +
                        (lastFiredRuleName.length() ? lastFiredRuleName : "(none)"));

  int left = OLED_ROWS - rowsUsed;
  int pNeed = linesNeeded(presetText);
  int rNeed = linesNeeded(rulesText);
  int pAlloc = 0;
  int rAlloc = 0;

  if (left <= 0) {
    // nothing
  } else if (left == 1) {
    // Rules matter more — drop preset if only one row left
    rAlloc = 1;
  } else {
    pAlloc = 1;
    rAlloc = left - 1;
    if (rNeed < rAlloc) {
      int spare = rAlloc - rNeed;
      rAlloc = rNeed;
      pAlloc = pNeed < (1 + spare) ? pNeed : (1 + spare);
    }
  }

  if (pAlloc > 0) printWrapped(presetText, pAlloc);
  if (rAlloc > 0) printWrapped(rulesText, rAlloc);

  display.display();
}

#endif  // HAS_OLED
