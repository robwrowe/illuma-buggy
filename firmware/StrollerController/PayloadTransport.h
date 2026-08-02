#pragma once

#include "Types.h"

extern BoardRole boardRole;
extern uint8_t scannerPeerMac[6];
extern bool scannerPeerConfigured;
extern unsigned long lastScannerPacketMs;
extern uint32_t parsedPacketDropCount; // ring buffer overflows (oldest discarded)
extern uint32_t uartRxPacketCount;

void payloadTransportInit();
void transportSendParsedPacket(const ParsedDisneyPacket& pkt);
void processParsedPacketQueue();
/** Drop queued Disney frames (call on ON→DIP so trailing ads cannot restart FTB). */
void flushParsedPacketQueue();

// Legacy raw-byte mailbox (kept for any residual callers; prefer transportSendParsedPacket).
void queueDisneyPayload(const uint8_t* payload, size_t plen);
void processDisneyPayloadQueue();

/** Persist scanner MAC from app/serial (informational; UART needs no pairing). */
void transportSetScannerMac(const uint8_t mac[6]);

/** UART inter-board link. Init once in setup; poll each loop(). */
void uartScannerLinkInit();
void uartScannerLinkPoll();
/** Enqueue a packet received over UART. */
void transportOnUartPacket(const ParsedDisneyPacket& pkt);

/**
 * LOGIC_BOARD: UART silent = link lost only — never start local Disney NimBLE scan
 * (protects phone BLE in parks). STANDALONE owns startBLEScan.
 */
void serviceScannerLinkHealth();
/** Apply boardRole immediately (start/stop local scan) — no reboot required. */
void applyBoardRoleRuntime();
bool transportParseMacString(const char* str, uint8_t out[6]);
String transportMacToString(const uint8_t mac[6]);
