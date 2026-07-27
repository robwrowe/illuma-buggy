#pragma once
#include <Arduino.h>
#include <stddef.h>
#include <stdint.h>

bool sdRawLoggerInit();
void sdRawLoggerWrite(const uint8_t* mfrData, size_t len, int rssi, uint64_t tsMs);
bool sdRawLoggerReady();
