/**
 * StrollerController Firmware v2.1
 * ESP32-S3-DevKitC-1-N16R8
 *
 * Modular split + optional dual-board ESP-NOW scanner (BoardRole).
 */

#include "Globals.h"
#include "WiFiManager.h"
#include "WledClient.h"
#include "PresetStore.h"
#include "OverrideManager.h"
#include "MbMapping.h"
#include "MbEffects.h"
#include "BlePeripheral.h"
#include "DisneyBleScan.h"
#include "PayloadTransport.h"
#include "SerialConsole.h"
#include "WandTx.h"
#include "DebugLog.h"

void setup() {
  Serial.begin(115200);
  delay(500);
  randomSeed(esp_random());
  Serial.println("\n[Boot] StrollerController v2.1");

  // Load NVS config
  prefs.begin("config", true);
  starlightEnabled    = prefs.getBool("swEn", true);
  starlightTimeoutMs  = prefs.getULong("swTimeout", 15000);
  magicBandEnabled    = prefs.getBool("mbEn", true);
  mbDeferToApp        = prefs.getBool("mbDefer", false);
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
  loadMbMappingDefaults();
  if (mbLayoutsJson.length() > 0) loadMbLayoutsFromJson();
  loadMbMappingFromJson();
  mbMappingLoadedFromNvs = mbMappingJson.length() > 0;
  loadWledBaselineFromNvs();
  Serial.printf("[NVS] swEn=%d mbEn=%d mb5pt=%d killOnZone=%d scanLog=%d chase=%u/%u bleFade=%lums role=%u\n",
                starlightEnabled, magicBandEnabled, magicBandFivePoint, overrideKillOnZone,
                bleScanLogEnabled, mbChaseSpeed, mbChaseThickness, bleEffectTransitionMs,
                (unsigned)boardRole);

  prefs.begin("presets", false);
  prefs.end();
  Serial.println("[NVS] Ready");

  NimBLEDevice::init(BLE_NAME);
  delay(200);
  startBLEPeripheral();

  // Dual-board: logic board does NOT own the scan radio (no silent fallback).
  if (boardRole == BoardRole::STANDALONE) {
    startBLEScan();
  } else {
    Serial.println("[BLE] LOGIC_BOARD — scan disabled; waiting for ESP-NOW scanner");
  }

  payloadTransportInit();

  // Create command queue (10 slots)
  cmdQueue = xQueueCreate(10, sizeof(PendingCmd));
  bleCmdQueue = xQueueCreate(6, sizeof(PendingBleCmd));

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
  processParsedPacketQueue();
  processSerialCommands();
  processBleCmdQueue();
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
