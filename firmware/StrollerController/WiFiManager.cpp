#include "WiFiManager.h"
#include "Globals.h"

void connectToWLED(bool force) {
  if (!force && WiFi.status() == WL_CONNECTED) {
    Serial.println("[WiFi] Already connected");
    return;
  }
  if (wifiConnectInProgress) {
    Serial.println("[WiFi] Connect already in progress — skipping");
    return;
  }
  wifiConnectInProgress = true;
  WiFi.disconnect(true);
  int waitAttempts = 0;
  while (WiFi.status() == WL_CONNECTED && waitAttempts < 20) {
    delay(50);
    waitAttempts++;
  }
  delay(100);
  Serial.printf("[WiFi] Connecting to GLEDOPTO: %s\n", wledSsid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // Disable modem sleep — critical for BLE+WiFi coexistence on ESP32-S3
  WiFi.begin(wledSsid.c_str(), wledPass.c_str());
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
    // Do NOT call snapshotWledBaseline / ensureWledPowerOn here — this runs on a
    // FreeRTOS WiFi task. Concurrent HTTPClient with loop() hangs / races.
    // Main loop picks up the newly-connected edge and snapshots there.
    wledWasConnected = false;  // force main-loop one-shot snapshot
  } else {
    Serial.println("\n[WiFi] Failed — will retry");
  }
  wifiConnectInProgress = false;
}

// ─────────────────────────────────────────────
// SETUP & LOOP
// ─────────────────────────────────────────────

