#include "DebugLog.h"
#include "Globals.h"
#include "DisneyBleFilter.h"
#include "BlePeripheral.h"

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

void notifySwDebug(const char* reason, const uint8_t* data, size_t len) {
  unsigned long now = millis();
  if (now - swDebugLastNotify < 400) return;
  swDebugLastNotify = now;
  String msg = "{\"type\":\"sw_debug\",\"reason\":\"" + String(reason) +
               "\",\"hex\":\"" + mfrToHex(data, len) + "\",\"len\":" + String(len) + "}";
  bleNotify(msg);
  Serial.printf("[SW] debug: %s len=%u hex=%s\n", reason, (unsigned)len, mfrToHex(data, len).c_str());
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

