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

extern uint8_t pairedLogicMac[6];
extern bool logicPeerConfigured;
extern uint8_t pairedChannel;

extern uint32_t espNowSendOk;
extern uint32_t espNowSendFail;
extern uint32_t espNowSendCbOk;    // ESP_NOW_SEND_SUCCESS from send callback
extern uint32_t espNowSendCbFail;  // ESP_NOW_SEND_FAIL from send callback
extern uint32_t espNowTxSeq;       // packets attempted (pre-queue)
