#include "ScannerPayloadTransport.h"
#include "Globals.h"
#include "UartLink.h"
#include <string.h>

String scannerMacToString(const uint8_t mac[6]) {
  char buf[18];
  snprintf(buf, sizeof(buf), "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(buf);
}

bool scannerParseMacString(const char* str, uint8_t out[6]) {
  if (!str || !out) return false;
  unsigned int b[6];
  if (sscanf(str, "%02x:%02x:%02x:%02x:%02x:%02x",
             &b[0], &b[1], &b[2], &b[3], &b[4], &b[5]) != 6 &&
      sscanf(str, "%02X:%02X:%02X:%02X:%02X:%02X",
             &b[0], &b[1], &b[2], &b[3], &b[4], &b[5]) != 6) {
    return false;
  }
  for (int i = 0; i < 6; i++) out[i] = (uint8_t)b[i];
  return true;
}

void scannerTransportInit() {
  Serial.printf("[Transport] ParsedDisneyPacket sizeof=%u\n", (unsigned)sizeof(ParsedDisneyPacket));
  uartLinkBegin(Serial1);
  Serial.println("[UART] scanner→logic forwarding active");
}

void scannerTransportSend(const ParsedDisneyPacket& pkt) {
  uartLinkSendPacket(Serial1, pkt);
  lastForwardMs = millis();
  uartFwdSeq++;
  if (uartFwdSeq <= 40 || (uartFwdSeq % 25) == 0) {
    Serial.printf("[UART] forwarding scan packet #%lu (len=%u kind=%u op=0x%04X)\n",
                  (unsigned long)uartFwdSeq,
                  (unsigned)sizeof(pkt),
                  (unsigned)pkt.kind, (unsigned)pkt.opcode);
  }
}

void scannerUartHeartbeatTick() {
  static unsigned long lastHbMs = 0;
  static uint32_t hbSeq = 0;
  if (millis() - lastHbMs < 2000) return;
  lastHbMs = millis();
  uartLinkSendHeartbeat(Serial1);
  hbSeq++;
  if (hbSeq <= 5 || (hbSeq % 15) == 0) {
    Serial.printf("[UART] heartbeat #%lu\n", (unsigned long)hbSeq);
  }
}
