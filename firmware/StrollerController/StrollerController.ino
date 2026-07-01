/**
 * StrollerController Firmware v2.1
 * ESP32-S3-DevKitC-1-N16R8
 *
 * Changes from v2.0:
 *  - WLED proxy GET commands (effects, palettes, fxdata, state)
 *  - MagicBand segment config (4-corner vs 5-point) stored in NVS
 *  - Segment setup command (splits strip into 5 named segments)
 *  - Chunked BLE response helper (shared by all large responses)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <NimBLEDevice.h>

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
// const char* WLED_SSID   = "StrollerNet";
// const char* WLED_PASS   = "stroller1234";
const char* WLED_SSID   = "KyLan Ren";
const char* WLED_PASS   = "tigers2016";
const char* WLED_IP     = "wled.local";
const int   WLED_PORT   = 80;
const char* BLE_NAME    = "IllumaBuggy";

#define SERVICE_UUID     "12345678-1234-1234-1234-123456789abc"
#define CMD_CHAR_UUID    "12345678-1234-1234-1234-123456789abd"
#define NOTIFY_CHAR_UUID "12345678-1234-1234-1234-123456789abe"

// LED strip — WLED segment 0 covers the full logical strip (both physical runs)
#define STRIP_LED_COUNT 100
#define WLED_CHASE_FX   28   // "Chase" in WLED 16.x effect list
#define WLED_MB_PAL_SLOT 0   // custom palette slot in pd{}

// MagicBand chase defaults (override via serial or mb_chase_config BLE command)
uint8_t mbChaseSpeed     = 128;  // sx — 0 = stationary
uint8_t mbChaseThickness = 4;    // grp — LEDs per chase block (color width)

// MB→WLED mapping types (must be before any function body — Arduino auto-prototypes)
#define MB_MAX_SEG_REFS 8
#define MB_MAX_COLOR_SLOTS 16

struct WledSegRef {
  uint8_t id;
  uint16_t start;
  uint16_t stop;
  uint8_t grp = 1;
  uint8_t spc = 0;
  int16_t of = 0;
  bool rev = false;
  bool mi = false;
  int fx = -1;
  uint8_t sx = 128;
  uint8_t ix = 128;
  int pal = -1;
};
struct MbSegMap { WledSegRef refs[MB_MAX_SEG_REFS]; uint8_t count; };
struct MbEffectMap {
  String presetId;
  uint8_t colorSlots[MB_MAX_COLOR_SLOTS];
  uint8_t colorSlotCount;
};

enum OverrideSource { NONE, ZONE, MANUAL, SHOW_MODE, BLE_MAGIC, BLE_STARLIGHT };

enum SwMatchQuality { SW_MATCH_EXACT, SW_MATCH_FUZZY, SW_MATCH_NONE };

enum ShowType  { SHOW_NONE, SHOW_PARADE, SHOW_FIREWORKS };
enum ShowPhase { PHASE_NONE, PHASE_PRE, PHASE_BLACK, PHASE_LIVE, PHASE_POST };

static const char* MB_SEG_KEYS[] = {
  "all", "inner", "outer", "topLeft", "topRight", "bottomLeft", "bottomRight", "center",
  "band0", "band1", "band2", "band3", "band4", "band5", "band6", "band7"
};
#define MB_SEG_KEY_COUNT 16
static const char* MB_ANIM_KEYS[] = { "E90C", "E90E", "E90F", "E910", "E911", "E912", "E913", "wand" };
static const char* MB_PAT_KEYS[]  = { "3", "4", "5", "8", "B" };
static const char* SW_ANIM_KEYS[] = {
  "rainbow", "blink", "palette5", "flash", "sparkle", "pulse", "circle", "fade", "fade2", "wand"
};
#define SW_ANIM_COUNT 10

static const uint8_t MB_DEFAULT_COLORS[32][3] = {
  {0,255,255},{153,0,255},{0,0,255},{0,0,128},{0,102,255},{204,68,255},{204,153,255},{119,0,204},
  {255,102,178},{255,90,168},{255,80,158},{255,74,148},{255,110,150},{255,130,160},{255,160,170},{255,170,0},
  {204,204,0},{255,136,0},{170,255,0},{255,102,0},{255,51,0},{255,0,0},
  {60,255,255},{40,240,255},{20,200,255},{0,255,0},{102,255,40},{255,255,255},{240,240,240},
  {0,0,0},{255,153,51},{255,0,255}
};

void paletteToRGB(uint8_t idx, uint8_t& r, uint8_t& g, uint8_t& b);
void loadMbMappingDefaults();
void loadMbMappingFromJson();
String mfrToHex(const uint8_t* data, size_t len);
String mfrToHexFull(const uint8_t* data, size_t len, size_t maxLen);
void handleDisneyPayload(const uint8_t* payload, size_t plen);
void processDisneyPayloadQueue();

// ─────────────────────────────────────────────
// GLOBALS
// ─────────────────────────────────────────────
Preferences prefs;

NimBLEServer*         bleServer    = nullptr;
NimBLECharacteristic* notifyChar   = nullptr;
bool                  bleConnected = false;

// Reassemble large CMD writes from Web Bluetooth (512-byte GATT limit)
String cmdChunkBuffer;
int    cmdChunkNextSeq = 0;

void resetCmdChunkBuffer() {
  cmdChunkBuffer = "";
  cmdChunkNextSeq = 0;
}

void processBleCmdChunk(int seq, bool last, const String& data);
void handleBLECommand(const String& msg);

OverrideSource currentOverride    = NONE;
bool           overrideKillOnZone = false;
unsigned long  overrideTimestamp  = 0;

ShowType  showModeType  = SHOW_NONE;
ShowPhase showModePhase = PHASE_NONE;
OverrideSource overrideBeforeInterrupt = NONE;

String showLookParadePre     = "";
String showLookParadeLive    = "";
String showLookFireworksPre  = "";
String showLookFireworksLive = "__BLACK__";
String showLookFireworksPost = "";

int    currentBrightness = 128;
String currentPresetId   = "";

// BLE effect config (persisted in NVS)
// Priority (high → low): Starlight Wand > MagicBand+ > Manual > Zone
bool          starlightEnabled    = true;
unsigned long starlightTimeoutMs  = 15000;  // ms before wand effect auto-clears (0 = never)
bool          magicBandEnabled    = true;
bool          magicBandFivePoint  = true;   // true = 4 corners + center, false = 4 corners only
unsigned long magicBandTimeoutMs  = 15000;  // ms before MB override auto-clears (0 = never)
unsigned long bleEffectTransitionMs = 700;  // fade in/out for MB+SW effects (0 = instant)
bool          bleScanLogEnabled   = true;   // Serial hex dump of Disney scan packets

// BLE effect timeout tracking
unsigned long swEventTimestamp = 0;
unsigned long mbEventTimestamp = 0;
unsigned long swDebugLastNotify = 0;
// BLE scan log dedup state (Serial monitor)
uint8_t       lastLogBytes[48];
size_t        lastLogLen      = 0;
uint32_t      scanRepeatCount = 0;
unsigned long scanRepeatSummaryMs = 0;

// Wand cast dedupe — rolling bytes change every advert; palette is stable per button press
uint8_t       lastWandCastPayload[16];
size_t        lastWandCastLen     = 0;
unsigned long lastWandCastMs      = 0;

// MB effect dedupe — identical E1/E9 adverts repeat for seconds; re-applying WLED cycles segments
uint8_t       lastMbEffectPayload[48];
size_t        lastMbEffectLen = 0;
const uint8_t* pendingMbEffectPayload = nullptr;
size_t        pendingMbEffectPayloadLen = 0;

bool mbEffectIsRepeatAdvert(const uint8_t* payload, size_t plen) {
  if (plen == 0 || lastMbEffectLen == 0) return false;
  size_t n = plen < sizeof(lastMbEffectPayload) ? plen : sizeof(lastMbEffectPayload);
  if (n != lastMbEffectLen) return false;
  if (memcmp(payload, lastMbEffectPayload, n) != 0) return false;
  return currentOverride == BLE_MAGIC;
}

void rememberMbEffect(const uint8_t* payload, size_t plen) {
  if (plen > sizeof(lastMbEffectPayload)) plen = sizeof(lastMbEffectPayload);
  memcpy(lastMbEffectPayload, payload, plen);
  lastMbEffectLen = plen;
}

void touchOverrideIdleTimer(OverrideSource src) {
  unsigned long now = millis();
  if (src == BLE_MAGIC) mbEventTimestamp = now;
  else if (src == BLE_STARLIGHT) swEventTimestamp = now;
}

// True when this is a repeat advert of the same cast (extend idle timer only)
bool wandCastIsDuplicateAdvert(const uint8_t* payload, size_t plen) {
  unsigned long now = millis();
  if (plen == 0 || plen > sizeof(lastWandCastPayload)) return false;
  if (plen != lastWandCastLen) return false;
  if (memcmp(payload, lastWandCastPayload, plen) != 0) return false;
  return (now - lastWandCastMs) < 250;
}

void rememberWandCast(const uint8_t* payload, size_t plen) {
  if (plen > sizeof(lastWandCastPayload)) plen = sizeof(lastWandCastPayload);
  memcpy(lastWandCastPayload, payload, plen);
  lastWandCastLen = plen;
  lastWandCastMs = millis();
}

// Serial sniff mode — log every manufacturer packet (find wand button format)
unsigned long bleSniffUntilMs = 0;

// App packet capture (parade / show recording)
bool          bleCaptureToApp     = false;
unsigned long bleCaptureUntilMs   = 0;
unsigned long bleCaptureLastNotifyMs = 0;
uint16_t      bleCaptureNotifyCount  = 0;
char          captureLabel[24]    = "";

// Wand TX beacon — advertise as another Starlight wand (for pairing/cast tests)
bool          wandTxBeacon    = false;
unsigned long wandTxCastUntil = 0;
uint8_t       wandTxCastPalette = 4;
unsigned long wandTxLastAdvMs = 0;
static const uint8_t WAND_IDLE_PAYLOAD[19] = {
  0x0F, 0x11, 0x01, 0x4B, 0x72, 0x99, 0x08, 0x83, 0x0A, 0x66,
  0xD4, 0x85, 0xCD, 0x9F, 0x95, 0x75, 0xA8, 0xA3, 0x21
};
static const uint8_t WAND_CAST_SIG[6] = {0xCF, 0x0B, 0x00, 0xC4, 0x20, 0x22};
#define WAND_CAST_LEN 13

// Pre-event WLED state (restored after BLE effect clears)
String savedWledState   = "";
String savedRestorePresetId = "";  // fast restore — re-apply zone/manual preset (no GET)
OverrideSource savedRestoreOverride = NONE;
String liveWledState    = "";      // background-polled / last-known full state
unsigned long lastLiveStatePollMs = 0;
const unsigned long LIVE_STATE_POLL_MS = 12000;
String baselineWledState  = "";   // snapshot at connect — full /json/state
String mbMappingJson = "";  // unified MB→WLED mapping (colors, animations, patterns, segments)
String bleDefaultPresetId = "";  // fallback — same presets as GPS zones
bool   wledWasConnected   = false;

// Defer Disney BLE packet handling to loop() — HTTP must not run on NimBLE scan stack
#define DISNEY_PAYLOAD_MAX 64
struct DisneyPayloadJob {
  uint8_t data[DISNEY_PAYLOAD_MAX];
  uint8_t len;
  volatile bool pending;
};
DisneyPayloadJob disneyJob = {};
portMUX_TYPE disneyJobMux = portMUX_INITIALIZER_UNLOCKED;

void queueDisneyPayload(const uint8_t* payload, size_t plen) {
  if (plen == 0) return;
  if (plen > DISNEY_PAYLOAD_MAX) plen = DISNEY_PAYLOAD_MAX;
  portENTER_CRITICAL(&disneyJobMux);
  memcpy(disneyJob.data, payload, plen);
  disneyJob.len = (uint8_t)plen;
  disneyJob.pending = true;
  portEXIT_CRITICAL(&disneyJobMux);
}

void processDisneyPayloadQueue() {
  if (!disneyJob.pending) return;
  uint8_t buf[DISNEY_PAYLOAD_MAX];
  uint8_t len = 0;
  portENTER_CRITICAL(&disneyJobMux);
  if (!disneyJob.pending) {
    portEXIT_CRITICAL(&disneyJobMux);
    return;
  }
  len = disneyJob.len;
  memcpy(buf, disneyJob.data, len);
  disneyJob.pending = false;
  portEXIT_CRITICAL(&disneyJobMux);
  handleDisneyPayload(buf, len);
}

uint8_t mbWledColors[32][3];
#define MB_MAX_LAYOUTS 6
struct MbSegmentLayout {
  char name[24];
  MbSegMap segMaps[MB_SEG_KEY_COUNT];
};
MbSegmentLayout mbLayouts[MB_MAX_LAYOUTS];
uint8_t mbLayoutCount = 0;
uint8_t mbActiveLayoutIdx = 0;
String  mbLayoutsJson = "";
MbEffectMap mbAnimMap[8];   // E90C,E90E,E90F,E910,E911,E912,E913,wand
MbEffectMap swAnimMap[SW_ANIM_COUNT];

// WandSimulator / Adafruit named SW fx payloads (full E1/E2-wrapped E9 packets)
static const uint8_t SW_PRESET_RAINBOW[] = {
  0xE1,0x00,0xE9,0x0C,0x00,0x0F,0x0F,0x5D,0x46,0x5B,0xF0,0x05,0x32,0x37,0x48,0xB0
};
static const uint8_t SW_PRESET_BLINK[] = {
  0xE1,0x00,0xE9,0x0C,0x00,0x0F,0x0F,0x5D,0x46,0x5B,0xF0,0x05,0x32,0x37,0x48,0x95
};
static const uint8_t SW_PRESET_PALETTE5[] = {
  0xE1,0x00,0xE9,0x0C,0x00,0x0F,0x0F,0xB1,0xB9,0xB5,0xB1,0xA2,0x30,0x7B,0x7D,0xB0
};
static const uint8_t SW_PRESET_FLASH[] = {
  0xE1,0x00,0xE9,0x0E,0x00,0x01,0x0F,0xBD,0xA0,0xA0,0xBD,0xA0,0x59,0x07,0x00,0x48,0xAE,0xB5
};
static const uint8_t SW_PRESET_SPARKLE[] = {
  0xE1,0x00,0xE9,0x10,0x00,0x13,0x48,0x97,0xD0,0x0E,0xA0,0xD1,0x46,0x06,0x0F,0x30,0xD0,0x4E,0x07,0xB0
};
static const uint8_t SW_PRESET_PULSE[] = {
  0xE1,0x00,0xE9,0x13,0x00,0x02,0xD0,0x37,0xF0,0xD2,0x3D,0x05,0x05,0x00,0x0E,0xFA,0x89,0x83,0x51,0x0E,0xE7,0xA0,0xB0
};
static const uint8_t SW_PRESET_CIRCLE[] = {
  0xE2,0x00,0xE9,0x12,0x00,0x03,0x0F,0xA2,0xA2,0xA4,0xA4,0xA2,0x30,0xD0,0x37,0xF4,0xD2,0x46,0x00,0x64,0xFC,0xB8
};
static const uint8_t SW_PRESET_FADE[] = {
  0xE1,0x00,0xE9,0x11,0x00,0x6F,0x0F,0x56,0x48,0x58,0xF4,0x48,0x82,0xD1,0x46,0x02,0x08,0xD0,0x65,0x00,0xB0
};
static const uint8_t SW_PRESET_FADE2[] = {
  0xE1,0x00,0xE9,0x11,0x00,0x0F,0x0F,0x48,0x59,0x58,0xF4,0x48,0x82,0xD1,0x46,0x02,0x0D,0xD0,0x65,0x05,0xB0
};

struct SwFxSignature {
  const char* key;
  const uint8_t* data;
  size_t len;
};

static const SwFxSignature SW_FX_SIGNATURES[] = {
  { "rainbow",  SW_PRESET_RAINBOW,  sizeof(SW_PRESET_RAINBOW) },
  { "blink",    SW_PRESET_BLINK,    sizeof(SW_PRESET_BLINK) },
  { "palette5", SW_PRESET_PALETTE5, sizeof(SW_PRESET_PALETTE5) },
  { "flash",    SW_PRESET_FLASH,    sizeof(SW_PRESET_FLASH) },
  { "sparkle",  SW_PRESET_SPARKLE,  sizeof(SW_PRESET_SPARKLE) },
  { "pulse",    SW_PRESET_PULSE,    sizeof(SW_PRESET_PULSE) },
  { "circle",   SW_PRESET_CIRCLE,   sizeof(SW_PRESET_CIRCLE) },
  { "fade",     SW_PRESET_FADE,     sizeof(SW_PRESET_FADE) },
  { "fade2",    SW_PRESET_FADE2,    sizeof(SW_PRESET_FADE2) },
};
static const size_t SW_FX_SIGNATURE_COUNT = sizeof(SW_FX_SIGNATURES) / sizeof(SW_FX_SIGNATURES[0]);
MbEffectMap mbPatMap[5];    // 3,4,5,8,B

// WiFi reconnect
unsigned long lastWifiRetry = 0;
const int     WIFI_RETRY_MS = 5000;

// Pending command queue — BLE callbacks queue work here, loop() processes it
// This prevents HTTPClient from running on the NimBLE stack (insufficient stack space)
// IMPORTANT: use char arrays not String — FreeRTOS queues copy by value
struct PendingCmd {
  char type[32];
};
QueueHandle_t cmdQueue;

// ─────────────────────────────────────────────
// BLE NOTIFY HELPER
// ─────────────────────────────────────────────

void bleNotify(const String& json) {
  if (!bleConnected || notifyChar == nullptr) return;
  notifyChar->setValue(json.c_str());
  notifyChar->notify();
}

// Chunk a large string and send as series of BLE notifications
// type: the message type field in each chunk
void bleNotifyChunked(const String& type, const String& payload) {
  if (!bleConnected) {
    Serial.printf("[BLE] Not connected, skipping %s\n", type.c_str());
    return;
  }

  const int CHUNK = 100;  // must fit in single MTU packet (247 bytes) after base64+JSON wrapper
  int total  = payload.length();
  int offset = 0;
  int seq    = 0;

  Serial.printf("[BLE] Sending %s total=%d\n", type.c_str(), total);

  while (offset < total) {
    if (!bleConnected) {
      Serial.println("[BLE] Disconnected mid-chunk, aborting");
      return;
    }

    int end  = min(offset + CHUNK, total);
    bool last = (end >= total);
    String chunk = payload.substring(offset, end);

    String msg = "{\"type\":\"" + type + "\","
                 "\"seq\":" + String(seq) + ","
                 "\"last\":" + (last ? "true" : "false") + ","
                 "\"data\":\"";

    for (int i = 0; i < (int)chunk.length(); i++) {
      char c = chunk[i];
      if      (c == '"')  msg += "\\\"";
      else if (c == '\\') msg += "\\\\";
      else if (c == '\n') msg += "\\n";
      else if (c == '\r') msg += "\\r";
      else                msg += c;
    }
    msg += "\"}";

    bleNotify(msg);
    delay(50);       // let BLE stack process
    vTaskDelay(1);   // yield to FreeRTOS scheduler

    offset = end;
    seq++;
  }

  Serial.printf("[BLE] Done: %s (%d chunks)\n", type.c_str(), seq);
}

// ─────────────────────────────────────────────
// PRESET STORAGE (NVS)
// ─────────────────────────────────────────────

void savePreset(const String& id, const String& name, const String& wledJson) {
  prefs.begin("presets", false);
  String key = "p_" + id;
  String val = "{\"id\":\"" + id + "\",\"name\":\"" + name + "\",\"wled\":" + wledJson + "}";
  prefs.putString(key.c_str(), val);
  String index = prefs.getString("index", "");
  if (index.indexOf(id) == -1) {
    if (index.length() > 0) index += ",";
    index += id;
    prefs.putString("index", index);
  }
  prefs.end();
}

String getPreset(const String& id) {
  prefs.begin("presets", true);
  String val = prefs.getString(("p_" + id).c_str(), "");
  prefs.end();
  return val;
}

String getAllPresets() {
  prefs.begin("presets", true);
  String index = prefs.getString("index", "");
  prefs.end();
  if (index.length() == 0) return "[]";
  String result = "[";
  int start = 0;
  bool first = true;
  while (start < (int)index.length()) {
    int comma = index.indexOf(',', start);
    String id = (comma == -1) ? index.substring(start) : index.substring(start, comma);
    String preset = getPreset(id);
    if (preset.length() > 0) {
      if (!first) result += ",";
      result += preset;
      first = false;
    }
    if (comma == -1) break;
    start = comma + 1;
  }
  return result + "]";
}

void deletePreset(const String& id) {
  prefs.begin("presets", false);
  prefs.remove(("p_" + id).c_str());
  String index = prefs.getString("index", "");
  String newIndex = "";
  int start = 0;
  while (start < (int)index.length()) {
    int comma = index.indexOf(',', start);
    String entry = (comma == -1) ? index.substring(start) : index.substring(start, comma);
    if (entry != id) {
      if (newIndex.length() > 0) newIndex += ",";
      newIndex += entry;
    }
    if (comma == -1) break;
    start = comma + 1;
  }
  prefs.putString("index", newIndex);
  prefs.end();
}

// ─────────────────────────────────────────────
// WLED API
// ─────────────────────────────────────────────

bool sendToWLED(const String& jsonBody, int timeoutMs = 2000, int retries = 0) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WLED] WiFi not connected");
    return false;
  }
  HTTPClient http;
  http.begin("http://" + String(WLED_IP) + ":" + String(WLED_PORT) + "/json/state");
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(timeoutMs);
  int code = -1;
  for (int attempt = 0; attempt <= retries; attempt++) {
    code = http.POST(jsonBody);
    if (code == 200) {
      http.end();
      return true;
    }
    if (attempt < retries) delay(80);
  }
  Serial.printf("[WLED] POST failed: %d (%u bytes)\n", code, (unsigned)jsonBody.length());
  http.end();
  return false;
}

// WLED JSON API: "transition" = duration in 100ms units for this state change
String injectWledTransition(const String& jsonBody, unsigned long transitionMs) {
  if (transitionMs == 0 || jsonBody.length() < 2 || jsonBody.charAt(0) != '{') return jsonBody;
  unsigned tenths = transitionMs / 100;
  if (tenths == 0) tenths = 1;
  if (tenths > 655) tenths = 655;
  return "{\"transition\":" + String(tenths) + "," + jsonBody.substring(1);
}

bool sendToWLEDForBleEffect(const String& jsonBody) {
  return sendToWLED(injectWledTransition(jsonBody, bleEffectTransitionMs));
}

// GET a WLED endpoint and return the response body
String getFromWLED(const String& path) {
  if (WiFi.status() != WL_CONNECTED) return "";
  HTTPClient http;
  http.begin("http://" + String(WLED_IP) + ":" + String(WLED_PORT) + path);
  http.setTimeout(5000);
  int code = http.GET();
  String body = "";
  if (code == 200) {
    body = http.getString();
  } else {
    Serial.printf("[WLED] GET %s failed: %d\n", path.c_str(), code);
  }
  http.end();
  return body;
}

#define WLED_RESTORE_JSON_CAP 24576

// Keep only POST-safe fields so restore payloads stay small and reliable.
String compactWledStateForSave(const String& full) {
  DynamicJsonDocument in(WLED_RESTORE_JSON_CAP);
  if (deserializeJson(in, full) != DeserializationError::Ok) return full;

  DynamicJsonDocument out(WLED_RESTORE_JSON_CAP);
  out["on"] = in["on"] | true;
  if (in.containsKey("bri")) out["bri"] = in["bri"];
  if (in.containsKey("nl")) out["nl"] = in["nl"];
  if (in.containsKey("fp")) out["fp"] = in["fp"];

  JsonArray inSegs = in["seg"].as<JsonArray>();
  if (!inSegs.isNull() && inSegs.size() > 0) {
    JsonArray outSegs = out.createNestedArray("seg");
    static const char* segKeys[] = {
      "id", "start", "stop", "len", "grp", "spc", "of", "on", "bri",
      "fx", "pal", "sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3",
      "col", "mi", "rev", "sel",
    };
    for (JsonObject segIn : inSegs) {
      int stop = segIn["stop"] | 0;
      if (stop <= 0) continue;
      JsonObject segOut = outSegs.createNestedObject();
      for (const char* k : segKeys) {
        if (segIn.containsKey(k)) segOut[k] = segIn[k];
      }
      if (!segOut.containsKey("id")) segOut["id"] = outSegs.size() - 1;
    }
  } else {
    static const char* rootKeys[] = {
      "fx", "pal", "sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3", "col",
      "mi", "of", "grp", "spc", "bm", "rev",
    };
    for (const char* k : rootKeys) {
      if (in.containsKey(k)) out[k] = in[k];
    }
  }

  String compact;
  serializeJson(out, compact);
  return compact.length() > 0 ? compact : full;
}

bool applyPreset(const String& id) {
  String preset = getPreset(id);
  if (preset.length() == 0) {
    Serial.printf("[Preset] Not found: %s\n", id.c_str());
    return false;
  }
  DynamicJsonDocument doc(8192);
  if (deserializeJson(doc, preset)) return false;
  String wledJson;
  serializeJson(doc["wled"], wledJson);
  currentPresetId = id;
  bool ok = sendToWLED(wledJson);
  if (ok) {
    // Preset JSON is partial — don't overwrite full polled state used for MB restore.
    liveWledState = "";
    lastLiveStatePollMs = 0;
  }
  return ok;
}

bool setBrightness(int bri) {
  currentBrightness = bri;
  return sendToWLED("{\"bri\":" + String(bri) + "}");
}

// Pull full WLED state, persist as baseline (segments, bri, fx, etc.)
void snapshotWledBaseline() {
  String state = getFromWLED("/json/state");
  if (state.length() == 0) {
    Serial.println("[WLED] Baseline snapshot failed (GET /json/state)");
    return;
  }

  baselineWledState = compactWledStateForSave(state);
  liveWledState = baselineWledState;

  DynamicJsonDocument doc(12288);
  DeserializationError err = deserializeJson(doc, state);
  if (!err) {
    if (doc.containsKey("bri")) {
      currentBrightness = doc["bri"].as<int>();
    }
  }

  prefs.begin("config", false);
  prefs.putString("wledBase", baselineWledState);
  prefs.end();

  Serial.printf("[WLED] Baseline snapshot (%u bytes, bri=%d)\n",
                (unsigned)baselineWledState.length(), currentBrightness);
}

void loadWledBaselineFromNvs() {
  prefs.begin("config", true);
  String loaded = prefs.getString("wledBase", "");
  prefs.end();
  if (loaded.length() == 0) return;

  baselineWledState = loaded;
  DynamicJsonDocument doc(12288);
  if (!deserializeJson(doc, loaded)) {
    if (doc.containsKey("bri")) {
      currentBrightness = doc["bri"].as<int>();
    }
  }
  Serial.printf("[WLED] Loaded baseline from NVS (%u bytes, bri=%d)\n",
                (unsigned)baselineWledState.length(), currentBrightness);
}

void ensureWledPowerOn() {
  DynamicJsonDocument doc(12288);
  if (baselineWledState.length() > 0 &&
      deserializeJson(doc, baselineWledState) == DeserializationError::Ok) {
    if (!doc["on"].as<bool>()) {
      sendToWLED("{\"on\":true}");
      Serial.println("[WLED] Master power was off — sent on:true (relay)");
    }
    return;
  }
  sendToWLED("{\"on\":true}");
}

// ─────────────────────────────────────────────
// WLED EFFECTS — full-strip MagicBand chase / wand solid
// Only PATCH segment 0 — never send stop:0 on other segments (destroys WLED layout)
// ─────────────────────────────────────────────

String buildSeg0JsonBody(const String& seg0Inner) {
  return "\"seg\":[{\"id\":0," + seg0Inner + "}]";
}

// Build 5-color custom palette + Chase across entire strip
String buildMagicBandChaseJson(const uint8_t paletteIdxs[5]) {
  static const int positions[5] = {0, 51, 102, 153, 204};
  String pd = "\"pd\":{\"" + String(WLED_MB_PAL_SLOT) + "\":[";
  for (int i = 0; i < 5; i++) {
    uint8_t r, g, b;
    paletteToRGB(paletteIdxs[i], r, g, b);
    if (i > 0) pd += ",";
    pd += "[" + String(positions[i]) + "," + String(r) + "," + String(g) + "," + String(b) + "]";
  }
  pd += "]}";
  return "{" + pd + "," + buildSeg0JsonBody("\"start\":0,\"stop\":" + String(STRIP_LED_COUNT) +
         ",\"fx\":" + String(WLED_CHASE_FX) + ",\"sx\":" + String(mbChaseSpeed) +
         ",\"grp\":" + String(mbChaseThickness) + ",\"pal\":" + String(WLED_MB_PAL_SLOT)) + "}";
}

void applyMagicBandChase(const uint8_t paletteIdxs[5], OverrideSource src) {
  if (!canTakeOverride(src)) {
    Serial.printf("[MB] chase blocked by override %d\n", (int)currentOverride);
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[MB] WiFi down — chase not sent");
    return;
  }
  saveWledStateForOverride();
  Serial.printf("[MB] Chase spd=%u thick=%u pals=%u,%u,%u,%u,%u\n",
                mbChaseSpeed, mbChaseThickness,
                paletteIdxs[0], paletteIdxs[1], paletteIdxs[2], paletteIdxs[3], paletteIdxs[4]);
  disableMbSplitSegments();
  sendToWLEDForBleEffect(buildMagicBandChaseJson(paletteIdxs));
  setOverride(src);
  touchOverrideIdleTimer(src);
}

void applyMagicBandChaseFromAnchor(uint8_t anchorPalette, OverrideSource src) {
  uint8_t pals[5];
  for (int i = 0; i < 5; i++) pals[i] = (anchorPalette + (uint8_t)(i * 5)) & 0x1F;
  applyMagicBandChase(pals, src);
}

void loadMbMappingDefaults() {
  memcpy(mbWledColors, MB_DEFAULT_COLORS, sizeof(mbWledColors));
  mbLayoutCount = 1;
  mbActiveLayoutIdx = 0;
  strncpy(mbLayouts[0].name, "Default", sizeof(mbLayouts[0].name) - 1);
  mbLayouts[0].name[sizeof(mbLayouts[0].name) - 1] = '\0';
  const uint16_t defs[][2] = {
    {0,100},{35,65},{0,35},{0,25},{25,50},{50,75},{75,100},{48,52},
    {0,20},{20,40},{40,60},{60,80},{80,100},
    {80,87},{87,94},{94,100}
  };
  for (int i = 0; i < MB_SEG_KEY_COUNT; i++) {
    mbLayouts[0].segMaps[i].count = 1;
    mbLayouts[0].segMaps[i].refs[0] = { (uint8_t)(i == 2 ? 2 : i), defs[i][0], defs[i][1] };
    if (i == 2) {
      mbLayouts[0].segMaps[i].count = 2;
      mbLayouts[0].segMaps[i].refs[0] = { 2, 0, 35 };
      mbLayouts[0].segMaps[i].refs[1] = { 3, 65, 100 };
    }
  }
  for (int i = 0; i < 8; i++) { mbAnimMap[i].presetId = ""; mbAnimMap[i].colorSlotCount = 0; }
  for (int i = 0; i < SW_ANIM_COUNT; i++) { swAnimMap[i].presetId = ""; swAnimMap[i].colorSlotCount = 0; }
  for (int i = 0; i < 5; i++) { mbPatMap[i].presetId = ""; mbPatMap[i].colorSlotCount = 0; }
}

void parseEffectMap(JsonObject obj, MbEffectMap& out) {
  out.presetId = obj["presetId"] | "";
  out.colorSlotCount = 0;
  if (obj.containsKey("colorSlots")) {
    for (JsonVariant v : obj["colorSlots"].as<JsonArray>()) {
      if (out.colorSlotCount >= MB_MAX_COLOR_SLOTS) break;
      out.colorSlots[out.colorSlotCount++] = (uint8_t)(v.as<int>() & 0x1F);
    }
  }
}

void parseSegMapArray(JsonArray arr, MbSegMap& out) {
  out.count = 0;
  for (JsonVariant v : arr) {
    if (!v.is<JsonObject>() || out.count >= MB_MAX_SEG_REFS) continue;
    JsonObject r = v;
    uint16_t start = (uint16_t)r["start"].as<int>();
    uint16_t stop  = (uint16_t)r["stop"].as<int>();
    if (stop <= start || stop > STRIP_LED_COUNT) continue;
    WledSegRef ref;
    ref.id    = (uint8_t)r["id"].as<int>();
    ref.start = start;
    ref.stop  = stop;
    ref.grp   = r.containsKey("grp") ? (uint8_t)r["grp"].as<int>() : 1;
    ref.spc   = r.containsKey("spc") ? (uint8_t)r["spc"].as<int>() : 0;
    ref.of    = r.containsKey("of")  ? (int16_t)r["of"].as<int>() : 0;
    ref.rev   = r["rev"] | false;
    ref.mi    = r["mi"]  | false;
    ref.fx    = r.containsKey("fx")  ? r["fx"].as<int>() : -1;
    ref.sx    = r.containsKey("sx")  ? (uint8_t)r["sx"].as<int>() : 128;
    ref.ix    = r.containsKey("ix")  ? (uint8_t)r["ix"].as<int>() : 128;
    ref.pal   = r.containsKey("pal") ? r["pal"].as<int>() : -1;
    out.refs[out.count++] = ref;
  }
}

void loadMbLayoutsFromJson() {
  if (mbLayoutsJson.length() == 0) return;
  DynamicJsonDocument doc(16384);
  if (deserializeJson(doc, mbLayoutsJson)) return;
  JsonArray layoutsArr = doc.as<JsonArray>();
  if (layoutsArr.isNull()) return;
  mbLayoutCount = 0;
  for (JsonObject lo : layoutsArr) {
    if (mbLayoutCount >= MB_MAX_LAYOUTS) break;
    MbSegmentLayout& layout = mbLayouts[mbLayoutCount];
    strncpy(layout.name, lo["name"] | "Layout", sizeof(layout.name) - 1);
    layout.name[sizeof(layout.name) - 1] = '\0';
    JsonObject segs = lo["segments"];
    for (int i = 0; i < MB_SEG_KEY_COUNT; i++) {
      layout.segMaps[i].count = 0;
      if (segs.containsKey(MB_SEG_KEYS[i])) {
        parseSegMapArray(segs[MB_SEG_KEYS[i]].as<JsonArray>(), layout.segMaps[i]);
      }
    }
    mbLayoutCount++;
  }
  if (mbLayoutCount == 0) return;
  if (mbActiveLayoutIdx >= mbLayoutCount) mbActiveLayoutIdx = 0;
}

String resolveEffectPresetId(const MbEffectMap& map) {
  if (map.presetId.length() > 0) return map.presetId;
  return bleDefaultPresetId;
}

void loadMbMappingFromJson() {
  bleDefaultPresetId = "";
  if (mbMappingJson.length() == 0) return;

  DynamicJsonDocument doc(12288);
  if (deserializeJson(doc, mbMappingJson)) return;

  bleDefaultPresetId = doc["defaultPresetId"] | "";

  if (doc.containsKey("colors")) {
    JsonObject colors = doc["colors"];
    for (JsonPair kv : colors) {
      int idx = atoi(kv.key().c_str());
      if (idx < 0 || idx > 31) continue;
      JsonArray rgb = kv.value().as<JsonArray>();
      if (rgb.isNull() || rgb.size() < 3) continue;
      mbWledColors[idx][0] = (uint8_t)rgb[0].as<int>();
      mbWledColors[idx][1] = (uint8_t)rgb[1].as<int>();
      mbWledColors[idx][2] = (uint8_t)rgb[2].as<int>();
    }
  }
  if (doc.containsKey("segments")) {
    JsonObject segs = doc["segments"];
    if (mbLayoutCount == 0) {
      mbLayoutCount = 1;
      strncpy(mbLayouts[0].name, "Default", sizeof(mbLayouts[0].name) - 1);
      mbLayouts[0].name[sizeof(mbLayouts[0].name) - 1] = '\0';
    }
    for (int i = 0; i < MB_SEG_KEY_COUNT; i++) {
      if (!segs.containsKey(MB_SEG_KEYS[i])) continue;
      parseSegMapArray(segs[MB_SEG_KEYS[i]].as<JsonArray>(), mbLayouts[0].segMaps[i]);
    }
  }
  if (doc.containsKey("animations")) {
    JsonObject anims = doc["animations"];
    for (int i = 0; i < 8; i++) {
      if (anims.containsKey(MB_ANIM_KEYS[i])) parseEffectMap(anims[MB_ANIM_KEYS[i]], mbAnimMap[i]);
    }
  }
  if (doc.containsKey("swAnimations")) {
    JsonObject swAnims = doc["swAnimations"];
    for (int i = 0; i < SW_ANIM_COUNT; i++) {
      if (swAnims.containsKey(SW_ANIM_KEYS[i])) parseEffectMap(swAnims[SW_ANIM_KEYS[i]], swAnimMap[i]);
    }
  } else if (doc.containsKey("animations")) {
    JsonObject anims = doc["animations"];
    if (anims.containsKey("wand")) parseEffectMap(anims["wand"], swAnimMap[9]);
  }
  if (doc.containsKey("patterns")) {
    JsonObject pats = doc["patterns"];
    for (int i = 0; i < 5; i++) {
      if (pats.containsKey(MB_PAT_KEYS[i])) parseEffectMap(pats[MB_PAT_KEYS[i]], mbPatMap[i]);
    }
  }
}

int mbSegKeyIndex(const char* key) {
  for (int i = 0; i < MB_SEG_KEY_COUNT; i++) if (strcmp(key, MB_SEG_KEYS[i]) == 0) return i;
  return -1;
}

// Classic E905: mask in byte7[7:5] (0 = all). Extended Illuma/WandSim: byte6 = 8-bit LED bitmask.
uint8_t decodeE905MaskByte(const uint8_t* payload) {
  uint8_t b6 = payload[6];
  if (b6 != 0x0E && b6 != 0x0F) return b6;
  return (payload[7] >> 5) & 0x07;
}

uint8_t decodeE905Palette(const uint8_t* payload) {
  return payload[7] & 0x1F;
}

void applyMbSingleMask(uint8_t mask8, uint8_t pal, OverrideSource src) {
  if (!canTakeOverride(src)) return;
  if (WiFi.status() != WL_CONNECTED) return;
  if (mask8 == 0) {
    applyMbSegmentSolid("all", pal, src);
    return;
  }
  static const char* keys[8] = {
    "band0", "band1", "band2", "band3", "band4", "band5", "band6", "band7"
  };
  const char* segKeys[8];
  uint8_t pals[8];
  int m = 0;
  for (int i = 0; i < 8; i++) {
    if (mask8 & (1 << i)) {
      segKeys[m] = keys[i];
      pals[m] = pal;
      m++;
    }
  }
  if (m == 0) applyMbSegmentSolid("all", pal, src);
  else applyMbMultiSegmentSolid(segKeys, pals, m, src);
}

void applyMbSingleE905(const uint8_t* payload, OverrideSource src) {
  applyMbSingleMask(decodeE905MaskByte(payload), decodeE905Palette(payload), src);
}

#define MB_WLED_MAX_SEG 16

void appendDisableWledSegment(String& body, uint8_t segId, bool& first) {
  if (!first) body += ",";
  first = false;
  body += "{\"id\":" + String(segId) + ",\"stop\":0}";
}

void addActiveSegId(uint8_t id, uint8_t* out, uint8_t& count) {
  for (uint8_t i = 0; i < count; i++) {
    if (out[i] == id) return;
  }
  if (count < MB_MAX_SEG_REFS * 5) out[count++] = id;
}

void collectActiveSegIds(const MbSegMap& map, uint8_t* out, uint8_t& count) {
  for (uint8_t i = 0; i < map.count; i++) {
    addActiveSegId(map.refs[i].id, out, count);
  }
}

// Disable WLED segments not used by this effect so stale splits do not stay lit.
void appendDisableInactiveSegments(String& body, bool& first,
                                  const uint8_t* activeIds, uint8_t activeCount, bool disableSeg0) {
  if (disableSeg0) {
    bool seg0Active = false;
    for (uint8_t i = 0; i < activeCount; i++) {
      if (activeIds[i] == 0) { seg0Active = true; break; }
    }
    if (!seg0Active) appendDisableWledSegment(body, 0, first);
  }
  for (uint8_t id = 1; id < MB_WLED_MAX_SEG; id++) {
    bool keep = false;
    for (uint8_t i = 0; i < activeCount; i++) {
      if (activeIds[i] == id) { keep = true; break; }
    }
    if (!keep) appendDisableWledSegment(body, id, first);
  }
}

void disableAllSplitSegments() {
  String body = "{\"seg\":[";
  bool first = true;
  for (uint8_t id = 1; id < MB_WLED_MAX_SEG; id++) {
    appendDisableWledSegment(body, id, first);
  }
  body += "]}";
  sendToWLED(body, 3000, 1);
}

void appendWledSolidSeg(String& body, const WledSegRef& ref,
                        uint8_t r, uint8_t g, uint8_t b, bool& first) {
  if (ref.stop <= ref.start) return;
  if (!first) body += ",";
  first = false;
  int fx = ref.fx >= 0 ? ref.fx : 0;
  body += "{\"id\":" + String(ref.id) + ",\"start\":" + String(ref.start) + ",\"stop\":" + String(ref.stop)
       + ",\"grp\":" + String(ref.grp) + ",\"spc\":" + String(ref.spc)
       + ",\"of\":" + String(ref.of) + ",\"rev\":" + String(ref.rev ? "true" : "false")
       + ",\"mi\":" + String(ref.mi ? "true" : "false")
       + ",\"fx\":" + String(fx) + ",\"sx\":" + String(ref.sx) + ",\"ix\":" + String(ref.ix);
  if (ref.pal >= 0) body += ",\"pal\":" + String(ref.pal);
  body += ",\"col\":[[" + String(r) + "," + String(g) + "," + String(b) + "]]}";
}

MbSegMap& activeMbSegMap(int keyIdx) {
  if (mbLayoutCount == 0) {
    mbLayoutCount = 1;
    strncpy(mbLayouts[0].name, "Default", sizeof(mbLayouts[0].name) - 1);
  }
  uint8_t idx = mbActiveLayoutIdx < mbLayoutCount ? mbActiveLayoutIdx : 0;
  return mbLayouts[idx].segMaps[keyIdx];
}

void applyMbSegmentSolid(const char* segKey, uint8_t palIdx, OverrideSource src) {
  int si = mbSegKeyIndex(segKey);
  if (si < 0) return;
  uint8_t r, g, b;
  paletteToRGB(palIdx, r, g, b);
  MbSegMap& map = activeMbSegMap(si);
  if (map.count == 0) return;
  saveWledStateForOverride();
  uint8_t activeIds[MB_MAX_SEG_REFS * 5];
  uint8_t activeCount = 0;
  collectActiveSegIds(map, activeIds, activeCount);
  bool disableSeg0 = (strcmp(segKey, "all") != 0);
  String body = "{\"on\":true,\"seg\":[";
  bool first = true;
  appendDisableInactiveSegments(body, first, activeIds, activeCount, disableSeg0);
  for (uint8_t i = 0; i < map.count; i++) {
    appendWledSolidSeg(body, map.refs[i], r, g, b, first);
  }
  body += "]}";
  sendToWLEDForBleEffect(body);
  setOverride(src);
  touchOverrideIdleTimer(src);
}

void applyMbMultiSegmentSolid(const char* segKeys[], const uint8_t pals[], int n, OverrideSource src) {
  saveWledStateForOverride();
  uint8_t activeIds[MB_MAX_SEG_REFS * 5];
  uint8_t activeCount = 0;
  for (int i = 0; i < n; i++) {
    int si = mbSegKeyIndex(segKeys[i]);
    if (si < 0) continue;
    collectActiveSegIds(activeMbSegMap(si), activeIds, activeCount);
  }
  String body = "{\"on\":true,\"seg\":[";
  bool first = true;
  // Zone presets use segment 0 full-strip — disable before split layout.
  appendDisableInactiveSegments(body, first, activeIds, activeCount, true);
  for (int i = 0; i < n; i++) {
    int si = mbSegKeyIndex(segKeys[i]);
    if (si < 0) continue;
    uint8_t r, g, b;
    paletteToRGB(pals[i], r, g, b);
    MbSegMap& siMap = activeMbSegMap(si);
    for (uint8_t j = 0; j < siMap.count; j++) {
      appendWledSolidSeg(body, siMap.refs[j], r, g, b, first);
    }
  }
  body += "]}";
  sendToWLEDForBleEffect(body);
  setOverride(src);
  touchOverrideIdleTimer(src);
}

bool applyMbPresetWithColors(const MbEffectMap& map, const uint8_t* packetPals, int packetPalCount, OverrideSource src) {
  String presetId = resolveEffectPresetId(map);
  if (presetId.length() == 0) return false;
  if (!canTakeOverride(src)) return false;

  int slotCount = map.colorSlotCount > 0 ? map.colorSlotCount : packetPalCount;

  // No MB color override — apply zone preset unchanged (same path as zone_trigger)
  if (slotCount <= 0) {
    saveWledStateForOverride();
    bool ok = applyPreset(presetId);
    if (ok) {
      setOverride(src);
      touchOverrideIdleTimer(src);
      Serial.printf("[BLE] Applied preset %s (zone-style)\n", presetId.c_str());
    } else {
      Serial.printf("[BLE] Preset not found on board: %s\n", presetId.c_str());
    }
    return ok;
  }

  String preset = getPreset(presetId);
  if (preset.length() == 0) {
    Serial.printf("[BLE] Preset not found on board: %s\n", presetId.c_str());
    return false;
  }

  saveWledStateForOverride();
  DynamicJsonDocument doc(4096);
  if (deserializeJson(doc, preset)) return false;
  DynamicJsonDocument wled(4096);
  if (deserializeJson(wled, doc["wled"])) return false;

  if (slotCount > 0) {
    uint8_t r0, g0, b0;
    uint8_t pal0 = packetPalCount > 0 ? packetPals[0] : 0;
    if (map.colorSlotCount > 0) pal0 = map.colorSlots[0];
    paletteToRGB(pal0, r0, g0, b0);
    JsonArray seg = wled["seg"].to<JsonArray>();
    if (seg.isNull() || seg.size() == 0) {
      seg = wled.createNestedArray("seg");
      seg.add<JsonObject>();
    }
    JsonObject seg0 = seg[0];
    JsonArray col = seg0["col"].to<JsonArray>();
    col.clear();
    for (int i = 0; i < slotCount; i++) {
      uint8_t pal = packetPalCount > 0 ? packetPals[i % packetPalCount] : 0;
      if (map.colorSlotCount > 0) pal = map.colorSlots[i % map.colorSlotCount];
      uint8_t r, g, b;
      paletteToRGB(pal, r, g, b);
      JsonArray rgb = col.createNestedArray();
      rgb.add(r); rgb.add(g); rgb.add(b);
    }
    if (col.size() == 1) {
      seg0["col"] = col[0];
    }
  }

  String wledJson;
  serializeJson(wled, wledJson);
  disableMbSplitSegments();
  sendToWLEDForBleEffect(wledJson);
  setOverride(src);
  touchOverrideIdleTimer(src);
  return true;
}

bool applyMbAnimationKey(const char* key, const uint8_t* pals, int palCount, OverrideSource src) {
  for (int i = 0; i < 8; i++) {
    if (strcmp(key, MB_ANIM_KEYS[i]) != 0) continue;
    if (applyMbPresetWithColors(mbAnimMap[i], pals, palCount, src)) return true;
    return false;
  }
  return false;
}

bool applySwAnimationKey(const char* key, const uint8_t* pals, int palCount, OverrideSource src) {
  for (int i = 0; i < SW_ANIM_COUNT; i++) {
    if (strcmp(key, SW_ANIM_KEYS[i]) != 0) continue;
    if (applyMbPresetWithColors(swAnimMap[i], pals, palCount, src)) return true;
    return false;
  }
  return false;
}

bool swPayloadMatchesRef(const uint8_t* payload, size_t plen, const uint8_t* ref, size_t refLen) {
  if (plen == refLen && memcmp(payload, ref, refLen) == 0) return true;
  if (plen >= 2 && payload[0] == 0xE9 && refLen >= 4 && ref[2] == 0xE9) {
    size_t innerLen = refLen - 2;
    if (plen == innerLen && memcmp(payload, ref + 2, innerLen) == 0) return true;
  }
  return false;
}

SwMatchQuality identifySwFxPresetQuality(const uint8_t* payload, size_t plen, const char** outKey) {
  for (size_t i = 0; i < SW_FX_SIGNATURE_COUNT; i++) {
    if (swPayloadMatchesRef(payload, plen, SW_FX_SIGNATURES[i].data, SW_FX_SIGNATURES[i].len)) {
      if (outKey) *outKey = SW_FX_SIGNATURES[i].key;
      return SW_MATCH_EXACT;
    }
  }
  uint16_t func = 0;
  if (plen >= 4 && (payload[0] == 0xE1 || payload[0] == 0xE2) && payload[2] == 0xE9) {
    func = ((uint16_t)payload[2] << 8) | payload[3];
  } else if (plen >= 2 && payload[0] == 0xE9) {
    func = ((uint16_t)payload[0] << 8) | payload[1];
  }
  const char* fuzzyKey = nullptr;
  switch (func) {
    case 0xE90E: fuzzyKey = "flash"; break;
    case 0xE910: fuzzyKey = "sparkle"; break;
    case 0xE912: fuzzyKey = "circle"; break;
    case 0xE913: fuzzyKey = "pulse"; break;
    case 0xE911: fuzzyKey = "fade"; break;
    default: fuzzyKey = nullptr;
  }
  if (outKey) *outKey = fuzzyKey;
  if (fuzzyKey) return SW_MATCH_FUZZY;
  return SW_MATCH_NONE;
}

const char* identifySwFxPreset(const uint8_t* payload, size_t plen) {
  const char* key = nullptr;
  SwMatchQuality q = identifySwFxPresetQuality(payload, plen, &key);
  if (q == SW_MATCH_EXACT || q == SW_MATCH_FUZZY) return key;
  return nullptr;
}

uint16_t swPayloadFuncCode(const uint8_t* payload, size_t plen) {
  if (plen >= 4 && (payload[0] == 0xE1 || payload[0] == 0xE2) && payload[2] == 0xE9) {
    return ((uint16_t)payload[2] << 8) | payload[3];
  }
  if (plen >= 2 && payload[0] == 0xE9) {
    return ((uint16_t)payload[0] << 8) | payload[1];
  }
  return 0;
}

void notifyUnknownAnimation(const uint8_t* payload, size_t plen, SwMatchQuality quality, uint16_t func) {
  if (!bleCaptureToApp || !bleConnected) return;
  String q = quality == SW_MATCH_FUZZY ? "fuzzy" : "none";
  bleNotify("{\"type\":\"unknown_anim\",\"quality\":\"" + q +
            "\",\"func\":\"0x" + String(func, HEX) +
            "\",\"hex\":\"" + mfrToHexFull(payload, plen, 64) +
            "\",\"len\":" + String(plen) +
            ",\"label\":\"" + String(captureLabel) +
            "\",\"ts\":" + String(millis()) + "}");
}

void applySwAnimFallbackSolid(OverrideSource src) {
  saveWledStateForOverride();
  uint8_t activeIds[1] = { 0 };
  uint8_t activeCount = 1;
  String body = "{\"on\":true,\"seg\":[";
  bool first = true;
  appendDisableInactiveSegments(body, first, activeIds, activeCount, false);
  body += "{\"id\":0,\"start\":0,\"stop\":" + String(STRIP_LED_COUNT) + ",\"fx\":0}";
  body += "]}";
  sendToWLEDForBleEffect(body);
  setOverride(src);
  touchOverrideIdleTimer(src);
}

void applySwAnimOpcode(const char* swKey, const char* label) {
  if (!starlightEnabled || !swKey) return;
  if (!canTakeOverride(BLE_STARLIGHT)) {
    bleNotify("{\"type\":\"sw_event\",\"event\":\"blocked\"}");
    return;
  }
  if (applySwAnimationKey(swKey, nullptr, 0, BLE_STARLIGHT)) {
    bleNotify("{\"type\":\"sw_event\",\"event\":\"fx\",\"name\":\"" + String(swKey) + "\"}");
    return;
  }
  applySwAnimFallbackSolid(BLE_STARLIGHT);
  bleNotify("{\"type\":\"sw_event\",\"event\":\"" + String(label) + "\",\"name\":\"" + String(swKey) + "\"}");
}

bool tryApplySwE9Payload(const uint8_t* payload, size_t plen, const char* mbFallbackKey, const char* label) {
  if (!starlightEnabled) return false;
  const char* swKey = nullptr;
  SwMatchQuality mq = identifySwFxPresetQuality(payload, plen, &swKey);
  uint16_t func = swPayloadFuncCode(payload, plen);
  if (mq != SW_MATCH_EXACT && func >= 0xE90C && func <= 0xE913) {
    notifyUnknownAnimation(payload, plen, mq, func);
  }
  if (!swKey) return false;
  if (!canTakeOverride(BLE_STARLIGHT)) {
    bleNotify("{\"type\":\"sw_event\",\"event\":\"blocked\"}");
    return true;
  }
  if (applySwAnimationKey(swKey, nullptr, 0, BLE_STARLIGHT)) {
    bleNotify("{\"type\":\"sw_event\",\"event\":\"fx\",\"name\":\"" + String(swKey) + "\"}");
    return true;
  }
  applySwAnimFallbackSolid(BLE_STARLIGHT);
  bleNotify("{\"type\":\"sw_event\",\"event\":\"" + String(label) + "\",\"name\":\"" + String(swKey) + "\"}");
  return true;
}

bool applyMbPatternKey(const char* patKey, const uint8_t* pals, int palCount, OverrideSource src) {
  for (int i = 0; i < 5; i++) {
    if (strcmp(patKey, MB_PAT_KEYS[i]) != 0) continue;
    // E909 per-corner solids — only hijack when this pattern slot has its own preset.
    if (mbPatMap[i].presetId.length() == 0) return false;
    if (applyMbPresetWithColors(mbPatMap[i], pals, palCount, src)) return true;
    return false;
  }
  return false;
}

void applyMbSingle(uint8_t colorByte, OverrideSource src) {
  uint8_t payload[9] = { 0xE1, 0x00, 0xE9, 0x05, 0x00, 0x09, 0x0E, colorByte, 0xB0 };
  applyMbSingleE905(payload, src);
}

void applyMbDual(uint8_t innerByte, uint8_t outerByte, OverrideSource src) {
  const char* keys[2] = { "inner", "outer" };
  uint8_t pals[2] = { (uint8_t)(innerByte & 0x1F), (uint8_t)(outerByte & 0x1F) };
  applyMbMultiSegmentSolid(keys, pals, 2, src);
}

void applyMbFive(uint8_t topLeft, uint8_t bottomLeft, uint8_t bottomRight,
                 uint8_t topRight, uint8_t center, OverrideSource src) {
  if (!canTakeOverride(src)) return;
  if (WiFi.status() != WL_CONNECTED) return;

  static const char* keys[5] = { "topLeft", "bottomLeft", "bottomRight", "topRight", "center" };
  uint8_t pals[5] = { topLeft, bottomLeft, bottomRight, topRight, center };

  applyMbMultiSegmentSolid(keys, pals, 5, src);
}

bool e909UsesPatternSlots(const uint8_t* payload) {
  for (int i = 7; i <= 11; i++) {
    if ((payload[i] & 0xE0) != 0xA0) return true;
  }
  return false;
}

void applyFullStripSolid(uint8_t r, uint8_t g, uint8_t b, OverrideSource src) {
  if (!canTakeOverride(src)) return;
  if (WiFi.status() != WL_CONNECTED) {
    if (src == BLE_STARLIGHT) bleNotify("{\"type\":\"sw_event\",\"event\":\"wifi_down\"}");
    return;
  }
  saveWledStateForOverride();
  uint8_t activeIds[1] = { 0 };
  uint8_t activeCount = 1;
  String body = "{\"on\":true,\"seg\":[";
  bool first = true;
  appendDisableInactiveSegments(body, first, activeIds, activeCount, false);
  body += "{\"id\":0,\"start\":0,\"stop\":" + String(STRIP_LED_COUNT)
       + ",\"fx\":0,\"col\":[[" + String(r) + "," + String(g) + "," + String(b) + "]]}";
  body += "]}";
  sendToWLEDForBleEffect(body);
  setOverride(src);
  touchOverrideIdleTimer(src);
}

void disableMbSplitSegments() {
  disableAllSplitSegments();
}

// ─────────────────────────────────────────────
// OVERRIDE LOGIC
// Priority: Starlight Wand (4) > MagicBand+ (3) > Manual (2) > Zone (1)
// ─────────────────────────────────────────────

int overridePriority(OverrideSource src) {
  switch (src) {
    case ZONE:          return 1;
    case MANUAL:        return 2;
    case SHOW_MODE:     return 3;
    case BLE_MAGIC:     return 4;
    case BLE_STARLIGHT: return 5;
    default:            return 0;
  }
}

bool canTakeOverride(OverrideSource incoming) {
  if (incoming == NONE) return false;
  if (currentOverride == NONE) return true;
  return overridePriority(incoming) >= overridePriority(currentOverride);
}

void setOverride(OverrideSource src) {
  if (currentOverride == SHOW_MODE && (src == BLE_MAGIC || src == BLE_STARLIGHT)) {
    overrideBeforeInterrupt = SHOW_MODE;
  }
  currentOverride = src;
  overrideTimestamp = millis();
  if (src == BLE_MAGIC && pendingMbEffectPayload && pendingMbEffectPayloadLen > 0) {
    rememberMbEffect(pendingMbEffectPayload, pendingMbEffectPayloadLen);
  }
  Serial.printf("[Override] Set to %d\n", (int)src);
}

void saveWledStateForOverride() {
  if (savedWledState.length() > 0) return;

  if (savedRestoreOverride == NONE && savedRestorePresetId.length() == 0) {
    savedRestoreOverride = currentOverride;
    if (savedRestoreOverride == BLE_MAGIC || savedRestoreOverride == BLE_STARLIGHT ||
        savedRestoreOverride == SHOW_MODE) {
      savedRestoreOverride = NONE;
    }
    if (currentOverride == ZONE && currentPresetId.length() > 0) {
      savedRestorePresetId = currentPresetId;
    }
  }

  // Cache only — never block MB/SW effects with a sync GET here (poll runs in loop()).
  if (liveWledState.length() > 0) {
    savedWledState = liveWledState;
    Serial.printf("[Override] Saved snapshot (%u bytes, preset_fallback=%s)\n",
                  (unsigned)savedWledState.length(),
                  savedRestorePresetId.length() > 0 ? savedRestorePresetId.c_str() : "none");
    return;
  }

  if (baselineWledState.length() > 0) {
    savedWledState = baselineWledState;
    Serial.println("[Override] Saved baseline snapshot (no live poll yet)");
  } else {
    Serial.println("[Override] WARNING: no WLED snapshot available to restore");
  }
}

// WLED merges POST /json/state by segment id. Split segments are torn down in a separate
// small POST before restore so the snapshot payload stays small and reliable.
String buildWledRestorePayload(const String& savedJson) {
  DynamicJsonDocument doc(WLED_RESTORE_JSON_CAP);
  if (deserializeJson(doc, savedJson) != DeserializationError::Ok) {
    Serial.println("[Override] Restore JSON parse failed — posting raw snapshot");
    return savedJson;
  }

  doc.remove("transition");

  JsonArray segs = doc["seg"].as<JsonArray>();
  if (!segs.isNull()) {
    for (size_t i = 0; i < segs.size(); i++) {
      JsonObject seg = segs[i];
      if (!seg.containsKey("id")) seg["id"] = (int)i;
    }
  }

  String out;
  serializeJson(doc, out);
  if (out.length() == 0) return savedJson;
  Serial.printf("[Override] Restore payload (%u bytes, %u seg entries)\n",
                (unsigned)out.length(), segs.isNull() ? 0U : (unsigned)segs.size());
  return out;
}

// Presets and partial POST bodies may omit seg[] or segment ids — normalize before restore.
String prepareWledRestorePayload(const String& json) {
  DynamicJsonDocument doc(WLED_RESTORE_JSON_CAP);
  if (deserializeJson(doc, json) != DeserializationError::Ok) {
    return buildWledRestorePayload(json);
  }

  doc.remove("transition");

  JsonArray segs = doc["seg"].as<JsonArray>();
  if (segs.isNull() || segs.size() == 0) {
    DynamicJsonDocument wrapped(WLED_RESTORE_JSON_CAP);
    wrapped["on"] = doc["on"] | true;
    if (doc.containsKey("bri")) wrapped["bri"] = doc["bri"];
    JsonObject seg0 = wrapped.createNestedArray("seg").createNestedObject();
    seg0["id"] = 0;
    seg0["start"] = 0;
    seg0["stop"] = STRIP_LED_COUNT;
    static const char* moveKeys[] = {
      "fx", "pal", "sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3", "col",
      "mi", "of", "grp", "spc", "bm", "rev",
    };
    for (const char* k : moveKeys) {
      if (doc.containsKey(k)) seg0[k] = doc[k];
    }
    String normalized;
    serializeJson(wrapped, normalized);
    return buildWledRestorePayload(normalized);
  }

  for (size_t i = 0; i < segs.size(); i++) {
    JsonObject seg = segs[i];
    if (!seg.containsKey("id")) seg["id"] = (int)i;
  }

  String normalized;
  serializeJson(doc, normalized);
  return buildWledRestorePayload(normalized);
}

bool restoreWledSnapshot(const String& json, unsigned long fadeMs) {
  if (json.length() == 0) return false;
  disableAllSplitSegments();
  String payload = injectWledTransition(buildWledRestorePayload(json), fadeMs);
  return sendToWLED(payload, 8000, 2);
}

bool restorePresetWithTransition(const String& id, unsigned long fadeMs) {
  String preset = getPreset(id);
  if (preset.length() == 0) return false;
  DynamicJsonDocument doc(12288);
  if (deserializeJson(doc, preset)) return false;
  String wledJson;
  serializeJson(doc["wled"], wledJson);
  if (wledJson.length() == 0) return false;
  currentPresetId = id;
  return restoreWledSnapshot(prepareWledRestorePayload(wledJson), fadeMs);
}

void applyShowPhaseLook(ShowType type, ShowPhase phase, unsigned long fadeMs) {
  if (phase == PHASE_BLACK) {
    sendToWLED(injectWledTransition("{\"on\":false}", fadeMs));
    return;
  }
  String presetId;
  if (type == SHOW_PARADE) {
    presetId = (phase == PHASE_PRE) ? showLookParadePre : showLookParadeLive;
  } else if (type == SHOW_FIREWORKS) {
    if (phase == PHASE_PRE) presetId = showLookFireworksPre;
    else if (phase == PHASE_LIVE) presetId = showLookFireworksLive;
    else presetId = showLookFireworksPost;
  }
  if (presetId == "__BLACK__") {
    sendToWLED(injectWledTransition("{\"on\":false}", fadeMs));
    return;
  }
  if (presetId.length() == 0) return;

  String preset = getPreset(presetId);
  if (preset.length() == 0) return;
  DynamicJsonDocument doc(2048);
  if (deserializeJson(doc, preset)) return;
  String wledJson;
  serializeJson(doc["wled"], wledJson);
  currentPresetId = presetId;
  sendToWLED(injectWledTransition(prepareWledRestorePayload(wledJson), fadeMs));
  if (wledJson.length() > 0) liveWledState = wledJson;
}

const char* showTypeStatusStr() {
  if (showModeType == SHOW_PARADE) return "parade";
  if (showModeType == SHOW_FIREWORKS) return "fireworks";
  return "";
}

const char* showPhaseStatusStr() {
  switch (showModePhase) {
    case PHASE_PRE:   return "pre";
    case PHASE_BLACK: return "black";
    case PHASE_LIVE:  return "live";
    case PHASE_POST:  return "post";
    default:          return "";
  }
}

void pollLiveWledState() {
  if (currentOverride != NONE) return;
  if (WiFi.status() != WL_CONNECTED) return;
  unsigned long now = millis();
  if (now - lastLiveStatePollMs < LIVE_STATE_POLL_MS) return;
  lastLiveStatePollMs = now;
  String state = getFromWLED("/json/state");
  if (state.length() > 0) {
    liveWledState = compactWledStateForSave(state);
    Serial.printf("[WLED] Live state poll (%u bytes)\n", (unsigned)liveWledState.length());
  }
}

void clearOverride() {
  OverrideSource prev = currentOverride;
  unsigned long fadeMs = (prev == BLE_MAGIC || prev == BLE_STARLIGHT) ? bleEffectTransitionMs : 0;

  if (overrideBeforeInterrupt == SHOW_MODE && (prev == BLE_MAGIC || prev == BLE_STARLIGHT)) {
    overrideBeforeInterrupt = NONE;
    currentOverride = SHOW_MODE;
    overrideTimestamp = millis();
    applyShowPhaseLook(showModeType, showModePhase, fadeMs);
    return;
  }

  OverrideSource restoreOverride = savedRestoreOverride;
  String presetId = savedRestorePresetId;
  String snapshot = savedWledState;

  currentOverride = NONE;
  savedWledState = "";
  savedRestorePresetId = "";
  savedRestoreOverride = NONE;

  Serial.println("[Override] Cleared");

  bool restored = false;
  if (snapshot.length() > 0) {
    restored = restoreWledSnapshot(prepareWledRestorePayload(snapshot), fadeMs);
    if (restored) {
      Serial.printf("[Override] Restored snapshot (%u bytes)\n", (unsigned)snapshot.length());
    } else {
      Serial.printf("[Override] Snapshot restore POST failed (%u bytes)\n", (unsigned)snapshot.length());
    }
  }
  if (!restored && presetId.length() > 0) {
    restored = restorePresetWithTransition(presetId, fadeMs);
    if (restored) {
      Serial.printf("[Override] Restored preset: %s\n", presetId.c_str());
    } else {
      Serial.printf("[Override] Preset restore failed: %s\n", presetId.c_str());
    }
  }
  if (!restored && baselineWledState.length() > 0) {
    restored = restoreWledSnapshot(prepareWledRestorePayload(baselineWledState), fadeMs);
    if (restored) {
      Serial.println("[Override] Restored baseline WLED state");
    } else {
      Serial.println("[Override] Baseline restore POST failed");
    }
  }
  if (!restored) {
    Serial.println("[Override] Restore failed — strip may stay on last MB effect");
  } else {
    if (snapshot.length() > 0) {
      liveWledState = snapshot;
    } else if (baselineWledState.length() > 0) {
      liveWledState = baselineWledState;
    } else {
      liveWledState = "";
      lastLiveStatePollMs = 0;
    }
    if (liveWledState.length() > 0) lastLiveStatePollMs = millis();
  }

  if (restored && (restoreOverride == ZONE || restoreOverride == MANUAL)) {
    setOverride(restoreOverride);
  } else if (restored && presetId.length() > 0) {
    setOverride(ZONE);
  }
}

bool zoneWantsPreset(const String& presetId) {
  if (currentOverride != NONE && currentOverride != ZONE) {
    if (!overrideKillOnZone) {
      Serial.println("[Zone] Blocked by active override");
      return false;
    }
    clearOverride();
  }
  setOverride(ZONE);
  return applyPreset(presetId);
}

// ─────────────────────────────────────────────
// BLE COMMAND HANDLER
// ─────────────────────────────────────────────

void processBleCmdChunk(int seq, bool last, const String& data) {
  if (seq == 0) resetCmdChunkBuffer();
  if (seq != cmdChunkNextSeq) {
    Serial.printf("[BLE] Chunk seq mismatch (got %d, expected %d)\n", seq, cmdChunkNextSeq);
    resetCmdChunkBuffer();
    return;
  }
  if (cmdChunkBuffer.length() + data.length() > 8192) {
    Serial.println("[BLE] Chunk buffer overflow, aborting");
    resetCmdChunkBuffer();
    return;
  }
  cmdChunkBuffer += data;
  cmdChunkNextSeq++;
  if (last) {
    String complete = cmdChunkBuffer;
    resetCmdChunkBuffer();
    Serial.printf("[BLE] Chunk assembly complete (%u bytes)\n", (unsigned)complete.length());
    handleBLECommand(complete);
  }
}

void handleBLECommand(const String& msg) {
  DynamicJsonDocument doc(4096);
  DeserializationError err = deserializeJson(doc, msg);
  if (err) {
    Serial.printf("[BLE] JSON parse error: %s\n", err.c_str());
    return;
  }

  String type = doc["type"].as<String>();

  if (type == "ble_cmd_chunk") {
    processBleCmdChunk(doc["seq"].as<int>(), doc["last"].as<bool>(), doc["data"].as<String>());
    return;
  }

  // ── Preset management ──
  if (type == "preset_save") {
    String id = doc["id"].as<String>();
    String name = doc["name"].as<String>();
    String wled; serializeJson(doc["wled"], wled);
    savePreset(id, name, wled);
    bleNotify("{\"type\":\"ack\",\"action\":\"preset_save\",\"id\":\"" + id + "\"}");
  }
  else if (type == "preset_apply") {
    String id = doc["id"].as<String>();
    if (!canTakeOverride(MANUAL)) {
      Serial.println("[Preset] Blocked by higher-priority override");
      bleNotify("{\"type\":\"ack\",\"action\":\"preset_apply\",\"id\":\"" + id + "\",\"ok\":false}");
      return;
    }
    setOverride(MANUAL);
    bool ok = applyPreset(id);
    bleNotify("{\"type\":\"ack\",\"action\":\"preset_apply\",\"id\":\"" + id + "\",\"ok\":" + (ok ? "true" : "false") + "}");
  }
  else if (type == "preset_delete") {
    String id = doc["id"].as<String>();
    deletePreset(id);
    bleNotify("{\"type\":\"ack\",\"action\":\"preset_delete\",\"id\":\"" + id + "\"}");
  }
  else if (type == "preset_list") {
    PendingCmd cmd; strncpy(cmd.type, "preset_list", 31); xQueueSend(cmdQueue, &cmd, 0);
  }

  // ── WLED proxy GETs — queued to main loop (HTTPClient can't run on BLE stack) ──
  else if (type == "wled_get_effects") {
    PendingCmd cmd; strncpy(cmd.type, "wled_get_effects", 31); xQueueSend(cmdQueue, &cmd, 0);
  }
  else if (type == "wled_get_palettes") {
    PendingCmd cmd; strncpy(cmd.type, "wled_get_palettes", 31); xQueueSend(cmdQueue, &cmd, 0);
  }
  else if (type == "wled_get_fxdata") {
    PendingCmd cmd; strncpy(cmd.type, "wled_get_fxdata", 31); xQueueSend(cmdQueue, &cmd, 0);
  }
  else if (type == "wled_get_state") {
    PendingCmd cmd; strncpy(cmd.type, "wled_get_state", 31); xQueueSend(cmdQueue, &cmd, 0);
  }

  // ── Zone / override ──
  else if (type == "zone_trigger") {
    String id = doc["preset_id"].as<String>();
    bool applied = zoneWantsPreset(id);
    bleNotify("{\"type\":\"ack\",\"action\":\"zone_trigger\",\"applied\":" + String(applied ? "true" : "false") + "}");
  }
  else if (type == "override_clear") {
    clearOverride();
    bleNotify("{\"type\":\"ack\",\"action\":\"override_clear\"}");
  }
  else if (type == "fade_to_black") {
    if (!canTakeOverride(MANUAL)) {
      bleNotify("{\"type\":\"ack\",\"action\":\"fade_to_black\",\"ok\":false,\"reason\":\"blocked\"}");
      return;
    }
    saveWledStateForOverride();
    setOverride(MANUAL);
    unsigned long fadeMs = doc["fade_ms"] | 800;
    String targetPresetId = doc["preset_id"] | "";
    bool ok;
    if (targetPresetId.length() > 0) {
      ok = restorePresetWithTransition(targetPresetId, fadeMs);
    } else {
      ok = sendToWLED(injectWledTransition("{\"on\":false}", fadeMs));
    }
    bleNotify("{\"type\":\"ack\",\"action\":\"fade_to_black\",\"ok\":" + String(ok ? "true" : "false") + "}");
  }
  else if (type == "override_mode") {
    overrideKillOnZone = doc["kill_on_zone"].as<bool>();
    prefs.begin("config", false);
    prefs.putBool("killOnZone", overrideKillOnZone);
    prefs.end();
    bleNotify("{\"type\":\"ack\",\"action\":\"override_mode\",\"kill_on_zone\":" + String(overrideKillOnZone ? "true" : "false") + "}");
  }

  else if (type == "show_mode_config") {
    if (doc.containsKey("parade")) {
      JsonObject p = doc["parade"];
      showLookParadePre  = p["pre"]  | "";
      showLookParadeLive = p["live"] | "";
    }
    if (doc.containsKey("fireworks")) {
      JsonObject f = doc["fireworks"];
      showLookFireworksPre  = f["pre"]  | "";
      showLookFireworksLive = f["live"] | "__BLACK__";
      showLookFireworksPost = f["post"] | "";
    }
    prefs.begin("config", false);
    prefs.putString("showParaPre", showLookParadePre);
    prefs.putString("showParaLive", showLookParadeLive);
    prefs.putString("showFwPre", showLookFireworksPre);
    prefs.putString("showFwLive", showLookFireworksLive);
    prefs.putString("showFwPost", showLookFireworksPost);
    prefs.end();
    bleNotify("{\"type\":\"ack\",\"action\":\"show_mode_config\"}");
  }

  else if (type == "show_mode_enter") {
    String showStr = doc["show"] | "";
    String phaseStr = doc["phase"] | "";
    ShowType st = (showStr == "parade") ? SHOW_PARADE : (showStr == "fireworks") ? SHOW_FIREWORKS : SHOW_NONE;
    ShowPhase sp = (phaseStr == "pre") ? PHASE_PRE : (phaseStr == "black") ? PHASE_BLACK
                 : (phaseStr == "live") ? PHASE_LIVE : (phaseStr == "post") ? PHASE_POST : PHASE_NONE;
    if (st == SHOW_NONE || sp == PHASE_NONE) {
      bleNotify("{\"type\":\"ack\",\"action\":\"show_mode_enter\",\"ok\":false}");
    } else if (st == SHOW_PARADE && sp == PHASE_POST) {
      showModeType = SHOW_NONE;
      showModePhase = PHASE_NONE;
      overrideBeforeInterrupt = NONE;
      clearOverride();
      bleNotify("{\"type\":\"ack\",\"action\":\"show_mode_enter\",\"show\":\"parade\",\"phase\":\"post\",\"exited\":true}");
    } else {
      if (currentOverride != SHOW_MODE) saveWledStateForOverride();
      showModeType = st;
      showModePhase = sp;
      setOverride(SHOW_MODE);
      applyShowPhaseLook(st, sp, bleEffectTransitionMs);
      bleNotify("{\"type\":\"ack\",\"action\":\"show_mode_enter\",\"show\":\"" + showStr + "\",\"phase\":\"" + phaseStr + "\"}");
    }
  }

  else if (type == "show_mode_exit") {
    showModeType = SHOW_NONE;
    showModePhase = PHASE_NONE;
    overrideBeforeInterrupt = NONE;
    clearOverride();
    bleNotify("{\"type\":\"ack\",\"action\":\"show_mode_exit\"}");
  }

  // ── Brightness ──
  else if (type == "brightness") {
    int bri = constrain(doc["value"].as<int>(), 0, 255);
    setBrightness(bri);
    bleNotify("{\"type\":\"ack\",\"action\":\"brightness\",\"value\":" + String(bri) + "}");
  }

  // ── Raw WLED passthrough ──
  else if (type == "wled_raw") {
    String wled; serializeJson(doc["wled"], wled);
    bool ok = sendToWLED(wled);
    bleNotify("{\"type\":\"ack\",\"action\":\"wled_raw\",\"ok\":" + String(ok ? "true" : "false") + "}");
  }

  // ── BLE scan log (Serial monitor) ──
  else if (type == "scan_log_config") {
    if (doc.containsKey("enabled")) bleScanLogEnabled = doc["enabled"].as<bool>();
    prefs.begin("config", false);
    prefs.putBool("scanLog", bleScanLogEnabled);
    prefs.end();
    bleNotify("{\"type\":\"ack\",\"action\":\"scan_log_config\","
              "\"enabled\":" + String(bleScanLogEnabled ? "true" : "false") + "}");
    Serial.printf("[Scan] logging %s\n", bleScanLogEnabled ? "enabled" : "disabled");
  }

  // ── App packet capture (parade / show recording) ──
  else if (type == "ble_capture_config") {
    if (doc.containsKey("active")) bleCaptureToApp = doc["active"].as<bool>();
    if (doc.containsKey("label")) {
      strncpy(captureLabel, doc["label"] | "", sizeof(captureLabel) - 1);
      captureLabel[sizeof(captureLabel) - 1] = '\0';
    }
    bleCaptureUntilMs = 0;
    if (bleCaptureToApp && doc.containsKey("duration_ms")) {
      unsigned long dur = (unsigned long)doc["duration_ms"].as<long>();
      if (dur > 0) bleCaptureUntilMs = millis() + dur;
    }
    if (!bleCaptureToApp) {
      bleCaptureUntilMs = 0;
      bleNotify("{\"type\":\"ble_capture\",\"event\":\"stopped\",\"reason\":\"manual\"}");
    } else {
      bleCaptureLastNotifyMs = 0;
      bleCaptureNotifyCount = 0;
      bleNotify("{\"type\":\"ble_capture\",\"event\":\"started\"}");
    }
    bleNotify("{\"type\":\"ack\",\"action\":\"ble_capture_config\","
              "\"active\":" + String(bleCaptureToApp ? "true" : "false") + "}");
    Serial.printf("[Capture] app recording %s\n", bleCaptureToApp ? "ON" : "OFF");
  }

  // ── MB / SW effect fade ──
  else if (type == "ble_effect_config") {
    if (doc.containsKey("transition_ms")) {
      bleEffectTransitionMs = (unsigned long)doc["transition_ms"].as<long>();
    }
    prefs.begin("config", false);
    prefs.putULong("bleTransMs", bleEffectTransitionMs);
    prefs.end();
    bleNotify("{\"type\":\"ack\",\"action\":\"ble_effect_config\","
              "\"transition_ms\":" + String(bleEffectTransitionMs) + "}");
  }

  // ── Starlight Wand config ──
  else if (type == "sw_config") {
    if (doc.containsKey("enabled"))    starlightEnabled   = doc["enabled"].as<bool>();
    if (doc.containsKey("timeout_ms")) starlightTimeoutMs = (unsigned long)doc["timeout_ms"].as<long>();
    prefs.begin("config", false);
    prefs.putBool("swEn", starlightEnabled);
    prefs.putULong("swTimeout", starlightTimeoutMs);
    prefs.end();
    String ack = "{\"type\":\"ack\",\"action\":\"sw_config\","
                 "\"enabled\":" + String(starlightEnabled ? "true" : "false") + ","
                 "\"timeout_ms\":" + String(starlightTimeoutMs) + "}";
    bleNotify(ack);
  }

  // ── MagicBand chase tuning ──
  else if (type == "mb_chase_config") {
    if (doc.containsKey("speed"))     mbChaseSpeed     = (uint8_t)doc["speed"].as<int>();
    if (doc.containsKey("thickness")) mbChaseThickness = (uint8_t)doc["thickness"].as<int>();
    if (mbChaseThickness < 1) mbChaseThickness = 1;
    prefs.begin("config", false);
    prefs.putUChar("mbSpd", mbChaseSpeed);
    prefs.putUChar("mbGrp", mbChaseThickness);
    prefs.end();
    String ack = "{\"type\":\"ack\",\"action\":\"mb_chase_config\","
                 "\"speed\":" + String(mbChaseSpeed) + ","
                 "\"thickness\":" + String(mbChaseThickness) + "}";
    bleNotify(ack);
  }

  // ── Unified MB→WLED mapping ──
  else if (type == "mb_mapping_config") {
    if (doc.containsKey("mapping")) {
      serializeJson(doc["mapping"], mbMappingJson);
      prefs.begin("config", false);
      prefs.putString("mbMapping", mbMappingJson);
      prefs.end();
      loadMbMappingFromJson();
      Serial.printf("[MB] Mapping updated (%u bytes)\n", (unsigned)mbMappingJson.length());
    }
    bleNotify("{\"type\":\"ack\",\"action\":\"mb_mapping_config\",\"ok\":true}");
  }

  else if (type == "mb_layout_set") {
    JsonArray layoutsArr = doc["layouts"];
    mbLayoutCount = 0;
    for (JsonObject lo : layoutsArr) {
      if (mbLayoutCount >= MB_MAX_LAYOUTS) break;
      MbSegmentLayout& layout = mbLayouts[mbLayoutCount];
      strncpy(layout.name, lo["name"] | "Layout", sizeof(layout.name) - 1);
      layout.name[sizeof(layout.name) - 1] = '\0';
      JsonObject segs = lo["segments"];
      for (int i = 0; i < MB_SEG_KEY_COUNT; i++) {
        layout.segMaps[i].count = 0;
        if (segs.containsKey(MB_SEG_KEYS[i])) {
          parseSegMapArray(segs[MB_SEG_KEYS[i]].as<JsonArray>(), layout.segMaps[i]);
        }
      }
      mbLayoutCount++;
    }
    if (mbLayoutCount == 0) {
      loadMbMappingDefaults();
    } else {
      mbActiveLayoutIdx = constrain((int)(doc["active"] | 0), 0, max(0, (int)mbLayoutCount - 1));
    }
    serializeJson(doc["layouts"], mbLayoutsJson);
    prefs.begin("config", false);
    prefs.putString("mbLayouts", mbLayoutsJson);
    prefs.putUChar("mbActiveLayout", mbActiveLayoutIdx);
    prefs.end();
    bleNotify("{\"type\":\"ack\",\"action\":\"mb_layout_set\",\"active\":" + String(mbActiveLayoutIdx) + "}");
  }

  else if (type == "mb_layout_switch") {
    int idx = doc["index"] | 0;
    if (idx >= 0 && idx < (int)mbLayoutCount) {
      mbActiveLayoutIdx = (uint8_t)idx;
      prefs.begin("config", false);
      prefs.putUChar("mbActiveLayout", mbActiveLayoutIdx);
      prefs.end();
      bleNotify("{\"type\":\"ack\",\"action\":\"mb_layout_switch\",\"active\":" + String(mbActiveLayoutIdx) +
                ",\"name\":\"" + String(mbLayouts[idx].name) + "\"}");
    } else {
      bleNotify("{\"type\":\"ack\",\"action\":\"mb_layout_switch\",\"ok\":false}");
    }
  }

  // ── MagicBand config ──
  else if (type == "mb_config") {
    if (doc.containsKey("enabled"))    magicBandEnabled   = doc["enabled"].as<bool>();
    if (doc.containsKey("five_point")) magicBandFivePoint = doc["five_point"].as<bool>();
    if (doc.containsKey("timeout_ms")) magicBandTimeoutMs = (unsigned long)doc["timeout_ms"].as<long>();
    prefs.begin("config", false);
    prefs.putBool("mbEn", magicBandEnabled);
    prefs.putBool("mb5pt", magicBandFivePoint);
    prefs.putULong("mbTimeout", magicBandTimeoutMs);
    prefs.end();
    String ack = "{\"type\":\"ack\",\"action\":\"mb_config\","
                 "\"enabled\":" + String(magicBandEnabled ? "true" : "false") + ","
                 "\"five_point\":" + String(magicBandFivePoint ? "true" : "false") + ","
                 "\"timeout_ms\":" + String(magicBandTimeoutMs) + "}";
    bleNotify(ack);
  }

  // ── Status ──
  else if (type == "status") {
    bleNotify(
      "{\"type\":\"status\","
      "\"override\":" + String((int)currentOverride) + ","
      "\"kill_on_zone\":" + String(overrideKillOnZone ? "true" : "false") + ","
      "\"brightness\":" + String(currentBrightness) + ","
      "\"preset\":\"" + currentPresetId + "\","
      "\"wifi\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") + ","
      "\"sw_enabled\":" + String(starlightEnabled ? "true" : "false") + ","
      "\"sw_timeout_ms\":" + String(starlightTimeoutMs) + ","
      "\"mb_enabled\":" + String(magicBandEnabled ? "true" : "false") + ","
      "\"mb_five_point\":" + String(magicBandFivePoint ? "true" : "false") + ","
      "\"mb_timeout_ms\":" + String(magicBandTimeoutMs) + ","
      "\"ble_transition_ms\":" + String(bleEffectTransitionMs) + ","
      "\"mb_chase_speed\":" + String(mbChaseSpeed) + ","
      "\"mb_chase_thickness\":" + String(mbChaseThickness) + ","
      "\"mb_layout_active\":" + String((int)mbActiveLayoutIdx) + ","
      "\"mb_layout_name\":\"" + String(mbLayoutCount > 0 ? mbLayouts[mbActiveLayoutIdx].name : "Default") + "\","
      "\"mb_layout_count\":" + String((int)mbLayoutCount) + ","
      "\"show_type\":\"" + String(showTypeStatusStr()) + "\","
      "\"show_phase\":\"" + String(showPhaseStatusStr()) + "\","
      "\"scan_log\":" + String(bleScanLogEnabled ? "true" : "false") + ","
      "\"capture_active\":" + String(bleCaptureToApp ? "true" : "false") +
      "}"
    );
  }
  else {
    Serial.printf("[BLE] Unknown type: %s\n", type.c_str());
  }
}

// ─────────────────────────────────────────────
// BLE PERIPHERAL
// ─────────────────────────────────────────────

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* server, NimBLEConnInfo& connInfo) override {
    bleConnected = true;
    Serial.println("[BLE] App connected");
  }
  void onDisconnect(NimBLEServer* server, NimBLEConnInfo& connInfo, int reason) override {
    bleConnected = false;
    resetCmdChunkBuffer();
    Serial.println("[BLE] App disconnected — restarting advertising");
    NimBLEDevice::startAdvertising();
  }
};

class CommandCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* chr, NimBLEConnInfo& connInfo) override {
    String val = chr->getValue().c_str();
    Serial.printf("[BLE] Received: %s\n", val.c_str());
    handleBLECommand(val);
  }
};

void startBLEPeripheral() {
  bleServer = NimBLEDevice::createServer();
  bleServer->setCallbacks(new ServerCallbacks());

  NimBLEService* svc = bleServer->createService(SERVICE_UUID);

  NimBLECharacteristic* cmdChar = svc->createCharacteristic(
    CMD_CHAR_UUID,
    NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
  );
  cmdChar->setCallbacks(new CommandCallbacks());

  notifyChar = svc->createCharacteristic(NOTIFY_CHAR_UUID, NIMBLE_PROPERTY::NOTIFY);

  svc->start();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  NimBLEAdvertisementData advData;
  advData.setCompleteServices(NimBLEUUID(SERVICE_UUID));
  advData.setName(BLE_NAME);
  adv->setAdvertisementData(advData);
  adv->start();

  Serial.printf("[BLE] Peripheral advertising as: %s\n", BLE_NAME);
}

// ─────────────────────────────────────────────
// WAND TX BEACON — advertise as another Starlight wand (pairing / cast tests)
// ─────────────────────────────────────────────

void refreshBleAdvertising(const uint8_t* disneyPayload, size_t plen) {
  NimBLEAdvertisementData advData;
  advData.setName(BLE_NAME);
  advData.setCompleteServices(NimBLEUUID(SERVICE_UUID));
  if (disneyPayload && plen > 0) {
    uint8_t mfr[32];
    mfr[0] = 0x83;
    mfr[1] = 0x01;
    memcpy(mfr + 2, disneyPayload, plen);
    advData.setManufacturerData(std::string((char*)mfr, plen + 2));
  }
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setAdvertisementData(advData);
  adv->start();
}

void startWandTxCast(uint8_t palette, uint32_t durationMs) {
  wandTxCastPalette = palette & 0x1F;
  wandTxCastUntil = millis() + durationMs;
  Serial.printf("[WandTX] Cast palette=%u for %ums\n", wandTxCastPalette, durationMs);
}

void serviceWandTx() {
  unsigned long now = millis();
  bool casting = now < wandTxCastUntil;
  if (!wandTxBeacon && !casting) return;
  if (now - wandTxLastAdvMs < 200) return;
  wandTxLastAdvMs = now;

  if (casting) {
    uint8_t payload[13];
    memcpy(payload, WAND_CAST_SIG, 6);
    for (int i = 6; i < 12; i++) payload[i] = (uint8_t)random(0, 256);
    payload[12] = wandTxCastPalette;
    refreshBleAdvertising(payload, 13);
    return;
  }

  if (wandTxBeacon) {
    uint8_t idle[19];
    memcpy(idle, WAND_IDLE_PAYLOAD, 19);
    idle[18] = (uint8_t)((now / 500) & 0xFF);
    refreshBleAdvertising(idle, 19);
  }
}

// ─────────────────────────────────────────────
// BLE SCANNER — Disney 0x0183 (Adafruit CLUE_BLE_Beacon_Remote protocol)
// ─────────────────────────────────────────────

// Starlight Wand color-cast signature (13-byte payload after 0x8301 CID)

void paletteToRGB(uint8_t idx, uint8_t& r, uint8_t& g, uint8_t& b) {
  idx &= 0x1F;
  r = mbWledColors[idx][0];
  g = mbWledColors[idx][1];
  b = mbWledColors[idx][2];
}

// Strip 0x8301 company ID if present; payload is what Adafruit stores in command_library
void disneyPayload(const uint8_t* data, size_t len, const uint8_t*& payload, size_t& plen) {
  if (len >= 2 && data[0] == 0x83 && data[1] == 0x01) {
    payload = data + 2;
    plen = len - 2;
  } else {
    payload = data;
    plen = len;
  }
}

bool isWandCast(const uint8_t* payload, size_t plen) {
  return plen == WAND_CAST_LEN && memcmp(payload, WAND_CAST_SIG, 6) == 0;
}

bool isWandIdleBeacon(const uint8_t* payload, size_t plen) {
  return plen >= 4 && payload[0] == 0x0F && payload[1] == 0x11;
}

// Older community / wiki captures used CF9B (variable length, palette = last byte)
bool isLegacyCf9bCast(const uint8_t* payload, size_t plen) {
  return plen >= 8 && payload[0] == 0xCF && payload[1] == 0x9B;
}

bool isDisneyMfr(const uint8_t* data, size_t len) {
  if (len >= 2 && data[0] == 0x83 && data[1] == 0x01) return true;
  const uint8_t* p;
  size_t pl;
  disneyPayload(data, len, p, pl);
  return isWandCast(p, pl) || isLegacyCf9bCast(p, pl) || isWandIdleBeacon(p, pl)
      || (pl >= 1 && (p[0] == 0xCC || p[0] == 0xE1 || p[0] == 0xE2 || p[0] == 0xE9));
}

const char* classifyScanPacket(const uint8_t* data, size_t len) {
  const uint8_t* p;
  size_t pl;
  disneyPayload(data, len, p, pl);
  if (isWandCast(p, pl)) return "WAND-CAST";
  if (isLegacyCf9bCast(p, pl)) return "WAND-CF9B";
  if (isWandIdleBeacon(p, pl)) return "WAND-IDLE";
  if (pl >= 2 && p[0] == 0xCC && p[1] == 0x03) return "PING";
  if (pl >= 5 && (p[0] == 0xE1 || p[0] == 0xE2) && p[2] == 0xE9) return "MB+";
  if (pl >= 2 && p[0] == 0xE9) return "SHOW";
  return "DISNEY";
}

// Format manufacturer data as hex for app debug feed (truncated)
String mfrToHex(const uint8_t* data, size_t len) {
  String hex = "";
  for (size_t i = 0; i < len && i < 32; i++) {
    if (data[i] < 0x10) hex += "0";
    hex += String(data[i], HEX);
  }
  return hex;
}

String mfrToHexFull(const uint8_t* data, size_t len, size_t maxLen = 64) {
  String hex = "";
  size_t n = len < maxLen ? len : maxLen;
  for (size_t i = 0; i < n; i++) {
    if (data[i] < 0x10) hex += "0";
    hex += String(data[i], HEX);
  }
  if (len > maxLen) hex += "…";
  return hex;
}

// Returns true when payload differs from previous scan (updates dedup state)
bool scanDedupIsNew(const uint8_t* data, size_t len) {
  size_t cmpLen = len < 48 ? len : 48;
  bool same = (cmpLen == lastLogLen && memcmp(data, lastLogBytes, cmpLen) == 0);
  if (same) {
    scanRepeatCount++;
    return false;
  }
  if (scanRepeatCount > 0) scanRepeatCount = 0;
  memcpy(lastLogBytes, data, cmpLen);
  lastLogLen = cmpLen;
  return true;
}

void stopBleCapture(const char* reason) {
  if (!bleCaptureToApp) return;
  bleCaptureToApp = false;
  bleCaptureUntilMs = 0;
  if (bleConnected) {
    bleNotify(String("{\"type\":\"ble_capture\",\"event\":\"stopped\",\"reason\":\"") + reason + "\"}");
  }
  Serial.printf("[Capture] stopped (%s)\n", reason);
}

void notifyBleCapturePacket(const char* tag, int rssi, const uint8_t* data, size_t len, bool isNew) {
  if (!bleCaptureToApp || !bleConnected || !isNew) return;

  if (bleCaptureUntilMs > 0 && millis() >= bleCaptureUntilMs) {
    stopBleCapture("timeout");
    return;
  }

  unsigned long now = millis();
  if (now - bleCaptureLastNotifyMs >= 1000) {
    bleCaptureLastNotifyMs = now;
    bleCaptureNotifyCount = 0;
  }
  if (bleCaptureNotifyCount >= 20) return;
  bleCaptureNotifyCount++;

  String hex = mfrToHexFull(data, len);
  String msg = "{\"type\":\"ble_packet\",\"tag\":\"" + String(tag) +
               "\",\"rssi\":" + String(rssi) +
               ",\"len\":" + String(len) +
               ",\"hex\":\"" + hex +
               "\",\"ts\":" + String(now) + "}";
  bleNotify(msg);
}

// Rate-limited debug notify → app Home event feed
void notifySwDebug(const char* reason, const uint8_t* data, size_t len) {
  unsigned long now = millis();
  if (now - swDebugLastNotify < 400) return;
  swDebugLastNotify = now;
  String msg = "{\"type\":\"sw_debug\",\"reason\":\"" + String(reason) +
               "\",\"hex\":\"" + mfrToHex(data, len) + "\",\"len\":" + String(len) + "}";
  bleNotify(msg);
  Serial.printf("[SW] debug: %s len=%u hex=%s\n", reason, (unsigned)len, mfrToHex(data, len).c_str());
}

// Serial-only: Disney BLE packets — highlights NEW vs repeated payloads
void serialLogScanPacket(const char* tag, int rssi, const uint8_t* data, size_t len, bool isNew) {
  if (!bleScanLogEnabled) return;
  unsigned long now = millis();

  if (!isNew) {
    if (now - scanRepeatSummaryMs < 3000) return;
    scanRepeatSummaryMs = now;
    Serial.printf("[Scan:%s] rssi=%d len=%u (same x%u) ", tag, rssi, (unsigned)len, scanRepeatCount);
  } else {
    if (scanRepeatCount > 0) {
      Serial.printf("[Scan] ↳ prior packet repeated %u times\n", scanRepeatCount);
      scanRepeatCount = 0;
    }
    Serial.printf("[Scan:%s] rssi=%d len=%u NEW ", tag, rssi, (unsigned)len);
  }

  size_t cmpLen = len < 48 ? len : 48;
  for (size_t i = 0; i < cmpLen; i++) {
    if (data[i] < 0x10) Serial.print('0');
    Serial.print(data[i], HEX);
  }
  if (len > 48) Serial.print("…");
  Serial.println();
}

// Log any manufacturer data during sniff window (wand button debug)
void serialLogSniffPacket(int rssi, const uint8_t* data, size_t len) {
  if (millis() >= bleSniffUntilMs) return;
  Serial.printf("[Sniff] rssi=%d len=%u ", rssi, (unsigned)len);
  size_t n = len < 64 ? len : 64;
  for (size_t i = 0; i < n; i++) {
    if (data[i] < 0x10) Serial.print('0');
    Serial.print(data[i], HEX);
  }
  if (len > 64) Serial.print("…");
  Serial.println();
}

void notifyWandPalette(uint8_t paletteIdx, OverrideSource src) {
  uint8_t r, g, b;
  paletteToRGB(paletteIdx, r, g, b);
  if (!canTakeOverride(src)) {
    if (src == BLE_STARLIGHT) bleNotify("{\"type\":\"sw_event\",\"event\":\"blocked\"}");
    return;
  }
  uint8_t pals[1] = { paletteIdx };
  if (applySwAnimationKey("wand", pals, 1, src)) {
    if (src == BLE_STARLIGHT) {
      bleNotify("{\"type\":\"sw_color\",\"palette\":" + String(paletteIdx) +
                ",\"r\":" + String(r) + ",\"g\":" + String(g) + ",\"b\":" + String(b) + "}");
    }
    return;
  }
  if (applyMbAnimationKey("wand", pals, 1, src)) {
    if (src == BLE_STARLIGHT) {
      bleNotify("{\"type\":\"sw_color\",\"palette\":" + String(paletteIdx) +
                ",\"r\":" + String(r) + ",\"g\":" + String(g) + ",\"b\":" + String(b) + "}");
    }
    return;
  }
  applyMbSegmentSolid("all", paletteIdx, src);
  if (src == BLE_STARLIGHT) {
    bleNotify("{\"type\":\"sw_color\",\"palette\":" + String(paletteIdx) +
              ",\"r\":" + String(r) + ",\"g\":" + String(g) + ",\"b\":" + String(b) + "}");
  }
}

// Starlight Wand color cast — 13-byte payload, sig CF0B00C42022, palette @ byte 12
void handleWandCast(const uint8_t* payload, size_t plen) {
  if (!isWandCast(payload, plen)) return;

  // Repeat adverts from one button press: extend idle timer only (no WLED spam)
  if (wandCastIsDuplicateAdvert(payload, plen)) {
    if (starlightEnabled && currentOverride == BLE_STARLIGHT) {
      touchOverrideIdleTimer(BLE_STARLIGHT);
    }
    return;
  }
  rememberWandCast(payload, plen);

  uint8_t paletteIdx = payload[12] & 0x1F;
  Serial.printf("[Wand] CAST palette=%u roll=%02X%02X%02X%02X%02X%02X\n",
                paletteIdx, payload[6], payload[7], payload[8],
                payload[9], payload[10], payload[11]);
  notifySwDebug("wand_cast", payload, plen);

  if (!starlightEnabled) {
    bleNotify("{\"type\":\"sw_event\",\"event\":\"disabled\"}");
    return;
  }
  notifyWandPalette(paletteIdx, BLE_STARLIGHT);
}

// CF9B wiki format — palette in last byte
void handleLegacyCf9bCast(const uint8_t* payload, size_t plen) {
  if (!isLegacyCf9bCast(payload, plen)) return;

  if (wandCastIsDuplicateAdvert(payload, plen)) {
    if (starlightEnabled && currentOverride == BLE_STARLIGHT) {
      touchOverrideIdleTimer(BLE_STARLIGHT);
    }
    return;
  }
  rememberWandCast(payload, plen);

  uint8_t paletteIdx = payload[plen - 1] & 0x1F;
  Serial.printf("[Wand] CF9B legacy cast palette=%u len=%u\n", paletteIdx, (unsigned)plen);
  notifySwDebug("wand_cf9b", payload, plen);

  if (!starlightEnabled) {
    bleNotify("{\"type\":\"sw_event\",\"event\":\"disabled\"}");
    return;
  }
  notifyWandPalette(paletteIdx, BLE_STARLIGHT);
}

void applyMbAnimOpcode(const char* animKey, const char* label) {
  if (!magicBandEnabled) return;
  if (!canTakeOverride(BLE_MAGIC)) return;
  if (applyMbAnimationKey(animKey, nullptr, 0, BLE_MAGIC)) {
    bleNotify("{\"type\":\"ble_event\",\"event\":\"" + String(label) + "\"}");
    return;
  }
  saveWledStateForOverride();
  uint8_t activeIds[1] = { 0 };
  uint8_t activeCount = 1;
  String body = "{\"on\":true,\"seg\":[";
  bool first = true;
  appendDisableInactiveSegments(body, first, activeIds, activeCount, false);
  body += "{\"id\":0,\"start\":0,\"stop\":" + String(STRIP_LED_COUNT) + ",\"fx\":0}";
  body += "]}";
  sendToWLEDForBleEffect(body);
  setOverride(BLE_MAGIC);
  touchOverrideIdleTimer(BLE_MAGIC);
  bleNotify("{\"type\":\"ble_event\",\"event\":\"" + String(label) + "\"}");
}

// E1/E2-wrapped MagicBand+ commands (payload after 0x8301)
void handleE1E2Payload(const uint8_t* payload, size_t plen) {
  if (plen < 5 || payload[2] != 0xE9) return;

  if (mbEffectIsRepeatAdvert(payload, plen)) {
    if (magicBandEnabled) touchOverrideIdleTimer(BLE_MAGIC);
    return;
  }

  pendingMbEffectPayload = payload;
  pendingMbEffectPayloadLen = plen;
  struct MbPendingGuard {
    ~MbPendingGuard() {
      pendingMbEffectPayload = nullptr;
      pendingMbEffectPayloadLen = 0;
    }
  } mbPendingGuard;

  uint16_t func = ((uint16_t)payload[2] << 8) | payload[3];
  Serial.printf("[MB+] func=0x%04X len=%u\n", func, (unsigned)plen);

  switch (func) {
    case 0xE905:
      if (!magicBandEnabled || !canTakeOverride(BLE_MAGIC)) return;
      if (plen < 9) return;
      applyMbSingleE905(payload, BLE_MAGIC);
      {
        uint8_t r, g, b;
        paletteToRGB(decodeE905Palette(payload), r, g, b);
        bleNotify("{\"type\":\"ble_color\",\"r\":" + String(r) + ",\"g\":" + String(g) + ",\"b\":" + String(b) + "}");
      }
      break;
    case 0xE906:
      if (!magicBandEnabled || !canTakeOverride(BLE_MAGIC)) return;
      if (plen < 10) return;
      applyMbDual(payload[7], payload[8], BLE_MAGIC);
      {
        uint8_t r, g, b;
        paletteToRGB(payload[8] & 0x1F, r, g, b);
        bleNotify("{\"type\":\"ble_color\",\"r\":" + String(r) + ",\"g\":" + String(g) + ",\"b\":" + String(b) + "}");
      }
      break;
    case 0xE908: {
      if (!magicBandEnabled || !canTakeOverride(BLE_MAGIC)) return;
      if (plen < 12) return;
      uint8_t r = ((payload[8] >> 1) & 0x3F) * 4;
      uint8_t g = ((payload[9] >> 1) & 0x3F) * 4;
      uint8_t b = ((payload[10] >> 1) & 0x3F) * 4;
      applyFullStripSolid(r, g, b, BLE_MAGIC);
      bleNotify("{\"type\":\"ble_event\",\"event\":\"rgb\"}");
      break;
    }
    case 0xE909:
      if (!magicBandEnabled || !canTakeOverride(BLE_MAGIC)) return;
      if (plen < 13) return;
      {
        // Adafruit / park wire order: TL, BL, BR, TR, center (each 0xA0 | palette).
        uint8_t tl = payload[7] & 0x1F;
        uint8_t bl = payload[8] & 0x1F;
        uint8_t br = payload[9] & 0x1F;
        uint8_t tr = payload[10] & 0x1F;
        uint8_t c  = payload[11] & 0x1F;
        if (e909UsesPatternSlots(payload)) {
          char patKey[2] = { 0, 0 };
          const char* hex = "0123456789ABCDEF";
          uint8_t pat = (payload[7] >> 5) & 0x07;
          patKey[0] = hex[pat & 0x0F];
          uint8_t pals[5] = { tl, bl, br, tr, c };
          if (applyMbPatternKey(patKey, pals, 5, BLE_MAGIC)) break;
        }
        applyMbFive(tl, bl, br, tr, c, BLE_MAGIC);
        bleNotify("{\"type\":\"ble_event\",\"event\":\"five_color\"}");
      }
      break;
    case 0xE90C:
      if (!tryApplySwE9Payload(payload, plen, "E90C", "show_fx"))
        applyMbAnimOpcode("E90C", "show_fx");
      break;
    case 0xE90E:
      if (!tryApplySwE9Payload(payload, plen, "E90E", "flash"))
        applyMbAnimOpcode("E90E", "flash");
      break;
    case 0xE90F:
      if (magicBandEnabled && canTakeOverride(BLE_MAGIC)) {
        notifyUnknownAnimation(payload, plen, SW_MATCH_NONE, 0xE90F);
        applyMbAnimOpcode("E90F", "animation");
      }
      break;
    case 0xE910:
      if (!tryApplySwE9Payload(payload, plen, "E910", "animation"))
        applyMbAnimOpcode("E910", "animation");
      break;
    case 0xE911:
      if (!tryApplySwE9Payload(payload, plen, "E911", "animation"))
        applyMbAnimOpcode("E911", "animation");
      break;
    case 0xE912:
      if (!tryApplySwE9Payload(payload, plen, "E912", "animation"))
        applyMbAnimOpcode("E912", "animation");
      break;
    case 0xE913:
      if (!tryApplySwE9Payload(payload, plen, "E913", "animation"))
        applyMbAnimOpcode("E913", "animation");
      break;
    default:
      Serial.printf("[MB+] unhandled func 0x%04X\n", func);
      if (magicBandEnabled && canTakeOverride(BLE_MAGIC))
        bleNotify("{\"type\":\"ble_event\",\"event\":\"animation\"}");
      break;
  }
}

// Park show commands (direct E9, no E1/E2 wrapper)
void handleShowPayload(const uint8_t* payload, size_t plen) {
  if (plen < 2 || payload[0] != 0xE9) return;

  if (mbEffectIsRepeatAdvert(payload, plen)) {
    if (magicBandEnabled) touchOverrideIdleTimer(BLE_MAGIC);
    return;
  }

  pendingMbEffectPayload = payload;
  pendingMbEffectPayloadLen = plen;
  struct MbPendingGuard {
    ~MbPendingGuard() {
      pendingMbEffectPayload = nullptr;
      pendingMbEffectPayloadLen = 0;
    }
  } mbPendingGuard;

  Serial.printf("[MB+] show E9 %02X len=%u\n", payload[1], (unsigned)plen);
  if (tryApplySwE9Payload(payload, plen, "E90C", "show")) return;
  if (!magicBandEnabled) return;
  if (!canTakeOverride(BLE_MAGIC)) return;
  applyMbAnimOpcode("E90C", "show");
}

// Dispatch Disney manufacturer payload (after 0x8301 strip)
void handleDisneyPayload(const uint8_t* payload, size_t plen) {
  if (isWandCast(payload, plen)) {
    handleWandCast(payload, plen);
    return;
  }
  if (isLegacyCf9bCast(payload, plen)) {
    handleLegacyCf9bCast(payload, plen);
    return;
  }
  if (isWandIdleBeacon(payload, plen)) return;  // 0F11 identity beacon — not an effect

  if (plen >= 2 && payload[0] == 0xCC && payload[1] == 0x03) return;  // wake ping

  if (plen >= 5 && (payload[0] == 0xE1 || payload[0] == 0xE2) && payload[2] == 0xE9) {
    handleE1E2Payload(payload, plen);
    return;
  }
  if (plen >= 2 && payload[0] == 0xE9) {
    handleShowPayload(payload, plen);
  }
}

class DisneyBLEScanCallbacks : public NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice* device) {
    if (!device->haveManufacturerData()) return;
    std::string mfr = device->getManufacturerData();
    if (mfr.size() < 2) return;
    const uint8_t* data = (const uint8_t*)mfr.data();
    size_t len = mfr.size();
    int rssi = device->getRSSI();

    // Sniff mode: log everything (press wand button while this is active)
    if (millis() < bleSniffUntilMs) {
      serialLogSniffPacket(rssi, data, len);
    }

    if (!isDisneyMfr(data, len)) return;

    const char* tag = classifyScanPacket(data, len);
    bool isNew = scanDedupIsNew(data, len);
    serialLogScanPacket(tag, rssi, data, len, isNew);
    notifyBleCapturePacket(tag, rssi, data, len, isNew);

    const uint8_t* payload;
    size_t plen;
    disneyPayload(data, len, payload, plen);
    if (plen > 0) queueDisneyPayload(payload, plen);
  }
};

// ─────────────────────────────────────────────
// SERIAL DEBUG COMMANDS (USB @ 115200)
//   help          — command list
//   sniff [sec]   — log ALL manufacturer data (default 30s); press wand button now
// ─────────────────────────────────────────────

void processSerialCommands() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.length() == 0) return;

  if (line == "help") {
    Serial.println("[Serial] Commands:");
    Serial.println("  sniff [seconds]  — log every BLE mfr packet (default 30)");
    Serial.println("  sniff off        — stop sniffing");
    Serial.println("  tx on            — broadcast WAND-IDLE beacon (pairing test)");
    Serial.println("  tx off           — stop wand TX beacon");
    Serial.println("  tx cast <0-31>   — broadcast WAND-CAST for 3s");
    Serial.println("  chase speed <0-255>   — MB chase sx (0 = static)");
    Serial.println("  chase thick <1-50>    — MB chase grp (pixels per block)");
  } else if (line == "tx on") {
    wandTxBeacon = true;
    wandTxLastAdvMs = 0;
    Serial.println("[Serial] Wand TX idle beacon ON — physical wand should see another wand");
  } else if (line == "tx off") {
    wandTxBeacon = false;
    wandTxCastUntil = 0;
    refreshBleAdvertising(nullptr, 0);
    Serial.println("[Serial] Wand TX off — normal IllumaBuggy advertising");
  } else if (line.startsWith("tx cast")) {
    int pal = 4;
    int sp = line.indexOf(' ', 7);
    if (sp > 0) pal = line.substring(sp + 1).toInt();
    startWandTxCast((uint8_t)pal, 3000);
  } else if (line.startsWith("chase speed")) {
    int sp = line.indexOf(' ', 11);
    if (sp > 0) {
      mbChaseSpeed = (uint8_t)line.substring(sp + 1).toInt();
      prefs.begin("config", false);
      prefs.putUChar("mbSpd", mbChaseSpeed);
      prefs.end();
      Serial.printf("[Serial] Chase speed (sx) = %u\n", mbChaseSpeed);
    }
  } else if (line.startsWith("chase thick")) {
    int sp = line.indexOf(' ', 11);
    if (sp > 0) {
      mbChaseThickness = (uint8_t)line.substring(sp + 1).toInt();
      if (mbChaseThickness < 1) mbChaseThickness = 1;
      prefs.begin("config", false);
      prefs.putUChar("mbGrp", mbChaseThickness);
      prefs.end();
      Serial.printf("[Serial] Chase thickness (grp) = %u\n", mbChaseThickness);
    }
  } else if (line == "sniff off") {
    bleSniffUntilMs = 0;
    Serial.println("[Serial] Sniff off");
  } else if (line.startsWith("sniff")) {
    int sec = 30;
    int sp = line.indexOf(' ');
    if (sp > 0) sec = line.substring(sp + 1).toInt();
    if (sec < 1) sec = 30;
    bleSniffUntilMs = millis() + (unsigned long)sec * 1000UL;
    Serial.printf("[Serial] Sniffing ALL mfr data for %ds — press wand button now\n", sec);
  } else {
    Serial.printf("[Serial] Unknown: %s (type 'help')\n", line.c_str());
  }
}

void startBLEScan() {
  NimBLEScan* scan = NimBLEDevice::getScan();
  scan->setScanCallbacks(new DisneyBLEScanCallbacks(), true);
  scan->setActiveScan(true);   // wand may use scan response data
  scan->setInterval(80);
  scan->setWindow(79);
  scan->setDuplicateFilter(false);
  scan->start(0, false);
  Serial.println("[BLE] Scanner started (active, continuous, no dedup)");
  Serial.printf("[BLE] Scan logging: %s (WAND-CAST / WAND-IDLE / MB+ / PING)\n",
                bleScanLogEnabled ? "ON" : "OFF");
}

// ─────────────────────────────────────────────
// WIFI
// ─────────────────────────────────────────────

void connectToWLED() {
  if (WiFi.status() == WL_CONNECTED) { Serial.println("[WiFi] Already connected"); return; }
  WiFi.disconnect(false); delay(100);
  Serial.printf("[WiFi] Connecting to GLEDOPTO: %s\n", WLED_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WLED_SSID, WLED_PASS);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
    delay(500);
    snapshotWledBaseline();
    ensureWledPowerOn();
    wledWasConnected = true;
  } else {
    Serial.println("\n[WiFi] Failed — will retry");
  }
}

// ─────────────────────────────────────────────
// SETUP & LOOP
// ─────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[Boot] StrollerController v2.1");

  // Load NVS config
  prefs.begin("config", true);
  starlightEnabled    = prefs.getBool("swEn", true);
  starlightTimeoutMs  = prefs.getULong("swTimeout", 15000);
  magicBandEnabled    = prefs.getBool("mbEn", true);
  magicBandFivePoint  = prefs.getBool("mb5pt", true);
  overrideKillOnZone  = prefs.getBool("killOnZone", false);
  magicBandTimeoutMs  = prefs.getULong("mbTimeout", 15000);
  bleEffectTransitionMs = prefs.getULong("bleTransMs", 700);
  mbChaseSpeed        = prefs.getUChar("mbSpd", 128);
  mbChaseThickness    = prefs.getUChar("mbGrp", 4);
  if (mbChaseThickness < 1) mbChaseThickness = 4;
  bleScanLogEnabled   = prefs.getBool("scanLog", true);
  mbMappingJson       = prefs.getString("mbMapping", "");
  mbLayoutsJson       = prefs.getString("mbLayouts", "");
  mbActiveLayoutIdx   = prefs.getUChar("mbActiveLayout", 0);
  showLookParadePre     = prefs.getString("showParaPre", "");
  showLookParadeLive    = prefs.getString("showParaLive", "");
  showLookFireworksPre  = prefs.getString("showFwPre", "");
  showLookFireworksLive = prefs.getString("showFwLive", "__BLACK__");
  showLookFireworksPost = prefs.getString("showFwPost", "");
  prefs.end();
  loadMbMappingDefaults();
  if (mbLayoutsJson.length() > 0) loadMbLayoutsFromJson();
  loadMbMappingFromJson();
  loadWledBaselineFromNvs();
  Serial.printf("[NVS] swEn=%d mbEn=%d mb5pt=%d killOnZone=%d scanLog=%d chase=%u/%u bleFade=%lums\n",
                starlightEnabled, magicBandEnabled, magicBandFivePoint, overrideKillOnZone,
                bleScanLogEnabled, mbChaseSpeed, mbChaseThickness, bleEffectTransitionMs);

  prefs.begin("presets", false);
  prefs.end();
  Serial.println("[NVS] Ready");

  NimBLEDevice::init(BLE_NAME);
  delay(200);
  startBLEPeripheral();
  startBLEScan();

  // Create command queue (10 slots)
  cmdQueue = xQueueCreate(10, sizeof(PendingCmd));

  xTaskCreatePinnedToCore(
    [](void*) { connectToWLED(); vTaskDelete(NULL); },
    "WiFiTask", 4096, NULL, 1, NULL, 1
  );

  Serial.println("[Boot] Ready");
  Serial.println("[Serial] Type 'help' for sniff / debug commands");
}

void processPendingCommands() {
  PendingCmd cmd;
  // Process up to 3 commands per loop iteration
  for (int i = 0; i < 3; i++) {
    if (xQueueReceive(cmdQueue, &cmd, 0) != pdTRUE) break;

    Serial.printf("[Queue] Processing: %s\n", cmd.type);

    if (strcmp(cmd.type, "preset_list") == 0) {
      String presets = getAllPresets();
      bleNotifyChunked("preset_chunk", presets);
    }
    else if (strcmp(cmd.type, "wled_get_effects") == 0) {
      String body = getFromWLED("/json/eff");
      if (body.length() > 0) bleNotifyChunked("wled_effects", body);
      else bleNotify("{\"type\":\"error\",\"msg\":\"Failed to fetch effects\"}");
    }
    else if (strcmp(cmd.type, "wled_get_palettes") == 0) {
      String body = getFromWLED("/json/pal");
      if (body.length() > 0) bleNotifyChunked("wled_palettes", body);
      else bleNotify("{\"type\":\"error\",\"msg\":\"Failed to fetch palettes\"}");
    }
    else if (strcmp(cmd.type, "wled_get_fxdata") == 0) {
      String body = getFromWLED("/json/fxdata");
      if (body.length() > 0) bleNotifyChunked("wled_fxdata", body);
      else bleNotify("{\"type\":\"error\",\"msg\":\"Failed to fetch fxdata\"}");
    }
    else if (strcmp(cmd.type, "wled_get_state") == 0) {
      String body = getFromWLED("/json/si");
      if (body.length() > 0) bleNotifyChunked("wled_state", body);
      else bleNotify("{\"type\":\"error\",\"msg\":\"Failed to fetch state\"}");
    }
  }
}

void loop() {
  processDisneyPayloadQueue();
  processSerialCommands();
  processPendingCommands();
  serviceWandTx();

  // Auto-clear Starlight Wand override after timeout
  if (currentOverride == BLE_STARLIGHT && starlightTimeoutMs > 0) {
    if (millis() - swEventTimestamp >= starlightTimeoutMs) {
      Serial.printf("[SW] Timeout after %lums — restoring state\n", starlightTimeoutMs);
      clearOverride();
      bleNotify("{\"type\":\"sw_event\",\"event\":\"timeout\"}");
    }
  }

  // Auto-clear MagicBand override after timeout
  if (currentOverride == BLE_MAGIC && magicBandTimeoutMs > 0) {
    if (millis() - mbEventTimestamp >= magicBandTimeoutMs) {
      Serial.printf("[MB] Timeout after %lums — restoring state\n", magicBandTimeoutMs);
      clearOverride();
      bleNotify("{\"type\":\"ble_event\",\"event\":\"timeout\"}");
    }
  }

  if (bleCaptureToApp && bleCaptureUntilMs > 0 && millis() >= bleCaptureUntilMs) {
    stopBleCapture("timeout");
  }

  if (WiFi.status() != WL_CONNECTED) {
    unsigned long now = millis();
    if (now - lastWifiRetry > WIFI_RETRY_MS) {
      lastWifiRetry = now;
      Serial.println("[WiFi] Reconnecting...");
      connectToWLED();
    }
    wledWasConnected = false;
  } else if (!wledWasConnected) {
    wledWasConnected = true;
    snapshotWledBaseline();
  } else {
    pollLiveWledState();
  }
  delay(10);
}
