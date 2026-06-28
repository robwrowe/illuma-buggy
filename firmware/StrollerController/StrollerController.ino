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

// MagicBand segment LED indices (50 nodes, 0-based)
// Corner segments: nodes near physical corners of stroller
// Center segment: middle of the strip
#define SEG_TL_START  0
#define SEG_TL_STOP   12
#define SEG_TR_START  13
#define SEG_TR_STOP   25
#define SEG_BL_START  26
#define SEG_BL_STOP   37
#define SEG_BR_START  38
#define SEG_BR_STOP   49
#define SEG_CTR_LED   24  // single center LED (index into strip)

// ─────────────────────────────────────────────
// GLOBALS
// ─────────────────────────────────────────────
Preferences prefs;

NimBLEServer*         bleServer    = nullptr;
NimBLECharacteristic* notifyChar   = nullptr;
bool                  bleConnected = false;

enum OverrideSource { NONE, ZONE, MANUAL, BLE_MAGIC };
OverrideSource currentOverride    = NONE;
bool           overrideKillOnZone = false;
unsigned long  overrideTimestamp  = 0;

int    currentBrightness = 128;
String currentPresetId   = "";

// MagicBand config (persisted in NVS)
bool          magicBandFivePoint = true;   // true = 4 corners + center, false = 4 corners only
unsigned long magicBandTimeoutMs = 30000;  // ms before MB override auto-clears (0 = never)

// MagicBand timeout tracking
unsigned long mbEventTimestamp = 0;  // millis() when last MB event fired

// Pre-event WLED state (restored after MagicBand clears)
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
// SEGMENT SETUP
// Splits strip into 5 segments for MagicBand color effects
// ─────────────────────────────────────────────

void setupMagicBandSegments() {
  // Build segment array: TL, TR, BL, BR, Center
  String body = "{\"seg\":["
    "{\"id\":0,\"start\":" + String(SEG_TL_START) + ",\"stop\":" + String(SEG_TL_STOP) + ",\"on\":true},"
    "{\"id\":1,\"start\":" + String(SEG_TR_START) + ",\"stop\":" + String(SEG_TR_STOP) + ",\"on\":true},"
    "{\"id\":2,\"start\":" + String(SEG_BL_START) + ",\"stop\":" + String(SEG_BL_STOP) + ",\"on\":true},"
    "{\"id\":3,\"start\":" + String(SEG_BR_START) + ",\"stop\":" + String(SEG_BR_STOP) + ",\"on\":true},"
    "{\"id\":4,\"start\":" + String(SEG_CTR_LED)  + ",\"stop\":" + String(SEG_CTR_LED + 1) + ",\"on\":true}"
    "]}";
  sendToWLED(body);
  Serial.println("[Seg] MagicBand segments configured");
}

// Restore single-segment mode (all 50 LEDs, one segment)
void restoreSingleSegment() {
  sendToWLED("{\"seg\":[{\"id\":0,\"start\":0,\"stop\":50,\"on\":true},{\"id\":1,\"stop\":0},{\"id\":2,\"stop\":0},{\"id\":3,\"stop\":0},{\"id\":4,\"stop\":0}]}");
  Serial.println("[Seg] Restored single segment");
}

// ─────────────────────────────────────────────
// OVERRIDE LOGIC
// ─────────────────────────────────────────────

void setOverride(OverrideSource src) {
  currentOverride = src;
  overrideTimestamp = millis();
  Serial.printf("[Override] Set to %d\n", (int)src);
}

void clearOverride() {
  currentOverride = NONE;
  Serial.println("[Override] Cleared");
  // Restore saved state if we had one from a MagicBand event
  if (savedWledState.length() > 0) {
    sendToWLED(savedWledState);
    restoreSingleSegment();
    savedWledState = "";
  }
}

bool zoneWantsPreset(const String& presetId) {
  if (currentOverride == BLE_MAGIC || currentOverride == MANUAL) {
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

  // ── MagicBand config ──
  else if (type == "mb_config") {
    magicBandFivePoint = doc["five_point"].as<bool>();
    if (doc.containsKey("timeout_ms")) {
      magicBandTimeoutMs = (unsigned long)doc["timeout_ms"].as<long>();
    }
    prefs.begin("config", false);
    prefs.putBool("mb5pt", magicBandFivePoint);
    prefs.putULong("mbTimeout", magicBandTimeoutMs);
    prefs.end();
    String ack = "{\"type\":\"ack\",\"action\":\"mb_config\","
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
      "\"mb_five_point\":" + String(magicBandFivePoint ? "true" : "false") + "," +
      "\"mb_timeout_ms\":" + String(magicBandTimeoutMs) +
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
// BLE SCANNER — MagicBand+ E9 packets
// ─────────────────────────────────────────────

void handleMagicBandColor(const uint8_t* data, size_t len) {
  if (len < 5) return;
  uint8_t r = (data[2] & 0x3F) * 4;
  uint8_t g = (data[3] & 0x3F) * 4;
  uint8_t b = (data[4] & 0x3F) * 4;

  Serial.printf("[BLE] MagicBand color: R%d G%d B%d\n", r, g, b);

  // Save current WLED state so we can restore it after override clears
  String state = getFromWLED("/json/state");
  if (state.length() > 0) savedWledState = state;

  // Set up segments for corner/center effect
  setupMagicBandSegments();
  delay(100);

  // Build color payload for each active segment
  String color = "[[" + String(r) + "," + String(g) + "," + String(b) + "]]";
  String segPayload = "{\"seg\":["
    "{\"id\":0,\"col\":" + color + "},"
    "{\"id\":1,\"col\":" + color + "},"
    "{\"id\":2,\"col\":" + color + "},"
    "{\"id\":3,\"col\":" + color + "}";

  if (magicBandFivePoint) {
    segPayload += ",{\"id\":4,\"col\":" + color + "}";
  } else {
    // Turn off center segment
    segPayload += ",{\"id\":4,\"on\":false}";
  }
  segPayload += "]}";

  sendToWLED(segPayload);
  setOverride(BLE_MAGIC);
  mbEventTimestamp = millis();
  bleNotify("{\"type\":\"ble_color\",\"r\":" + String(r) + ",\"g\":" + String(g) + ",\"b\":" + String(b) + "}");
}

void handleMagicBandCommand(uint8_t cmd, const uint8_t* data, size_t len) {
  switch (cmd) {
    case 0x05:
      Serial.println("[BLE] MagicBand: vibrate");
      bleNotify("{\"type\":\"ble_event\",\"event\":\"vibrate\"}");
      break;
    case 0x06:
      Serial.println("[BLE] MagicBand: flash");
      sendToWLED("{\"on\":true,\"seg\":[{\"id\":0,\"fx\":0,\"col\":[[255,255,255]]}]}");
      setOverride(BLE_MAGIC);
  mbEventTimestamp = millis();
      bleNotify("{\"type\":\"ble_event\",\"event\":\"flash\"}");
      break;
    case 0x08:
      handleMagicBandColor(data, len);
      break;
    case 0x09:
      Serial.println("[BLE] MagicBand: fireworks");
      sendToWLED("{\"on\":true,\"seg\":[{\"id\":0,\"fx\":42}]}");
      setOverride(BLE_MAGIC);
  mbEventTimestamp = millis();
      bleNotify("{\"type\":\"ble_event\",\"event\":\"fireworks\"}");
      break;
    case 0x0b:
    case 0x0c:
    case 0x13:
      Serial.printf("[BLE] MagicBand: animation 0x%02X (stubbed)\n", cmd);
      bleNotify("{\"type\":\"ble_event\",\"event\":\"animation\"}");
      break;
    default:
      Serial.printf("[BLE] MagicBand: unknown cmd 0x%02X\n", cmd);
      break;
  }
}

class MagicBandScanCallbacks : public NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice* device) {
    if (!device->haveManufacturerData()) return;
    std::string mfr = device->getManufacturerData();
    if (mfr.size() < 4) return;
    const uint8_t* data = (const uint8_t*)mfr.data();
    if (data[2] != 0xE9) return;
    handleMagicBandCommand(data[3], data, mfr.size());
  }
};

void startBLEScan() {
  NimBLEScan* scan = NimBLEDevice::getScan();
  scan->setScanCallbacks(new MagicBandScanCallbacks(), true);
  scan->setActiveScan(false);
  scan->setInterval(100);
  scan->setWindow(99);
  scan->start(0, false);
  Serial.println("[BLE] Scanner started (passive, continuous)");
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
  magicBandFivePoint  = prefs.getBool("mb5pt", true);
  overrideKillOnZone  = prefs.getBool("killOnZone", false);
  magicBandTimeoutMs  = prefs.getULong("mbTimeout", 30000);
  prefs.end();
  Serial.printf("[NVS] mb5pt=%d killOnZone=%d\n", magicBandFivePoint, overrideKillOnZone);

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
  processPendingCommands();

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
