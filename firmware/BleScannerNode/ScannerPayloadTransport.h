#pragma once

#include "Types.h"
#include <Arduino.h>

void scannerTransportInit();
void scannerTransportSend(const ParsedDisneyPacket& pkt);
void scannerSetLogicMac(const uint8_t mac[6]);
bool scannerParseMacString(const char* str, uint8_t out[6]);
String scannerMacToString(const uint8_t mac[6]);
