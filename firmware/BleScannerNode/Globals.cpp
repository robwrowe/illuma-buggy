#include "Globals.h"

const uint8_t WAND_IDLE_PAYLOAD[19] = {
  0x0F, 0x11, 0x01, 0x4B, 0x72, 0x99, 0x08, 0x83, 0x0A, 0x66,
  0xD4, 0x85, 0xCD, 0x9F, 0x95, 0x75, 0xA8, 0xA3, 0x21
};
const uint8_t WAND_CAST_SIG[6] = {0xCF, 0x0B, 0x00, 0xC4, 0x20, 0x22};

Preferences prefs;

bool bleScanLogEnabled = true;
unsigned long bleSniffUntilMs = 0;

uint8_t lastLogBytes[48];
size_t lastLogLen = 0;
uint32_t scanRepeatCount = 0;
unsigned long scanRepeatSummaryMs = 0;

uint8_t pairedLogicMac[6] = {0};
bool logicPeerConfigured = false;

uint32_t espNowSendOk = 0;
uint32_t espNowSendFail = 0;
