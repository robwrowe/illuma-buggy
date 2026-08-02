#pragma once

#include "Types.h"
#include <Arduino.h>

void scannerTransportInit();
void scannerTransportSend(const ParsedDisneyPacket& pkt);
/** Send UART link keepalive so logic doesn't treat quiet scan as a dead wire. */
void scannerUartHeartbeatTick();
/** Poll UART RX for logic heartbeat replies (updates lastLogicHbMs). */
void scannerUartPoll();
bool scannerParseMacString(const char* str, uint8_t out[6]);
String scannerMacToString(const uint8_t mac[6]);
