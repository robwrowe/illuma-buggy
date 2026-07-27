#pragma once
#include <Arduino.h>

bool sdRuleLoggerInit();
bool sdRuleLoggerReady();
void sdRuleLoggerWrite(const char* event, const char* detailJson);
