#pragma once

#include "Types.h"

extern BoardRole boardRole;
extern uint8_t scannerPeerMac[6];
extern bool scannerPeerConfigured;
extern unsigned long lastScannerPacketMs;

void payloadTransportInit();
void transportSendParsedPacket(const ParsedDisneyPacket& pkt);
void transportOnEspNowReceive(const uint8_t* mac, const uint8_t* data, int len);
void processParsedPacketQueue();

// Legacy raw-byte mailbox (kept for any residual callers; prefer transportSendParsedPacket).
void queueDisneyPayload(const uint8_t* payload, size_t plen);
void processDisneyPayloadQueue();

// Add/update ESP-NOW peer + optional reflected pair message to scanner.
void transportSetScannerMac(const uint8_t mac[6]);
bool transportParseMacString(const char* str, uint8_t out[6]);
String transportMacToString(const uint8_t mac[6]);
