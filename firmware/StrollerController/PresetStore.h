#pragma once

#include <Arduino.h>
void savePreset(const String& id, const String& name, const String& wledJson);
String getPreset(const String& id);
String getAllPresets();
int countBoardPresets();
void deletePreset(const String& id);
bool applyPreset(const String& id);
bool setBrightness(int bri);
