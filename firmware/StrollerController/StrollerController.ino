/**
 * StrollerController Firmware v2.1
 * ESP32-S3-DevKitC-1-N16R8
 *
 * Modular split + optional dual-board scanner over UART.
 */

#if !CONFIG_IDF_TARGET_ESP32S3
#error "StrollerController requires Board = ESP32S3 Dev Module (N16R8). Classic ESP32 builds listen on UART RX=16 instead of RX=8."
#endif

#include "Globals.h"
#include "WiFiManager.h"
#include "WledClient.h"
#include "PresetStore.h"
#include "OverrideManager.h"
#include "MbMapping.h"
#include "MbRuleEngine.h"
#include "BlePeripheral.h"
#include "DisneyBleScan.h"
#include "PayloadTransport.h"
#include "SerialConsole.h"
#include "WandTx.h"
#include "DebugLog.h"
#include "NvsLargeString.h"
#include "MbRulesStore.h"
#include "MbCalibrationStore.h"
#include "StatusLed.h"
#include "SdRuleLogger.h"
#include "StatusDisplay.h"
#include "EmbeddedRules.h"
#include <ArduinoJson.h>

void setup() {
  Serial.begin(115200);
  delay(500);
  randomSeed(esp_random());
  Serial.println("\n[Boot] StrollerController v2.1");
  Serial.printf("[Boot] board=DevKitC-1-N16R8 pins uart TX=%d RX=%d led=%d oled=%d sd=%d\n",
                UART_LINK_TX_PIN, UART_LINK_RX_PIN, STATUS_LED_PIN,
                HAS_OLED, HAS_SD_LOGGER);
  Serial.printf("[Boot] freeHeap=%u maxAllocHeap=%u psramSize=%u psramFree=%u\n",
                (unsigned)ESP.getFreeHeap(),
                (unsigned)ESP.getMaxAllocHeap(),
                (unsigned)ESP.getPsramSize(),
                ESP.getPsramSize() ? (unsigned)ESP.getFreePsram() : 0u);

  mbCalibrationInitIdentity();

  // Load NVS config
  prefs.begin("config", true);
  starlightEnabled    = prefs.getBool("swEn", true);
  starlightTimeoutMs  = prefs.getULong("swTimeout", 15000);
  magicBandEnabled    = prefs.getBool("mbEn", true);
  mbDeferToApp        = prefs.getBool("mbDefer", false);
  overrideKillOnZone  = prefs.getBool("killOnZone", false);
  magicBandTimeoutMs  = prefs.getULong("mbTimeout", 15000);
  bleEffectTransitionMs = prefs.getULong("bleTransMs", 700);
  bleScanLogEnabled   = prefs.getBool("scanLog", true);
  mbUnmatchedLogEnabled = prefs.getBool("mbUnmatched", false);
  rulesPaused         = prefs.getBool("rulesPaused", false);
  // Prefer SPIFFS for large rules JSON; migrate leftover NVS blobs once.
  // Discard corrupt/empty blobs so a truncated legacy file doesn't look like a
  // successful load (rules=0) and block a clean "waiting for push" state.
  mbRulesFsBegin();
  mbRulesJson = mbRulesFsLoad();
  bool rulesOnFs = mbRulesJson.length() > 0;
  bool discardNvsRules = false;
  if (rulesOnFs && !mbRulesJsonUsable(mbRulesJson)) {
    Serial.printf("[Rules] discarded invalid/empty rules file (%u bytes) — waiting for push\n",
                  (unsigned)mbRulesJson.length());
    mbRulesFsClear();
    mbRulesJson = "";
    rulesOnFs = false;
  }
  if (!rulesOnFs) {
    String fromNvs = nvsGetLargeString(prefs, "mbRules", "");
    if (fromNvs.length() == 0) {
      fromNvs = nvsGetLargeString(prefs, "mbMapping", "");
    }
    if (fromNvs.length() > 0) {
      if (mbRulesJsonUsable(fromNvs)) {
        mbRulesJson = fromNvs;
        Serial.printf("[FS] migrating %u bytes from NVS → SPIFFS\n",
                      (unsigned)mbRulesJson.length());
        rulesOnFs = mbRulesFsSave(mbRulesJson);
        if (!rulesOnFs) {
          Serial.println("[FS] migrate failed — keeping NVS copy for this boot");
        }
      } else {
        Serial.printf("[Rules] discarded invalid/empty NVS blob (%u bytes) — waiting for push\n",
                      (unsigned)fromNvs.length());
        mbRulesJson = "";
        discardNvsRules = true;
      }
    }
  }
  mbMappingJson = mbRulesJson;
  mbLayoutsJson       = prefs.getString("mbLayouts", "");
  mbActiveLayoutIdx   = prefs.getUChar("mbActiveLayout", 0);
  showLookParadePre     = prefs.getString("showParaPre", "");
  showLookParadeLive    = prefs.getString("showParaLive", "");
  showLookFireworksPre  = prefs.getString("showFwPre", "");
  showLookFireworksLive = prefs.getString("showFwLive", "__BLACK__");
  showLookFireworksPost = prefs.getString("showFwPost", "");
  mbFadeToBlackPresetId = prefs.getString("mbFtbPreset", "");
  wledSsid = prefs.getString("wledSsid", "KyLan Ren");
  wledPass = prefs.getString("wledPass", "tigers2016");
  wledIp   = prefs.getString("wledIp", "wled.local");
  wledPort = prefs.getInt("wledPort", 80);
  boardRole = (BoardRole)prefs.getUChar("boardRole", (uint8_t)BoardRole::STANDALONE);
  {
    size_t macLen = prefs.getBytesLength("scannerMac");
    if (macLen == 6) {
      prefs.getBytes("scannerMac", scannerPeerMac, 6);
      scannerPeerConfigured = true;
    }
  }
  prefs.end();

  // Drop legacy NVS rule blobs after SPIFFS has a good copy, or when the NVS
  // blob was junk we refused to migrate.
  if (rulesOnFs || discardNvsRules) {
    prefs.begin("config", false);
    nvsRemoveLargeString(prefs, "mbRules");
    nvsRemoveLargeString(prefs, "mbMapping");
    prefs.end();
  }

  // Part 9: seed from compile-time embedded_rules.json when empty or forceOverride.
  if (kHasEmbeddedRules) {
    StaticJsonDocument<256> peek;
    deserializeJson(peek, kEmbeddedRulesJson, DeserializationOption::NestingLimit(2));
    bool forceOverride = peek["forceOverride"] | false;
    if (forceOverride || mbRulesJson.length() == 0) {
      Serial.printf("[Rules] Seeding from embedded_rules.json (force=%d)\n", forceOverride ? 1 : 0);
      mbRulesJson = String(kEmbeddedRulesJson);
      mbMappingJson = mbRulesJson;
      if (mbRulesFsSave(mbRulesJson)) {
        Serial.println("[Rules] Embedded rules persisted to SPIFFS");
      } else {
        Serial.println("[Rules] WARNING: embedded rules loaded into RAM but SPIFFS persist failed");
      }
    }
  }

  loadMbMappingDefaults();
  if (mbLayoutsJson.length() > 0) loadMbLayoutsFromJson();
  loadMbRulesFromJson();
  mbMappingLoadedFromNvs = mbRulesJson.length() > 0 || mbMappingJson.length() > 0;
  {
    String calJson = mbCalibrationFsLoad();
    if (calJson.length() > 0) mbCalibrationApply(calJson);
  }
  loadWledBaselineFromNvs();
  Serial.printf("[NVS] swEn=%d mbEn=%d killOnZone=%d scanLog=%d rulesPaused=%d bleFade=%lums role=%u\n",
                starlightEnabled, magicBandEnabled, overrideKillOnZone,
                bleScanLogEnabled, rulesPaused ? 1 : 0, bleEffectTransitionMs,
                (unsigned)boardRole);
  Serial.printf("[NVS] mbRules=%u bytes mbMapping=%u bytes\n",
                (unsigned)mbRulesJson.length(), (unsigned)mbMappingJson.length());

  prefs.begin("presets", false);
  prefs.end();
  Serial.println("[NVS] Ready");

  // OLED before NeoPixel/UART/BLE when present (HAS_OLED); no-op stubs otherwise.
  statusDisplayInit();  // non-fatal

  NimBLEDevice::init(BLE_NAME);
  delay(200);
  statusLedInit();
  startBLEPeripheral();
  uartScannerLinkInit();
  sdRuleLoggerInit();   // non-fatal (HAS_SD_LOGGER=0 skips SPI; RAM ring still on)
#if HAS_OLED
  // SPI/SD can leave Wire in a weird state on some cores — re-assert OLED pins.
  statusDisplayReassertWire();
  if (!statusDisplayReady()) statusDisplayInit();
#endif

  // Dual-board: logic board does NOT own the scan radio (no silent fallback).
  if (boardRole == BoardRole::STANDALONE) {
    startBLEScan();
  } else {
    Serial.println("[BLE] LOGIC_BOARD — scan disabled; waiting for UART scanner");
  }

  payloadTransportInit();

  // Create command queue (10 slots)
  cmdQueue = xQueueCreate(10, sizeof(PendingCmd));
  bleCmdQueue = xQueueCreate(BLE_CMD_QUEUE_DEPTH, sizeof(PendingBleCmd));

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
  statusLedTick();
  uartScannerLinkPoll();
  // BLE first — app preset fire / status must not wait behind UART rule applies.
  processBleCmdQueue();
  processPendingCommands();
  processParsedPacketQueue();
  serviceScannerLinkHealth();
  processSerialCommands();
  serviceWandTx();
  statusDisplayUpdate();

  // Auto-clear BLE effect override after timeout (flat path — skipped while
  // timed rule lifecycle is running; that machine owns its own restore).
  if (currentOverride == BLE_EFFECT && mbRulePhase == MB_RULE_IDLE) {
    unsigned long timeoutMs = lastMatchedRuleWasWand ? starlightTimeoutMs : magicBandTimeoutMs;
    if (timeoutMs > 0 && millis() - mbEventTimestamp >= timeoutMs) {
      Serial.printf("[BLE] Timeout after %lums — restoring state\n", timeoutMs);
      clearOverride();
      bleNotify(lastMatchedRuleWasWand
        ? "{\"type\":\"sw_event\",\"event\":\"timeout\"}"
        : "{\"type\":\"ble_event\",\"event\":\"timeout\"}");
    }
  }

  serviceMbRuleLifecycle();
  serviceParadeCooldown();
  servicePendingRestore();

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
    wledHttpOk = false;
  } else if (!wledWasConnected) {
    wledWasConnected = true;
    delay(300);  // let AP/WLED settle after STA join
    snapshotWledBaseline();
    ensureWledPowerOn();
  } else {
    pollLiveWledState();
  }
  delay(10);
}
