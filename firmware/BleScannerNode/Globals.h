#pragma once

#include "Config.h"
#include "Types.h"
#include <Preferences.h>

extern Preferences prefs;

extern const uint8_t WAND_IDLE_PAYLOAD[19];
extern const uint8_t WAND_CAST_SIG[6];

extern bool bleScanLogEnabled;
extern unsigned long bleSniffUntilMs;

extern uint8_t lastLogBytes[48];
extern size_t lastLogLen;
extern uint32_t scanRepeatCount;
extern unsigned long scanRepeatSummaryMs;

extern uint32_t uartFwdSeq;  // packets forwarded over UART

/** Status LED / OLED activity stamps (millis). */
extern unsigned long lastDisneySeenMs;
extern unsigned long lastForwardMs;
/** Last UART heartbeat received from logic (0 = never). */
extern unsigned long lastLogicHbMs;

/** Scan-task → loop() ring: onResult pushes, drainScanRing() sends UART/logs. */
#define SCAN_RING_SIZE 24

struct ScanRingSlot {
  ParsedDisneyPacket pkt;
  bool valid;
};

extern ScanRingSlot scanRing[SCAN_RING_SIZE];
extern volatile uint8_t scanRingHead;   // written by onResult (scan task)
extern volatile uint8_t scanRingTail;   // read by loop()
extern volatile uint32_t scanRingDropped; // count of overwrites, for diagnostics
