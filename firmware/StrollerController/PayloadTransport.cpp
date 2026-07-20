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
uint32_t parsedPacketDropCount = 0;

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

  // When a scanner peer is configured, ignore frames from other MACs so a stale /
  // wrong peer (or another board) cannot keep lastScannerPacketMs "alive" and
  // block local-scan fallback.
  if (scannerPeerConfigured && mac && memcmp(mac, scannerPeerMac, 6) != 0) {
    espNowRxRejected++;
    if (espNowRxRejected <= 5 || (espNowRxRejected % 100) == 0) {
      Serial.printf("[ESP-NOW] ignore non-peer %s (want %s) rejected=%lu\n",
                    transportMacToString(mac).c_str(),
                    transportMacToString(scannerPeerMac).c_str(),
                    (unsigned long)espNowRxRejected);
    }
    return;
  }

  const char* typeLabel = "other";
  if (len == (int)sizeof(ParsedDisneyPacket)) typeLabel = "scan";
  else if (len == (int)sizeof(EspNowPairMsg)) typeLabel = "pair";

  // Reflected pairing is scanner-side; logic board only accepts ParsedDisneyPacket.
  if (len == (int)sizeof(ParsedDisneyPacket)) {
    ParsedDisneyPacket pkt;
    memcpy(&pkt, data, sizeof(pkt));
    lastScannerPacketMs = millis();
    espNowRxCount++;
    // Always log early packets + periodic thereafter (proof scanner→logic path is alive).
    if (espNowRxCount <= 40 || (espNowRxCount % 25) == 0) {
      Serial.printf("[ESP-NOW] recv from %s: len=%d type=%s rx=#%lu kind=%u op=0x%04X\n",
                    mac ? transportMacToString(mac).c_str() : "?",
                    len, typeLabel, (unsigned long)espNowRxCount,
                    (unsigned)pkt.kind, (unsigned)pkt.opcode);
    }
    queueParsedPacket(pkt);
    return;
  }

  espNowRxRejected++;
  Serial.printf("[ESP-NOW] recv from %s: len=%d type=%s — ignored (expected %u) rejected=%lu\n",
                mac ? transportMacToString(mac).c_str() : "?",
                len, typeLabel, (unsigned)sizeof(ParsedDisneyPacket),
                (unsigned long)espNowRxRejected);
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
static bool espNowReady = false;

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

  // Peer is (re)added by transportEnsureEspNow() after WiFi connects; add now only if
  // ESP-NOW is already up. The loop-driven pair beacon does the actual pairing once WiFi
  // is connected so the advertised channel is the stable AP channel.
  if (espNowReady) ensureEspNowPeer(scannerPeerMac);
  Serial.println("[ESP-NOW] scanner MAC set — beaconing pair on stable channel");
}

static bool scannerLinkAlive() {
  return lastScannerPacketMs != 0 && (millis() - lastScannerPacketMs < SCANNER_ALIVE_MS);
}

void transportPairResendTick() {
  if (boardRole != BoardRole::LOGIC_BOARD || !scannerPeerConfigured) return;
  // Only beacon once WiFi is connected (so the advertised channel is the stable AP
  // channel) and ESP-NOW has been (re)initialized after that connect.
  if (WiFi.status() != WL_CONNECTED || !espNowReady) return;
  if (scannerLinkAlive()) return;  // packets flowing — already paired & healthy
  // While on local-scan fallback, beacon slowly (pairing still useful) — don't flood serial.
  unsigned long interval = localScanFallbackActive ? 5000UL : 200UL;
  if (millis() - lastPairSendMs >= interval) sendPairMessage();
}

void serviceScannerFallback() {
  if (boardRole != BoardRole::LOGIC_BOARD) return;

  if (!localScanFallbackActive) {
    unsigned long now = millis();
    unsigned long silentFor = lastScannerPacketMs ? (now - lastScannerPacketMs) : now;
    if (silentFor > SCANNER_ABSENT_MS) {
      Serial.printf("[Fallback] lastScanPacketMs=%lu now=%lu delta=%lu threshold=%lu\n",
                    (unsigned long)lastScannerPacketMs, (unsigned long)now,
                    (unsigned long)silentFor, (unsigned long)SCANNER_ABSENT_MS);
      Serial.println("[Fallback] Scanner silent — starting local BLE scan on logic board");
      startBLEScan();
      localScanFallbackActive = true;
    }
  } else if (scannerLinkAlive()) {
    Serial.println("[Fallback] Scanner back online — stopping local BLE scan");
    stopBLEScan();
    localScanFallbackActive = false;
  }
}

/** Switch scan / ESP-NOW behavior immediately when boardRole changes (no reboot). */
void applyBoardRoleRuntime() {
  if (boardRole == BoardRole::STANDALONE) {
    localScanFallbackActive = false;
    lastScannerPacketMs = 0;
    startBLEScan();
    Serial.println("[Role] STANDALONE — local BLE scan active (no reboot needed)");
    return;
  }

  // LOGIC_BOARD: stop local scan; ESP-NOW + pair beacon / fallback take over.
  stopBLEScan();
  localScanFallbackActive = false;
  lastScannerPacketMs = 0;
  payloadTransportInit();
  if (WiFi.status() == WL_CONNECTED) transportEnsureEspNow();
  Serial.println("[Role] LOGIC_BOARD — local scan off; ESP-NOW / 20s fallback");
}

void payloadTransportInit() {
  static_assert(sizeof(ParsedDisneyPacket) <= 250, "ParsedDisneyPacket exceeds ESP-NOW payload cap");
  Serial.printf("[Transport] ParsedDisneyPacket sizeof=%u (ESP-NOW cap 250)\n",
                (unsigned)sizeof(ParsedDisneyPacket));

  if (boardRole != BoardRole::LOGIC_BOARD) {
    Serial.println("[Transport] STANDALONE — local decode mailbox, no ESP-NOW recv");
    return;
  }

  // Defer ESP-NOW bring-up until WiFi is connected. connectToWLED() calls
  // WiFi.disconnect(true), which powers off the WiFi driver and tears down ESP-NOW, so
  // any init done here would be dead by the time we need it. transportEnsureEspNow() is
  // (re)called after every successful WiFi connect instead.
  Serial.println("[ESP-NOW] LOGIC_BOARD — ESP-NOW inits after WiFi connects");
  Serial.printf("[Fallback] SCANNER_ABSENT_MS=%lu SCANNER_ALIVE_MS=%lu "
                "(local scan starts only after absent window with no ESP-NOW scan packets)\n",
                (unsigned long)SCANNER_ABSENT_MS, (unsigned long)SCANNER_ALIVE_MS);
}

void transportEnsureEspNow() {
  if (boardRole != BoardRole::LOGIC_BOARD) return;

  if (WiFi.getMode() != WIFI_STA && WiFi.getMode() != WIFI_AP_STA) {
    WiFi.mode(WIFI_STA);
  }

  // Deinit first to clear any stale state left after WiFi.disconnect(true) tore the
  // driver down; then a fresh init binds ESP-NOW to the now-connected STA channel.
  espNowReady = false;
  esp_now_deinit();
  esp_err_t err = esp_now_init();
  if (err != ESP_OK) {
    Serial.printf("[ESP-NOW] init failed: %d\n", (int)err);
    return;
  }
  esp_now_register_recv_cb(onEspNowRecv);
  if (scannerPeerConfigured) ensureEspNowPeer(scannerPeerMac);
  espNowReady = true;
  Serial.printf("[ESP-NOW] ready ch=%u peer=%s\n",
                (unsigned)WiFi.channel(),
                scannerPeerConfigured ? transportMacToString(scannerPeerMac).c_str() : "(none)");
}

void transportSendParsedPacket(const ParsedDisneyPacket& pkt) {
  // This sketch always applies locally: STANDALONE scans here; scanner-node sketch
  // (Pass 4) will esp_now_send instead. LOGIC_BOARD does not call this from scan.
  queueParsedPacket(pkt);
}

void processParsedPacketQueue() {
  if (parsedPacketDropCount != lastLoggedDropCount) {
    Serial.printf("[ESP-NOW] parsed packet drops=%lu (queue full; oldest discarded)\n",
                  (unsigned long)parsedPacketDropCount);
    lastLoggedDropCount = parsedPacketDropCount;
  }

  // Drain everything currently queued so a backlog from a stalled loop()
  // iteration is processed promptly once loop() resumes.
  while (true) {
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
