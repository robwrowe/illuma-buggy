#include "Reboot.h"
#include "Globals.h"
#include "WiFiManager.h"
#include <NimBLEDevice.h>
#include <string.h>

static bool     rebootPending = false;
static uint32_t rebootDeadlineMs = 0;
static char     rebootSource[24] = "";

void requestReboot(const char* source, uint32_t delayMs) {
  if (rebootPending) {
    Serial.println("[Reboot] already pending");
    return;
  }
  rebootPending = true;
  rebootDeadlineMs = millis() + delayMs;
  strncpy(rebootSource, source ? source : "?", sizeof(rebootSource) - 1);
  rebootSource[sizeof(rebootSource) - 1] = '\0';
  Serial.printf("[Reboot] requested source=%s delay_ms=%u\n", rebootSource, (unsigned)delayMs);
}

void serviceReboot() {
  if (!rebootPending) return;
  if ((int32_t)(millis() - rebootDeadlineMs) < 0) return;

  Serial.printf("[Reboot] restarting (source=%s)\n", rebootSource);
  Serial.flush();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  if (adv) adv->stop();
  stopLogicBoardMdns();
  WiFi.disconnect(true);
  delay(50);
  ESP.restart();
}
