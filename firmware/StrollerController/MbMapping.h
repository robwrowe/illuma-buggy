#pragma once

#include "Types.h"
#include <ArduinoJson.h>

void loadMbMappingDefaults();
void loadMbMappingFromJson();
void applyMbMappingJson(JsonObject root);
void parseSegMapArray(JsonArray arr, MbSegMap& out);
void loadMbLayoutsFromJson();
int mbSegKeyIndex(const char* key);
MbSegMap& activeMbSegMap(int keyIdx);
