/**
 * StrollerController Firmware v2.0
 * ESP32-S3-DevKitC-1-N16R8
 *
 * Architecture:
 *  - WiFi STA: connects to GLEDOPTO's WLED AP to forward commands
 *  - BLE Peripheral: companion app connects here via BLE (no WiFi needed on phone)
 *  - BLE Scanner: passive scan for MagicBand+ E9 advertising packets
 *  - NVS: preset storage
 *
 * BLE Services:
 *  - Command characteristic (write): app sends JSON commands
 *  - Notify characteristic (notify): board sends responses/events to app
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <NimBLEDevice.h>

// ─────────────────────────────────────────────
// CONFIG — edit these
// ─────────────────────────────────────────────

// GLEDOPTO WLED AP — connect to this in WLED's WiFi setup
// Leave as WLED default AP credentials
const char* WLED_SSID   = "StrollerNet";       // GLEDOPTO AP name
const char* WLED_PASS   = "stroller1234";      // GLEDOPTO AP password (WLED default)
const char* WLED_IP     = "4.3.2.1";       // WLED AP default gateway IP
const int   WLED_PORT   = 80;

// BLE device name (shows up on phone when pairing)
const char* BLE_NAME    = "IllumaBuggy";

// BLE UUIDs
#define SERVICE_UUID        "12345678-1234-1234-1234-123456789abc"
#define CMD_CHAR_UUID       "12345678-1234-1234-1234-123456789abd"   // write (app→board)
#define NOTIFY_CHAR_UUID    "12345678-1234-1234-1234-123456789abe"   // notify (board→app)

// ─────────────────────────────────────────────
// GLOBALS
// ─────────────────────────────────────────────

Preferences prefs;

// BLE
NimBLEServer*         bleServer       = nullptr;
NimBLECharacteristic* notifyChar      = nullptr;
bool                  bleConnected    = false;

// Override state
enum OverrideSource { NONE, ZONE, MANUAL, BLE_MAGIC };
OverrideSource currentOverride   = NONE;
bool           overrideKillOnZone = false;
unsigned long  overrideTimestamp  = 0;

// WLED state cache
int    currentBrightness = 128;
String currentPresetId   = "";

// WiFi reconnect
unsigned long lastWifiRetry = 0;
const int     WIFI_RETRY_MS = 5000;

// ─────────────────────────────────────────────
// BLE NOTIFY HELPER
// ─────────────────────────────────────────────

void bleNotify(const String& json) {
  if (!bleConnected || notifyChar == nullptr) return;
  notifyChar->setValue(json.c_str());
  notifyChar->notify();
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
    Serial.println("[WLED] WiFi not connected, skipping");
    return false;
  }
  HTTPClient http;
  String url = "http://" + String(WLED_IP) + ":" + String(WLED_PORT) + "/json/state";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(2000);
  int code = http.POST(jsonBody);
  bool ok = (code == 200);
  if (!ok) Serial.printf("[WLED] POST failed: %d\n", code);
  http.end();
  return ok;
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
  DynamicJsonDocument doc(2048);
  DeserializationError err = deserializeJson(doc, msg);
  if (err) {
    Serial.printf("[BLE] JSON parse error: %s\n", err.c_str());
    return;
  }

  String type = doc["type"].as<String>();

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
    // Split into chunks if needed — BLE MTU is typically 512 bytes
    String presets = getAllPresets();
    // Send in 500-byte chunks
    int total = presets.length();
    int offset = 0;
    int chunk = 500;
    while (offset < total) {
      String part = presets.substring(offset, min(offset + chunk, total));
      bool last = (offset + chunk >= total);
      bleNotify("{\"type\":\"preset_chunk\",\"last\":" + String(last ? "true" : "false") + ",\"data\":" + part + "}");
      offset += chunk;
      delay(20); // give BLE stack time to send
    }
  }
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
  else if (type == "brightness") {
    int bri = constrain(doc["value"].as<int>(), 0, 255);
    setBrightness(bri);
    bleNotify("{\"type\":\"ack\",\"action\":\"brightness\",\"value\":" + String(bri) + "}");
  }
  else if (type == "wled_raw") {
    String wled; serializeJson(doc["wled"], wled);
    bool ok = sendToWLED(wled);
    bleNotify("{\"type\":\"ack\",\"action\":\"wled_raw\",\"ok\":" + String(ok ? "true" : "false") + "}");
  }
  else if (type == "status") {
    bleNotify(
      "{\"type\":\"status\","
      "\"override\":" + String((int)currentOverride) + ","
      "\"kill_on_zone\":" + String(overrideKillOnZone ? "true" : "false") + ","
      "\"brightness\":" + String(currentBrightness) + ","
      "\"preset\":\"" + currentPresetId + "\","
      "\"wifi\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") +
      "}"
    );
  }
  else {
    Serial.printf("[BLE] Unknown type: %s\n", type.c_str());
  }
}

// ─────────────────────────────────────────────
// BLE PERIPHERAL — server + callbacks
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

  // Command characteristic — app writes commands here
  NimBLECharacteristic* cmdChar = svc->createCharacteristic(
    CMD_CHAR_UUID,
    NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
  );
  cmdChar->setCallbacks(new CommandCallbacks());

  // Notify characteristic — board pushes responses here
  notifyChar = svc->createCharacteristic(
    NOTIFY_CHAR_UUID,
    NIMBLE_PROPERTY::NOTIFY
  );

  svc->start();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);

  // Include complete local name in the main advertisement packet
  // so Android shows "IllumaBuggy" instead of the MAC address
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

  sendToWLED("{\"on\":true,\"seg\":[{\"col\":[[" +
    String(r) + "," + String(g) + "," + String(b) + "]]}]}");
  setOverride(BLE_MAGIC);
  bleNotify("{\"type\":\"ble_color\",\"r\":" + String(r) +
            ",\"g\":" + String(g) + ",\"b\":" + String(b) + "}");
}

void handleMagicBandCommand(uint8_t cmd, const uint8_t* data, size_t len) {
  switch (cmd) {
    case 0x05:
      Serial.println("[BLE] MagicBand: vibrate");
      bleNotify("{\"type\":\"ble_event\",\"event\":\"vibrate\"}");
      break;
    case 0x06:
      Serial.println("[BLE] MagicBand: flash");
      sendToWLED("{\"on\":true,\"seg\":[{\"fx\":0,\"col\":[[255,255,255]]}]}");
      setOverride(BLE_MAGIC);
      bleNotify("{\"type\":\"ble_event\",\"event\":\"flash\"}");
      break;
    case 0x08:
      handleMagicBandColor(data, len);
      break;
    case 0x09:
      Serial.println("[BLE] MagicBand: fireworks");
      sendToWLED("{\"on\":true,\"seg\":[{\"fx\":42}]}");
      setOverride(BLE_MAGIC);
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
// WIFI — connect to GLEDOPTO AP
// ─────────────────────────────────────────────

void connectToWLED() {
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
    // Wake GLEDOPTO — relay on GPIO18 needs explicit on command
    delay(1000);
    sendToWLED("{\"on\":true,\"bri\":80}");
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
  Serial.println("\n[Boot] StrollerController v2.0");

  // NVS
  prefs.begin("presets", false);
  prefs.end();
  Serial.println("[NVS] Ready");

  // BLE — init once, then start peripheral + scanner
  NimBLEDevice::init(BLE_NAME);
  delay(200);  // let BLE stack settle before advertising
  startBLEPeripheral();
  startBLEScan();

  // WiFi STA — connect to GLEDOPTO in background via FreeRTOS task
  // so BLE advertising is not blocked by WiFi connection attempts
  xTaskCreatePinnedToCore(
    [](void*) {
      connectToWLED();
      vTaskDelete(NULL);
    },
    "WiFiTask", 4096, NULL, 1, NULL, 1  // core 1
  );

  Serial.println("[Boot] Ready");
}

void loop() {
  // Reconnect to GLEDOPTO if WiFi drops
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
