#pragma once

#include <Arduino.h>
/** Serializes loop()-side and WledSendTask HTTPClient use (ESP32 HTTP is not reentrant). */
void wledHttpMutexInit();
bool sendToWLED(const String& jsonBody, int timeoutMs = 2000, int retries = 0);
bool sendToWLEDForBleEffect(const String& jsonBody);
bool sendToWLEDForBleSolid(const String& jsonBody);
/** GET from WLED. Default timeout 5000ms; use a shorter timeout for background polls. */
String getFromWLED(const String& path, int timeoutMs = 5000);
String injectWledTransition(const String& jsonBody, unsigned long transitionMs);
/** Same as above; when blendingStyle >= 0 also injects WLED v16 `"bs"` (transition style). */
String injectWledTransition(const String& jsonBody, unsigned long transitionMs, int blendingStyle);
String compactWledStateForSave(const String& full);
void snapshotWledBaseline();
void loadWledBaselineFromNvs();
void ensureWledPowerOn();
/** Refresh `currentBrightness` from WLED state when reachable. Returns true on success. */
bool refreshCurrentBrightnessFromWled(int timeoutMs = 800);
String buildSeg0JsonBody(const String& seg0Inner);
