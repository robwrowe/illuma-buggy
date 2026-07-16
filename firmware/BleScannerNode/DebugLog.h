#pragma once

#include <stdint.h>
#include <stddef.h>

void serialLogScanPacket(const char* tag, int rssi, const uint8_t* data, size_t len, bool isNew);
void serialLogSniffPacket(int rssi, const uint8_t* data, size_t len);
void notifyBleCapturePacket(const char* tag, int rssi, const uint8_t* data, size_t len, bool isNew);
void notifySwDebug(const char* reason, const uint8_t* data, size_t len);
void stopBleCapture(const char* reason);
