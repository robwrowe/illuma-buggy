#include "DisneyBleScan.h"
#include "Globals.h"
#include "DisneyBleFilter.h"
#include "MbPacketDecode.h"
#include "ScannerPayloadTransport.h"
#include "DebugLog.h"
#include "Config.h"
#include <NimBLEDevice.h>
#include <string>
#include <string.h>

class DisneyBLEScanCallbacks : public NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice* device) {
    if (!device->haveManufacturerData()) return;
    std::string mfr = device->getManufacturerData();
    if (mfr.size() < 2) return;
    const uint8_t* data = (const uint8_t*)mfr.data();
    size_t len = mfr.size();
    int rssi = device->getRSSI();

    // Sniff stays in onResult: only active during operator-triggered windows.
    if (millis() < bleSniffUntilMs) {
      serialLogSniffPacket(rssi, data, len);
    }

    if (!isDisneyMfr(data, len)) return;
    lastDisneySeenMs = millis();

    bool isNew = scanDedupIsNew(data, len);

    const uint8_t* payload;
    size_t plen;
    disneyPayload(data, len, payload, plen);
    if (plen == 0) return;

    ParsedDisneyPacket pkt = decodeDisneyPayload(payload, plen, millis());
    pkt.rssi = (int8_t)constrain(rssi, -128, 127);
    // UNKNOWN frames are keepalives for the logic board watchdog AND candidates for
    // parade-beacon / rule-engine matching on the logic board.
    if (pkt.kind == DisneyPacketKind::UNKNOWN) {
      if (pkt.rawLen == 0 && plen > 0) {
        size_t n = plen < PARSED_PACKET_RAW_MAX ? plen : PARSED_PACKET_RAW_MAX;
        memcpy(pkt.rawPayload, payload, n);
        pkt.rawLen = (uint8_t)n;
        pkt.hasRawFallback = 1;
      }
      // Rate-limit identical idle/ping frames; always forward strong-signal packets
      // so proximity beacons aren't dropped by the keepalive throttle.
      static unsigned long lastUnknownFwdMs = 0;
      bool strongSignal = pkt.rssi >= -75;
      if (!isNew && !strongSignal && (millis() - lastUnknownFwdMs) < 2000) return;
      lastUnknownFwdMs = millis();
    }

    // Push to ring — UART / Serial I/O happens in drainScanRing() from loop().
    uint8_t next = (uint8_t)((scanRingHead + 1) % SCAN_RING_SIZE);
    if (next == scanRingTail) {
      // Ring full — drop oldest rather than block. Count it so it's visible.
      scanRingTail = (uint8_t)((scanRingTail + 1) % SCAN_RING_SIZE);
      scanRingDropped++;
    }
    scanRing[scanRingHead].pkt = pkt;
    scanRing[scanRingHead].valid = true;
    scanRingHead = next;
  }
};

void drainScanRing() {
  while (scanRingTail != scanRingHead) {
    ScanRingSlot& slot = scanRing[scanRingTail];
    if (slot.valid) {
      scannerTransportSend(slot.pkt);
      slot.valid = false;
    }
    scanRingTail = (uint8_t)((scanRingTail + 1) % SCAN_RING_SIZE);
  }
  static unsigned long lastDropLogMs = 0;
  if (scanRingDropped > 0 && millis() - lastDropLogMs > 5000) {
    lastDropLogMs = millis();
    Serial.printf("[Scan] ring drops so far: %lu\n", (unsigned long)scanRingDropped);
  }
}

void startBLEScan() {
  NimBLEScan* scan = NimBLEDevice::getScan();
  scan->setScanCallbacks(new DisneyBLEScanCallbacks(), true);
#if CONFIG_IDF_TARGET_ESP32S3
  scan->setActiveScan(true);
  scan->setInterval(80);   // 50 ms
  scan->setWindow(79);     // ~continuous
#else
  // Classic ESP32: onResult() now only does math + ring-buffer push (no I/O),
  // so near-continuous duty is safe — matches the S3 logic board.
  // Field-test incrementally (e.g. 100/90 first) if TWDT or ring drops appear.
  scan->setActiveScan(true);
  scan->setInterval(80);   // 50 ms
  scan->setWindow(79);     // ~continuous
#endif
  scan->setDuplicateFilter(false);
  scan->start(0, false);
  Serial.println("[BLE] Scanner started (active, continuous, no dedup)");
  Serial.printf("[BLE] Scan logging: %s\n", bleScanLogEnabled ? "ON" : "OFF");
}
