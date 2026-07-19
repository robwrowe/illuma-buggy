#include "ScannerPayloadTransport.h"
#include "Globals.h"
#include "ScannerAdvertise.h"
#include <esp_now.h>
#include <esp_wifi.h>
#include <WiFi.h>
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

static void lockChannel(uint8_t ch) {
  if (ch < 1 || ch > 14) return;
  esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
}

static bool ensureEspNowPeer(const uint8_t mac[6]) {
  if (esp_now_is_peer_exist(mac)) {
    // Peer may exist from a stale channel; keep it aligned with the locked channel.
    if (pairedChannel >= 1 && pairedChannel <= 14) {
      esp_now_peer_info_t cur = {};
      if (esp_now_get_peer(mac, &cur) == ESP_OK && cur.channel != pairedChannel) {
        cur.channel = pairedChannel;
        esp_now_mod_peer(&cur);
      }
    }
    return true;
  }
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, mac, 6);
  peer.channel = (pairedChannel >= 1 && pairedChannel <= 14) ? pairedChannel : 0;
  peer.encrypt = false;
  esp_err_t err = esp_now_add_peer(&peer);
  if (err != ESP_OK) {
    Serial.printf("[ESP-NOW] add_peer failed: %d\n", (int)err);
    return false;
  }
  return true;
}

void scannerSetLogicMac(const uint8_t mac[6], uint8_t channel) {
  memcpy(pairedLogicMac, mac, 6);
  logicPeerConfigured = true;
  if (channel >= 1 && channel <= 14) {
    pairedChannel = channel;
    lockChannel(pairedChannel);
  }
  prefs.begin("config", false);
  prefs.putBytes("pairedLogicMac", pairedLogicMac, 6);
  prefs.putUChar("pairedChan", pairedChannel);
  prefs.end();
  ensureEspNowPeer(pairedLogicMac);
  scannerAdvertiseStop();
  Serial.printf("[Pair] logic board MAC = %s ch=%u\n",
                scannerMacToString(pairedLogicMac).c_str(), (unsigned)pairedChannel);
}

void scannerChannelSweepTick() {
  if (logicPeerConfigured) return;
  static unsigned long lastHopMs = 0;
  static uint8_t ch = 1;
  if (millis() - lastHopMs < 300) return;
  lastHopMs = millis();
  lockChannel(ch);
  if (++ch > 13) ch = 1;
}

#if ESP_ARDUINO_VERSION_MAJOR >= 3
static void onEspNowRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  (void)info;
  if (!data || len != (int)sizeof(EspNowPairMsg)) return;
  EspNowPairMsg msg;
  memcpy(&msg, data, sizeof(msg));
  if (msg.magic != ESPNOW_PAIR_MAGIC) return;
  scannerSetLogicMac(msg.logicMac, msg.channel);
}
#else
static void onEspNowRecv(const uint8_t* mac, const uint8_t* data, int len) {
  (void)mac;
  if (!data || len != (int)sizeof(EspNowPairMsg)) return;
  EspNowPairMsg msg;
  memcpy(&msg, data, sizeof(msg));
  if (msg.magic != ESPNOW_PAIR_MAGIC) return;
  scannerSetLogicMac(msg.logicMac, msg.channel);
}
#endif

void scannerTransportInit() {
  static_assert(sizeof(ParsedDisneyPacket) <= 250, "ParsedDisneyPacket exceeds ESP-NOW cap");
  Serial.printf("[Transport] ParsedDisneyPacket sizeof=%u\n", (unsigned)sizeof(ParsedDisneyPacket));

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  esp_err_t err = esp_now_init();
  if (err != ESP_OK) {
    Serial.printf("[ESP-NOW] init result: %d\n", (int)err);
  }
  esp_now_register_recv_cb(onEspNowRecv);

  if (logicPeerConfigured) {
    if (pairedChannel >= 1 && pairedChannel <= 14) lockChannel(pairedChannel);
    ensureEspNowPeer(pairedLogicMac);
    Serial.printf("[ESP-NOW] paired to logic %s ch=%u\n",
                  scannerMacToString(pairedLogicMac).c_str(), (unsigned)pairedChannel);
  } else {
    Serial.println("[ESP-NOW] unpaired — sweeping channels for reflected pair from logic board");
  }
}

void scannerTransportSend(const ParsedDisneyPacket& pkt) {
  if (!logicPeerConfigured) return;
  esp_err_t err = esp_now_send(pairedLogicMac, (const uint8_t*)&pkt, sizeof(pkt));
  // NOTE: ESP_OK means the frame was queued for TX, not that the logic board
  // received it. Compare this ok count against the logic board's [ESP-NOW] rx
  // count (serial `status`) to gauge over-the-air delivery.
  if (err == ESP_OK) espNowSendOk++;
  else espNowSendFail++;
  if (bleScanLogEnabled) {
    Serial.printf("[ESP-NOW] tx kind=%u op=0x%04X -> %s (%s, ok/fail=%lu/%lu)\n",
                  (unsigned)pkt.kind, (unsigned)pkt.opcode,
                  scannerMacToString(pairedLogicMac).c_str(),
                  err == ESP_OK ? "queued" : "ERR",
                  (unsigned long)espNowSendOk, (unsigned long)espNowSendFail);
  }
}
