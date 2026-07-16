#pragma once

#include "Types.h"
#include <ArduinoJson.h>
void loadMbMappingDefaults();
void loadMbMappingFromJson();
void applyMbMappingJson(JsonObject root);
void parseEffectMap(JsonObject obj, MbEffectMap& out);
void parseSegMapArray(JsonArray arr, MbSegMap& out);
void loadMbLayoutsFromJson();
String resolveEffectPresetId(const MbEffectMap& map);
int mbSegKeyIndex(const char* key);
bool loadEffectMapWled(const MbEffectMap& map, DynamicJsonDocument& wled);
MbSegMap& activeMbSegMap(int keyIdx);
