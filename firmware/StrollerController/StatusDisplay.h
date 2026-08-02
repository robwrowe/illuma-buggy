#pragma once
#include <Arduino.h>

bool statusDisplayInit();
/** True after a successful SSD1306 begin. */
bool statusDisplayReady();
/** Re-apply SDA/SCL after SPI/SD init. */
void statusDisplayReassertWire();
void statusDisplayUpdate();
/** Mark last WLED HTTP call result for the OLED WLED:OK/FAIL field. */
void statusDisplaySetWledOk(bool ok);
/** Record last applied rule name for OLED. */
void statusDisplaySetLastRule(const char* name);
