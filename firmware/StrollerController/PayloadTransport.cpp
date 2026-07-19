#include "PayloadTransport.h"
#include "Globals.h"
#include "DisneyPayloadHandlers.h"
#include "MbPacketDecode.h"
#include "DisneyBleScan.h"
#include <NimBLEDevice.h>
#include <esp_now.h>
#include <WiFi.h>
#include <string.h>
#include <stdlib.h>

// How long without an ESP-NOW packet before we consider the scanner absent.
#define SCANNER_ABSENT_MS 20000
// A packet within this window means the scanner link is healthy.
#define SCANNER_ALIVE_MS  10000

BoardRole boardRole = BoardRole::STANDALONE;
uint8_t scannerPeerMac[6] = {0};
bool scannerPeerConfigured = false;
unsigned long lastScannerPacketMs = 0;
uint32_t espNowRxCount = 0;
uint32_t espNowRxRejected = 0;

static ParsedPacketJob parsedJob = {};
static portMUX_TYPE parsedJobMux = portMUX_INITIALIZER_UNLOCKED;

static void queueParsedPacket(const ParsedDisneyPacket& pkt) {
  portENTER_CRITICAL(&parsedJobMux);
  parsedJob.pkt = pkt;
  parsedJob.pending = true;
  portEXIT_CRITICAL(&parsedJobMux);
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

#if ESP_ARDUINO_VERSION_MAJOR >= 3
static void onEspNowRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  const uint8_t* mac = info ? info->src_addr : nullptr;
  transportOnEspNowReceive(mac, data, len);
}
#else
static void onEspNowRecv(const uint8_t* mac, const uint8_t* data, int len) {
  transportOnEspNowReceive(mac, data, len);
}
#endif

void transportOnEspNowReceive(const uint8_t* mac, const uint8_t* data, int len) {
  if (!data || len <= 0) return;

  // Reflected pairing is scanner-side; logic board only receives ParsedDisneyPacket.
  if (len == (int)sizeof(ParsedDisneyPacket)) {
    ParsedDisneyPacket pkt;
    memcpy(&pkt, data, sizeof(pkt));
    lastScannerPacketMs = millis();
    espNowRxCount++;
    // Positive proof the packet came over ESP-NOW (scanner) rather than local BLE.
    if (bleScanLogEnabled) {
      Serial.printf("[ESP-NOW] rx #%lu kind=%u op=0x%04X raw=%u from %s\n",
                    (unsigned long)espNowRxCount, (unsigned)pkt.kind,
                    (unsigned)pkt.opcode, (unsigned)pkt.rawLen,
                    mac ? transportMacToString(mac).c_str() : "?");
    }
    queueParsedPacket(pkt);
    return;
  }

  espNowRxRejected++;
  Serial.printf("[ESP-NOW] Ignoring len=%d (expected %u)\n",
                len, (unsigned)sizeof(ParsedDisneyPacket));
}

static bool ensureEspNowPeer(const uint8_t mac[6]) {
  if (esp_now_is_peer_exist(mac)) return true;
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, mac, 6);
  peer.channel = 0;
  peer.encrypt = false;
  esp_err_t err = esp_now_add_peer(&peer);
  if (err != ESP_OK) {
    Serial.printf("[ESP-NOW] add_peer failed: %d\n", (int)err);
    return false;
  }
  return true;
}

static unsigned long lastPairSendMs = 0;
static bool localScanFallbackActive = false;

static void sendPairMessage() {
  EspNowPairMsg msg = {};
  msg.magic = ESPNOW_PAIR_MAGIC;
  uint8_t myMac[6];
  WiFi.macAddress(myMac);
  memcpy(msg.logicMac, myMac, 6);
  // Tell the scanner which Wi-Fi channel to lock onto (our STA channel). ESP-NOW only
  // works when both radios are on the same channel; the scanner has no AP to follow.
  msg.channel = (uint8_t)WiFi.channel();
  esp_err_t err = esp_now_send(scannerPeerMac, (const uint8_t*)&msg, sizeof(msg));
  lastPairSendMs = millis();
  Serial.printf("[ESP-NOW] pair beacon to %s ch=%u: %s\n",
                transportMacToString(scannerPeerMac).c_str(),
                (unsigned)msg.channel, err == ESP_OK ? "ok" : "fail");
}

void transportSetScannerMac(const uint8_t mac[6]) {
  memcpy(scannerPeerMac, mac, 6);
  scannerPeerConfigured = true;

  prefs.begin("config", false);
  prefs.putBytes("scannerMac", scannerPeerMac, 6);
  prefs.end();

  if (boardRole != BoardRole::LOGIC_BOARD) {
    Serial.println("[ESP-NOW] scanner MAC saved (boardRole is not logic_board)");
    return;
  }

  ensureEspNowPeer(scannerPeerMac);
  // The loop-driven pair beacon (transportPairResendTick) does the actual pairing once
  // WiFi is up, so the advertised channel is the stable AP channel.
  Serial.println("[ESP-NOW] scanner MAC set — beaconing pair on stable channel");
}

static bool scannerLinkAlive() {
  return lastScannerPacketMs != 0 && (millis() - lastScannerPacketMs < SCANNER_ALIVE_MS);
}

void transportPairResendTick() {
  if (boardRole != BoardRole::LOGIC_BOARD || !scannerPeerConfigured) return;
  // Only beacon once WiFi is connected, so the channel we advertise is the stable AP
  // channel the scanner must lock onto (not the transient boot-time channel).
  if (WiFi.status() != WL_CONNECTED) return;
  if (scannerLinkAlive()) return;  // packets flowing — already paired & healthy
  // Beacon faster than the scanner's per-channel dwell so a beacon is guaranteed to land
  // while the scanner is sitting on our channel during its sweep.
  if (millis() - lastPairSendMs >= 200) sendPairMessage();
}

void serviceScannerFallback() {
  if (boardRole != BoardRole::LOGIC_BOARD) return;

  if (!localScanFallbackActive) {
    unsigned long silentFor = lastScannerPacketMs ? (millis() - lastScannerPacketMs) : millis();
    if (silentFor > SCANNER_ABSENT_MS) {
      Serial.println("[Fallback] Scanner silent — starting local BLE scan on logic board");
      startBLEScan();
      localScanFallbackActive = true;
    }
  } else if (scannerLinkAlive()) {
    Serial.println("[Fallback] Scanner back online — stopping local BLE scan");
    NimBLEDevice::getScan()->stop();
    localScanFallbackActive = false;
  }
}

void payloadTransportInit() {
  static_assert(sizeof(ParsedDisneyPacket) <= 250, "ParsedDisneyPacket exceeds ESP-NOW payload cap");
  Serial.printf("[Transport] ParsedDisneyPacket sizeof=%u (ESP-NOW cap 250)\n",
                (unsigned)sizeof(ParsedDisneyPacket));

  if (boardRole != BoardRole::LOGIC_BOARD) {
    Serial.println("[Transport] STANDALONE — local decode mailbox, no ESP-NOW recv");
    return;
  }

  // ESP-NOW requires WIFI_STA; coexist with WLED station connection.
  if (WiFi.getMode() != WIFI_STA && WiFi.getMode() != WIFI_AP_STA) {
    WiFi.mode(WIFI_STA);
  }

  esp_err_t err = esp_now_init();
  if (err != ESP_OK) {
    // Already initialized is fine on some cores; retry register anyway.
    Serial.printf("[ESP-NOW] init result: %d (continuing)\n", (int)err);
  }
  esp_now_register_recv_cb(onEspNowRecv);

  if (scannerPeerConfigured) {
    ensureEspNowPeer(scannerPeerMac);
    Serial.printf("[ESP-NOW] LOGIC_BOARD peer %s\n",
                  transportMacToString(scannerPeerMac).c_str());
  } else {
    Serial.println("[ESP-NOW] LOGIC_BOARD — waiting for scanner MAC");
  }
}

void transportSendParsedPacket(const ParsedDisneyPacket& pkt) {
  // This sketch always applies locally: STANDALONE scans here; scanner-node sketch
  // (Pass 4) will esp_now_send instead. LOGIC_BOARD does not call this from scan.
  queueParsedPacket(pkt);
}

void processParsedPacketQueue() {
  if (!parsedJob.pending) return;
  ParsedDisneyPacket pkt;
  portENTER_CRITICAL(&parsedJobMux);
  if (!parsedJob.pending) {
    portEXIT_CRITICAL(&parsedJobMux);
    return;
  }
  pkt = parsedJob.pkt;
  parsedJob.pending = false;
  portEXIT_CRITICAL(&parsedJobMux);
  applyParsedDisneyPacket(pkt);
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
