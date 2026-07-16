#include "PayloadTransport.h"
#include "Globals.h"
#include "DisneyPayloadHandlers.h"
#include "MbPacketDecode.h"
#include <esp_now.h>
#include <WiFi.h>
#include <string.h>
#include <stdlib.h>

BoardRole boardRole = BoardRole::STANDALONE;
uint8_t scannerPeerMac[6] = {0};
bool scannerPeerConfigured = false;
unsigned long lastScannerPacketMs = 0;

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
  (void)mac;
  if (!data || len <= 0) return;

  // Reflected pairing is scanner-side; logic board only receives ParsedDisneyPacket.
  if (len == (int)sizeof(ParsedDisneyPacket)) {
    ParsedDisneyPacket pkt;
    memcpy(&pkt, data, sizeof(pkt));
    lastScannerPacketMs = millis();
    queueParsedPacket(pkt);
    return;
  }

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

  if (!ensureEspNowPeer(scannerPeerMac)) return;

  // Reflected pairing: send our STA MAC to the scanner so it can store pairedLogicMac.
  EspNowPairMsg msg = {};
  msg.magic = ESPNOW_PAIR_MAGIC;
  uint8_t myMac[6];
  WiFi.macAddress(myMac);
  memcpy(msg.logicMac, myMac, 6);
  esp_err_t err = esp_now_send(scannerPeerMac, (const uint8_t*)&msg, sizeof(msg));
  Serial.printf("[ESP-NOW] pair msg to %s: %s\n",
                transportMacToString(scannerPeerMac).c_str(),
                err == ESP_OK ? "ok" : "fail");
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
