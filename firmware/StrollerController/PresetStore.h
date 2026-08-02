#pragma once

#include <Arduino.h>
void savePreset(const String& id, const String& name, const String& wledJson,
                const String& segmentMapId = "");
String getPreset(const String& id);
/** Top-level "name" from NVS preset JSON; falls back to id. */
String getPresetName(const String& id);
/** Update currentPresetId + currentPresetName for status/OLED. */
void setCurrentPreset(const String& id);
String getAllPresets();
int countBoardPresets();
void deletePreset(const String& id);
bool applyPreset(const String& id);
bool setBrightness(int bri);
