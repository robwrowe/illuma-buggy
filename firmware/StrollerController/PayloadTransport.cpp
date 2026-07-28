#include "PayloadTransport.h"
#include "Globals.h"
#include "DisneyPayloadHandlers.h"
#include "MbPacketDecode.h"
#include "DisneyBleScan.h"
#include "UartLink.h"
#include <NimBLEDevice.h>
#include <string.h>
#include <stdlib.h>

BoardRole boardRole = BoardRole::STANDALONE;
uint8_t scannerPeerMac[6] = {0};
bool scannerPeerConfigured = false;
unsigned long lastScannerPacketMs = 0;
uint32_t parsedPacketDropCount = 0;
uint32_t uartRxPacketCount = 0;

struct ParsedPacketQueue {
  ParsedDisneyPacket items[PARSED_PACKET_QUEUE_DEPTH];
  volatile uint8_t head = 0;
  volatile uint8_t tail = 0;
  volatile uint8_t count = 0;
};
static ParsedPacketQueue parsedQueue;
static portMUX_TYPE parsedJobMux = portMUX_INITIALIZER_UNLOCKED;
static uint32_t lastLoggedDropCount = 0;

static void queueParsedPacket(const ParsedDisneyPacket& pkt) {
  portENTER_CRITICAL(&parsedJobMux);
  if (parsedQueue.count >= PARSED_PACKET_QUEUE_DEPTH) {
    // Drop oldest so we stay closest to real-time once loop() catches up.
    parsedQueue.head = (uint8_t)((parsedQueue.head + 1) % PARSED_PACKET_QUEUE_DEPTH);
    parsedQueue.count--;
    parsedPacketDropCount++;
  }
  parsedQueue.items[parsedQueue.tail] = pkt;
  parsedQueue.tail = (uint8_t)((parsedQueue.tail + 1) % PARSED_PACKET_QUEUE_DEPTH);
  parsedQueue.count++;
  portEXIT_CRITICAL(&parsedJobMux);
}

void transportOnUartPacket(const ParsedDisneyPacket& pkt) {
  lastScannerPacketMs = millis();
  uartRxPacketCount++;
  if (uartRxPacketCount <= 40 || (uartRxPacketCount % 25) == 0) {
    Serial.printf("[UART] recv packet #%lu kind=%u op=0x%04X\n",
                  (unsigned long)uartRxPacketCount, (unsigned)pkt.kind, (unsigned)pkt.opcode);
  }
  queueParsedPacket(pkt);
}

static void onUartHeartbeat() {
  lastScannerPacketMs = millis();
}

static UartLinkRx gUartRx;

static void onUartPacketCb(const ParsedDisneyPacket& pkt) {
  transportOnUartPacket(pkt);
}

void uartScannerLinkInit() {
  // Literal pins — do not trust a stale macro from a bad board target.
  const int rxPin = 18;
  const int txPin = 17;
  pinMode(rxPin, INPUT_PULLUP);
  Serial1.setRxBufferSize(1024);
  Serial1.begin(115200, SERIAL_8N1, rxPin, txPin);
  Serial.printf("[UART] Serial1 FORCED TX=%d RX=%d baud=115200 (scanner TX → logic GPIO %d)\n",
                txPin, rxPin, rxPin);

  gUartRx.onPacket = onUartPacketCb;
  gUartRx.onTime = nullptr;
  gUartRx.onHeartbeat = onUartHeartbeat;
  Serial.println("[UART] scanner link active");
}

void uartScannerLinkPoll() {
  uartLinkPoll(Serial1, gUartRx);
  static unsigned long lastUartDiagMs = 0;
  if (millis() - lastUartDiagMs >= 5000) {
    lastUartDiagMs = millis();
    unsigned long age = lastScannerPacketMs ? (millis() - lastScannerPacketMs) : 0;
    Serial.printf("[UART] rx bytes=%lu ok=%lu hb=%lu csumFail=%lu resync=%lu last=%s\n",
                  (unsigned long)gUartRx.rawBytes,
                  (unsigned long)gUartRx.rxOk,
                  (unsigned long)gUartRx.heartbeats,
                  (unsigned long)gUartRx.checksumFail,
                  (unsigned long)gUartRx.resync,
                  lastScannerPacketMs ? (String(age) + "ms ago").c_str() : "never");
  }
}

String transportMacToString(const uint8_t mac[6]) {
  char buf[18];
  snprintf(buf, sizeof(buf), "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(buf);
}

bool transportParseMacString(const char* str, uint8_t out[6]) {
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

void transportSetScannerMac(const uint8_t mac[6]) {
  memcpy(scannerPeerMac, mac, 6);
  scannerPeerConfigured = true;

  prefs.begin("config", false);
  prefs.putBytes("scannerMac", scannerPeerMac, 6);
  prefs.end();

  Serial.printf("[UART] scanner MAC saved %s (informational; link is wired UART)\n",
                transportMacToString(scannerPeerMac).c_str());
}

void serviceScannerLinkHealth() {
  if (boardRole != BoardRole::LOGIC_BOARD) return;
  // Dual-board: never start local Disney scan when UART is silent — link lost only.
  // Phone BLE in parks stays free of a second NimBLE scanner on the logic radio.
}

/** Switch scan behavior immediately when boardRole changes (no reboot). */
void applyBoardRoleRuntime() {
  if (boardRole == BoardRole::STANDALONE) {
    lastScannerPacketMs = 0;
    startBLEScan();
    Serial.println("[Role] STANDALONE — local BLE scan active (no reboot needed)");
    return;
  }

  // LOGIC_BOARD: stop local scan; UART scanner feeds packets.
  stopBLEScan();
  lastScannerPacketMs = 0;
  payloadTransportInit();
  Serial.println("[Role] LOGIC_BOARD — local scan off; UART scanner link");
}

void payloadTransportInit() {
  Serial.printf("[Transport] ParsedDisneyPacket sizeof=%u\n",
                (unsigned)sizeof(ParsedDisneyPacket));

  if (boardRole != BoardRole::LOGIC_BOARD) {
    Serial.println("[Transport] STANDALONE — local decode mailbox");
    return;
  }

  Serial.println("[Transport] LOGIC_BOARD — UART scanner link");
  Serial.printf("[UART] SCANNER_ALIVE_MS=%lu (silent = link lost; no local scan fallback)\n",
                (unsigned long)SCANNER_ALIVE_MS);
}

void transportSendParsedPacket(const ParsedDisneyPacket& pkt) {
  // STANDALONE scans here; BleScannerNode forwards over UART instead.
  // LOGIC_BOARD does not call this from scan.
  queueParsedPacket(pkt);
}

void processParsedPacketQueue() {
  if (parsedPacketDropCount != lastLoggedDropCount) {
    Serial.printf("[UART] parsed packet drops=%lu (queue full; oldest discarded)\n",
                  (unsigned long)parsedPacketDropCount);
    lastLoggedDropCount = parsedPacketDropCount;
  }

  // Cap per loop() so a MagicBand advert flood cannot starve BLE command drain
  // (preset fire / status). Remaining packets stay queued for the next iteration.
  const int kMaxPerLoop = 2;
  int processed = 0;
  while (processed < kMaxPerLoop) {
    ParsedDisneyPacket pkt;
    portENTER_CRITICAL(&parsedJobMux);
    if (parsedQueue.count == 0) {
      portEXIT_CRITICAL(&parsedJobMux);
      break;
    }
    pkt = parsedQueue.items[parsedQueue.head];
    parsedQueue.head = (uint8_t)((parsedQueue.head + 1) % PARSED_PACKET_QUEUE_DEPTH);
    parsedQueue.count--;
    portEXIT_CRITICAL(&parsedJobMux);
    applyParsedDisneyPacket(pkt);
    processed++;
  }
}

void queueDisneyPayload(const uint8_t* payload, size_t plen) {
  if (plen == 0) return;
  ParsedDisneyPacket pkt = decodeDisneyPayload(payload, plen, millis());
  if (pkt.kind == DisneyPacketKind::UNKNOWN) return;
  transportSendParsedPacket(pkt);
}

void processDisneyPayloadQueue() {
  processParsedPacketQueue();
}
