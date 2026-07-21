#pragma once

#include <Arduino.h>
#include <Preferences.h>

/**
 * Preferences putString/getString is capped at ~4000 bytes on ESP32.
 * Large blobs (mbRules ~6KB+) are split across keyed chunks.
 * Requires prefs already begin()'d on the caller's namespace.
 */
bool nvsPutLargeString(Preferences& p, const char* key, const String& value);
String nvsGetLargeString(Preferences& p, const char* key, const String& def = "");
void nvsRemoveLargeString(Preferences& p, const char* key);
