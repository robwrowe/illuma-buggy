#pragma once
#include <Arduino.h>

bool statusDisplayInit();
void statusDisplayUpdate();
/** Mark last WLED HTTP call result for the OLED WLED:OK/FAIL field. */
void statusDisplaySetWledOk(bool ok);
/** Record last applied rule name for OLED. */
void statusDisplaySetLastRule(const char* name);
