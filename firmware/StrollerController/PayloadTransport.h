#pragma once

#include "Types.h"

extern BoardRole boardRole;
extern uint8_t scannerPeerMac[6];
extern bool scannerPeerConfigured;
extern unsigned long lastScannerPacketMs;
extern uint32_t espNowRxCount;      // valid ParsedDisneyPackets received over ESP-NOW
extern uint32_t espNowRxRejected;   // ESP-NOW frames dropped (wrong length)

void payloadTransportInit();
void transportSendParsedPacket(const ParsedDisneyPacket& pkt);
void transportOnEspNowReceive(const uint8_t* mac, const uint8_t* data, int len);
void processParsedPacketQueue();

// Legacy raw-byte mailbox (kept for any residual callers; prefer transportSendParsedPacket).
void queueDisneyPayload(const uint8_t* payload, size_t plen);
void processDisneyPayloadQueue();

// Add/update ESP-NOW peer + optional reflected pair message to scanner.
void transportSetScannerMac(const uint8_t mac[6]);
// Called from loop(): while the scanner is configured but silent, periodically beacons
// the reflected pair message (with our current Wi-Fi channel) so a channel-sweeping
// scanner pairs on boot / reboot / re-pair. No-op once the scanner is delivering packets.
void transportPairResendTick();

// Called from loop(): if the scanner stays silent, fall back to local BLE scanning on the
// logic board; stop the local scan once the scanner is delivering packets again.
void serviceScannerFallback();
bool transportParseMacString(const char* str, uint8_t out[6]);
String transportMacToString(const uint8_t mac[6]);
