#pragma once

#include <Arduino.h>

/** Persist MB rules/mapping JSON on SPIFFS (NVS cannot hold a full mapping).
 *  Saves write to a temp file, verify size, then rename into place so a failed
 *  write never deletes a previously good /mb_rules.json. */
bool mbRulesFsBegin();
bool mbRulesFsSave(const String& json);
String mbRulesFsLoad();
void mbRulesFsClear();
