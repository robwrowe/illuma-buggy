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

void paletteToRGB(uint8_t idx, uint8_t& r, uint8_t& g, uint8_t& b);

// ─────────────────────────────────────────────
// GLOBALS
// ─────────────────────────────────────────────
Preferences prefs;

NimBLEServer*         bleServer    = nullptr;
NimBLECharacteristic* notifyChar   = nullptr;
bool                  bleConnected = false;

enum OverrideSource { NONE, ZONE, MANUAL, BLE_MAGIC, BLE_STARLIGHT };
OverrideSource currentOverride    = NONE;
bool           overrideKillOnZone = false;
unsigned long  overrideTimestamp  = 0;

int    currentBrightness = 128;
String currentPresetId   = "";

// BLE effect config (persisted in NVS)
// Priority (high → low): Starlight Wand > MagicBand+ > Manual > Zone
bool          starlightEnabled    = true;
unsigned long starlightTimeoutMs  = 30000;  // ms before wand effect auto-clears (0 = never)
bool          magicBandEnabled    = true;
bool          magicBandFivePoint  = true;   // true = 4 corners + center, false = 4 corners only
unsigned long magicBandTimeoutMs  = 30000;  // ms before MB override auto-clears (0 = never)
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

// Wand cast debounce (rolling auth bytes change every advert; palette is stable)
uint8_t       lastWandPalette = 0xFF;
unsigned long lastWandCastMs  = 0;

// Serial sniff mode — log every manufacturer packet (find wand button format)
unsigned long bleSniffUntilMs = 0;

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
String savedWledState = "";

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

bool sendToWLED(const String& jsonBody) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WLED] WiFi not connected");
    return false;
  }
  HTTPClient http;
  http.begin("http://" + String(WLED_IP) + ":" + String(WLED_PORT) + "/json/state");
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(2000);
  int code = http.POST(jsonBody);
  bool ok = (code == 200);
  if (!ok) Serial.printf("[WLED] POST failed: %d\n", code);
  http.end();
  return ok;
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

bool applyPreset(const String& id) {
  String preset = getPreset(id);
  if (preset.length() == 0) {
    Serial.printf("[Preset] Not found: %s\n", id.c_str());
    return false;
  }
  DynamicJsonDocument doc(2048);
  deserializeJson(doc, preset);
  String wledJson;
  serializeJson(doc["wled"], wledJson);
  currentPresetId = id;
  return sendToWLED(wledJson);
}

bool setBrightness(int bri) {
  currentBrightness = bri;
  return sendToWLED("{\"bri\":" + String(bri) + "}");
}

// ─────────────────────────────────────────────
// WLED EFFECTS — full-strip MagicBand chase / wand solid
// ─────────────────────────────────────────────

void restoreSingleSegment() {
  sendToWLED("{\"seg\":[{\"id\":0,\"start\":0,\"stop\":" + String(STRIP_LED_COUNT) +
             ",\"on\":true},{\"id\":1,\"stop\":0},{\"id\":2,\"stop\":0},"
             "{\"id\":3,\"stop\":0},{\"id\":4,\"stop\":0}]}");
  Serial.println("[Seg] Restored single segment (full strip)");
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
  return "{" + pd + ",\"seg\":[{\"id\":0,\"start\":0,\"stop\":" + String(STRIP_LED_COUNT) +
         ",\"fx\":" + String(WLED_CHASE_FX) + ",\"sx\":" + String(mbChaseSpeed) +
         ",\"grp\":" + String(mbChaseThickness) + ",\"pal\":" + String(WLED_MB_PAL_SLOT) +
         "},{\"id\":1,\"stop\":0},{\"id\":2,\"stop\":0},{\"id\":3,\"stop\":0},{\"id\":4,\"stop\":0}]}";
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
  sendToWLED(buildMagicBandChaseJson(paletteIdxs));
  setOverride(src);
  if (src == BLE_MAGIC) mbEventTimestamp = millis();
}

void applyMagicBandChaseFromAnchor(uint8_t anchorPalette, OverrideSource src) {
  uint8_t pals[5];
  for (int i = 0; i < 5; i++) pals[i] = (anchorPalette + (uint8_t)(i * 5)) & 0x1F;
  applyMagicBandChase(pals, src);
}

void applyFullStripSolid(uint8_t r, uint8_t g, uint8_t b, OverrideSource src) {
  if (!canTakeOverride(src)) return;
  if (WiFi.status() != WL_CONNECTED) {
    if (src == BLE_STARLIGHT) bleNotify("{\"type\":\"sw_event\",\"event\":\"wifi_down\"}");
    return;
  }
  saveWledStateForOverride();
  String body = "{\"seg\":[{\"id\":0,\"start\":0,\"stop\":" + String(STRIP_LED_COUNT) +
                ",\"fx\":0,\"col\":[[" + String(r) + "," + String(g) + "," + String(b) +
                "]]},{\"id\":1,\"stop\":0},{\"id\":2,\"stop\":0},{\"id\":3,\"stop\":0},{\"id\":4,\"stop\":0}]}";
  sendToWLED(body);
  setOverride(src);
  if (src == BLE_STARLIGHT) swEventTimestamp = millis();
  else if (src == BLE_MAGIC) mbEventTimestamp = millis();
}

// ─────────────────────────────────────────────
// OVERRIDE LOGIC
// Priority: Starlight Wand (4) > MagicBand+ (3) > Manual (2) > Zone (1)
// ─────────────────────────────────────────────

int overridePriority(OverrideSource src) {
  switch (src) {
    case ZONE:          return 1;
    case MANUAL:        return 2;
    case BLE_MAGIC:     return 3;
    case BLE_STARLIGHT: return 4;
    default:            return 0;
  }
}

bool canTakeOverride(OverrideSource incoming) {
  if (incoming == NONE) return false;
  if (currentOverride == NONE) return true;
  return overridePriority(incoming) >= overridePriority(currentOverride);
}

void setOverride(OverrideSource src) {
  currentOverride = src;
  overrideTimestamp = millis();
  Serial.printf("[Override] Set to %d\n", (int)src);
}

void saveWledStateForOverride() {
  if (savedWledState.length() > 0) return;
  String state = getFromWLED("/json/state");
  if (state.length() > 0) savedWledState = state;
}

void clearOverride() {
  currentOverride = NONE;
  Serial.println("[Override] Cleared");
  if (savedWledState.length() > 0) {
    sendToWLED(savedWledState);
    restoreSingleSegment();
    savedWledState = "";
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

void handleBLECommand(const String& msg) {
  DynamicJsonDocument doc(4096);
  DeserializationError err = deserializeJson(doc, msg);
  if (err) {
    Serial.printf("[BLE] JSON parse error: %s\n", err.c_str());
    return;
  }

  String type = doc["type"].as<String>();

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
  else if (type == "override_mode") {
    overrideKillOnZone = doc["kill_on_zone"].as<bool>();
    bleNotify("{\"type\":\"ack\",\"action\":\"override_mode\",\"kill_on_zone\":" + String(overrideKillOnZone ? "true" : "false") + "}");
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
      "\"mb_chase_speed\":" + String(mbChaseSpeed) + ","
      "\"mb_chase_thickness\":" + String(mbChaseThickness) + ","
      "\"scan_log\":" + String(bleScanLogEnabled ? "true" : "false") +
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

// Palette RGB — from Adafruit magicband_protocol.py (calibrated for LEDs)
static const uint8_t MB_PALETTE[32][3] = {
  { 80, 255, 255}, {180,   0, 255}, {  0,   0, 255}, {  0,  20, 120},
  { 40, 120, 255}, {200,  80, 255}, {200, 180, 255}, {120,   0, 255},
  {255,  60, 180}, {255,  70, 170}, {255,  80, 160}, {255,  90, 150},
  {255, 110, 150}, {255, 130, 160}, {255, 160, 170}, {255, 180,   0},
  {255, 220,   0}, {255, 140,  20}, {180, 255,   0}, {255,  90,   0},
  {255,  40,   0}, {255,   0,   0}, { 60, 255, 255}, { 40, 240, 255},
  { 20, 200, 255}, {  0, 255,   0}, { 80, 255,  40}, {255, 200, 180},
  {255, 200, 180}, {  0,   0,   0}, {255, 140,  60}, {255,   0, 255},
};

void paletteToRGB(uint8_t idx, uint8_t& r, uint8_t& g, uint8_t& b) {
  idx &= 0x1F;
  r = MB_PALETTE[idx][0];
  g = MB_PALETTE[idx][1];
  b = MB_PALETTE[idx][2];
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

// Format manufacturer data as hex for app debug feed
String mfrToHex(const uint8_t* data, size_t len) {
  String hex = "";
  for (size_t i = 0; i < len && i < 32; i++) {
    if (data[i] < 0x10) hex += "0";
    hex += String(data[i], HEX);
  }
  return hex;
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
void serialLogScanPacket(const char* tag, int rssi, const uint8_t* data, size_t len) {
  if (!bleScanLogEnabled) return;
  unsigned long now = millis();

  size_t cmpLen = len < 48 ? len : 48;
  bool same = (cmpLen == lastLogLen && memcmp(data, lastLogBytes, cmpLen) == 0);

  if (same) {
    scanRepeatCount++;
    if (now - scanRepeatSummaryMs < 3000) return;
    scanRepeatSummaryMs = now;
    Serial.printf("[Scan:%s] rssi=%d len=%u (same x%u) ", tag, rssi, (unsigned)len, scanRepeatCount);
  } else {
    if (scanRepeatCount > 0) {
      Serial.printf("[Scan] ↳ prior packet repeated %u times\n", scanRepeatCount);
      scanRepeatCount = 0;
    }
    memcpy(lastLogBytes, data, cmpLen);
    lastLogLen = cmpLen;
    Serial.printf("[Scan:%s] rssi=%d len=%u NEW ", tag, rssi, (unsigned)len);
  }

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

void notifyPaletteColor(uint8_t paletteIdx, OverrideSource src) {
  uint8_t r, g, b;
  paletteToRGB(paletteIdx, r, g, b);
  if (src == BLE_MAGIC) {
    if (!canTakeOverride(src)) {
      Serial.printf("[MB] palette blocked by override %d\n", (int)currentOverride);
      return;
    }
    applyMagicBandChaseFromAnchor(paletteIdx, BLE_MAGIC);
    bleNotify("{\"type\":\"ble_color\",\"r\":" + String(r) + ",\"g\":" + String(g) + ",\"b\":" + String(b) + "}");
    return;
  }
  if (!canTakeOverride(src)) {
    bleNotify("{\"type\":\"sw_event\",\"event\":\"blocked\"}");
    return;
  }
  applyFullStripSolid(r, g, b, BLE_STARLIGHT);
  bleNotify("{\"type\":\"sw_color\",\"palette\":" + String(paletteIdx) +
            ",\"r\":" + String(r) + ",\"g\":" + String(g) + ",\"b\":" + String(b) + "}");
}

// Starlight Wand color cast — 13-byte payload, sig CF0B00C42022, palette @ byte 12
void handleWandCast(const uint8_t* payload, size_t plen) {
  if (!isWandCast(payload, plen)) return;

  uint8_t paletteIdx = payload[12] & 0x1F;
  unsigned long now = millis();
  if (paletteIdx == lastWandPalette && now - lastWandCastMs < 600) return;
  lastWandPalette = paletteIdx;
  lastWandCastMs = now;

  Serial.printf("[Wand] CAST palette=%u roll=%02X%02X%02X%02X%02X%02X\n",
                paletteIdx, payload[6], payload[7], payload[8],
                payload[9], payload[10], payload[11]);
  notifySwDebug("wand_cast", payload, plen);

  if (!starlightEnabled) {
    bleNotify("{\"type\":\"sw_event\",\"event\":\"disabled\"}");
    return;
  }
  notifyPaletteColor(paletteIdx, BLE_STARLIGHT);
}

// CF9B wiki format — palette in last byte
void handleLegacyCf9bCast(const uint8_t* payload, size_t plen) {
  if (!isLegacyCf9bCast(payload, plen)) return;

  uint8_t paletteIdx = payload[plen - 1] & 0x1F;
  Serial.printf("[Wand] CF9B legacy cast palette=%u len=%u\n", paletteIdx, (unsigned)plen);
  notifySwDebug("wand_cf9b", payload, plen);

  if (!starlightEnabled) {
    bleNotify("{\"type\":\"sw_event\",\"event\":\"disabled\"}");
    return;
  }
  notifyPaletteColor(paletteIdx, BLE_STARLIGHT);
}

void applyMbAnimation(const char* label, int fxId, const char* extraSeg = nullptr) {
  if (!magicBandEnabled) return;
  if (!canTakeOverride(BLE_MAGIC)) return;
  saveWledStateForOverride();
  String body = "{\"on\":true,\"seg\":[{\"id\":0,\"start\":0,\"stop\":" + String(STRIP_LED_COUNT) +
                ",\"fx\":" + String(fxId);
  if (extraSeg) body += extraSeg;
  body += "},{\"id\":1,\"stop\":0},{\"id\":2,\"stop\":0},{\"id\":3,\"stop\":0},{\"id\":4,\"stop\":0}]}";
  sendToWLED(body);
  setOverride(BLE_MAGIC);
  mbEventTimestamp = millis();
  bleNotify("{\"type\":\"ble_event\",\"event\":\"" + String(label) + "\"}");
}

// E1/E2-wrapped MagicBand+ commands (payload after 0x8301)
void handleE1E2Payload(const uint8_t* payload, size_t plen) {
  if (!magicBandEnabled) return;
  if (plen < 5 || payload[2] != 0xE9) return;
  if (!canTakeOverride(BLE_MAGIC)) return;

  uint16_t func = ((uint16_t)payload[2] << 8) | payload[3];
  Serial.printf("[MB+] func=0x%04X len=%u\n", func, (unsigned)plen);

  switch (func) {
    case 0xE905:  // single palette color
      if (plen < 9) return;
      notifyPaletteColor(payload[7] & 0x1F, BLE_MAGIC);
      break;
    case 0xE906:  // dual palette — use outer ring color
      if (plen < 10) return;
      notifyPaletteColor(payload[8] & 0x1F, BLE_MAGIC);
      break;
    case 0xE908: {  // 6-bit RGB — full-strip chase with uniform color blocks
      if (plen < 12) return;
      uint8_t r = ((payload[8] >> 1) & 0x3F) * 4;
      uint8_t g = ((payload[9] >> 1) & 0x3F) * 4;
      uint8_t b = ((payload[10] >> 1) & 0x3F) * 4;
      if (!canTakeOverride(BLE_MAGIC)) return;
      saveWledStateForOverride();
      {
        static const int positions[5] = {0, 51, 102, 153, 204};
        String pd = "\"pd\":{\"" + String(WLED_MB_PAL_SLOT) + "\":[";
        for (int i = 0; i < 5; i++) {
          if (i > 0) pd += ",";
          pd += "[" + String(positions[i]) + "," + String(r) + "," + String(g) + "," + String(b) + "]";
        }
        pd += "]}";
        String body = "{" + pd + ",\"seg\":[{\"id\":0,\"start\":0,\"stop\":" + String(STRIP_LED_COUNT) +
                      ",\"fx\":" + String(WLED_CHASE_FX) + ",\"sx\":" + String(mbChaseSpeed) +
                      ",\"grp\":" + String(mbChaseThickness) + ",\"pal\":" + String(WLED_MB_PAL_SLOT) +
                      "},{\"id\":1,\"stop\":0},{\"id\":2,\"stop\":0},{\"id\":3,\"stop\":0},{\"id\":4,\"stop\":0}]}";
        sendToWLED(body);
        setOverride(BLE_MAGIC);
        mbEventTimestamp = millis();
      }
      bleNotify("{\"type\":\"ble_event\",\"event\":\"rgb\"}");
      break;
    }
    case 0xE909:  // five palette slots — full-strip chase
      if (plen < 13) return;
      {
        uint8_t pals[5] = {
          (uint8_t)(payload[7] & 0x1F),
          (uint8_t)(payload[10] & 0x1F),
          (uint8_t)(payload[8] & 0x1F),
          (uint8_t)(payload[9] & 0x1F),
          (uint8_t)(payload[11] & 0x1F),
        };
        applyMagicBandChase(pals, BLE_MAGIC);
        bleNotify("{\"type\":\"ble_event\",\"event\":\"five_color\"}");
      }
      break;
    case 0xE90C:
      applyMbAnimation("show_fx", 42);
      break;
    case 0xE90E:
      applyMbAnimation("flash", 0, ",\"col\":[[255,255,255]]");
      break;
    case 0xE911:
    case 0xE912:
    case 0xE913:
    case 0xE90F:
    case 0xE910:
      applyMbAnimation("animation", 42);
      break;
    default:
      Serial.printf("[MB+] unhandled func 0x%04X\n", func);
      bleNotify("{\"type\":\"ble_event\",\"event\":\"animation\"}");
      break;
  }
}

// Park show commands (direct E9, no E1/E2 wrapper)
void handleShowPayload(const uint8_t* payload, size_t plen) {
  if (!magicBandEnabled || plen < 2 || payload[0] != 0xE9) return;
  if (!canTakeOverride(BLE_MAGIC)) return;
  Serial.printf("[MB+] show E9 %02X len=%u\n", payload[1], (unsigned)plen);
  applyMbAnimation("show", 42);
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

    serialLogScanPacket(classifyScanPacket(data, len), rssi, data, len);

    const uint8_t* payload;
    size_t plen;
    disneyPayload(data, len, payload, plen);
    handleDisneyPayload(payload, plen);
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
    delay(1000);
    sendToWLED("{\"on\":true,\"bri\":40}");
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
  starlightTimeoutMs  = prefs.getULong("swTimeout", 30000);
  magicBandEnabled    = prefs.getBool("mbEn", true);
  magicBandFivePoint  = prefs.getBool("mb5pt", true);
  overrideKillOnZone  = prefs.getBool("killOnZone", false);
  magicBandTimeoutMs  = prefs.getULong("mbTimeout", 30000);
  mbChaseSpeed        = prefs.getUChar("mbSpd", 128);
  mbChaseThickness    = prefs.getUChar("mbGrp", 4);
  if (mbChaseThickness < 1) mbChaseThickness = 4;
  bleScanLogEnabled   = prefs.getBool("scanLog", true);
  prefs.end();
  Serial.printf("[NVS] swEn=%d mbEn=%d mb5pt=%d killOnZone=%d scanLog=%d chase=%u/%u\n",
                starlightEnabled, magicBandEnabled, magicBandFivePoint, overrideKillOnZone,
                bleScanLogEnabled, mbChaseSpeed, mbChaseThickness);

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

  if (WiFi.status() != WL_CONNECTED) {
    unsigned long now = millis();
    if (now - lastWifiRetry > WIFI_RETRY_MS) {
      lastWifiRetry = now;
      Serial.println("[WiFi] Reconnecting...");
      connectToWLED();
    }
  }
  delay(10);
}
