#pragma once

#include <Arduino.h>
/** Store a full preset JSON object (already serialized). Prefer this over
 *  hand-assembling nested fields — segmentOverrides is a nested object. */
void savePreset(const String& id, const String& presetJson);
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
