#pragma once

#include "Types.h"
#include <Arduino.h>

void scannerTransportInit();
void scannerTransportSend(const ParsedDisneyPacket& pkt);
void scannerSetLogicMac(const uint8_t mac[6], uint8_t channel = 0);
bool scannerParseMacString(const char* str, uint8_t out[6]);
String scannerMacToString(const uint8_t mac[6]);
// While unpaired, cycle Wi-Fi channels so the reflected pair message lands regardless
// of the logic board's AP channel. Call from loop() when not paired. No-op once paired.
void scannerChannelSweepTick();
