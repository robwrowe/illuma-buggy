#include "WiFiManager.h"
#include "Globals.h"
#include "WledClient.h"
#include "PayloadTransport.h"

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
  WiFi.begin(wledSsid.c_str(), wledPass.c_str());
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
    // WiFi.disconnect(true) above tore down ESP-NOW — bring it back up on the now-stable
    // STA channel so the scanner pair beacon / packet receive work (dual-board mode).
    transportEnsureEspNow();
    delay(500);
    snapshotWledBaseline();
    ensureWledPowerOn();
    wledWasConnected = true;
  } else {
    Serial.println("\n[WiFi] Failed — will retry");
  }
  wifiConnectInProgress = false;
}

// ─────────────────────────────────────────────
// SETUP & LOOP
// ─────────────────────────────────────────────

