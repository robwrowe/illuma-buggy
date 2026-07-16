#pragma once

#include <Arduino.h>
bool sendToWLED(const String& jsonBody, int timeoutMs = 2000, int retries = 0);
bool sendToWLEDForBleEffect(const String& jsonBody);
bool sendToWLEDForBleSolid(const String& jsonBody);
String getFromWLED(const String& path);
String injectWledTransition(const String& jsonBody, unsigned long transitionMs);
String compactWledStateForSave(const String& full);
void snapshotWledBaseline();
void loadWledBaselineFromNvs();
void ensureWledPowerOn();
String buildSeg0JsonBody(const String& seg0Inner);
