#pragma once

#include <Arduino.h>

/** Persist MB rules/mapping JSON on SPIFFS (NVS cannot hold ~6KB reliably). */
bool mbRulesFsBegin();
bool mbRulesFsSave(const String& json);
String mbRulesFsLoad();
void mbRulesFsClear();
