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

/** Status LED activity stamps (millis). */
extern unsigned long lastDisneySeenMs;
extern unsigned long lastForwardMs;
