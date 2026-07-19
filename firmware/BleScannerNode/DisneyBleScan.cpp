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

    if (millis() < bleSniffUntilMs) {
      serialLogSniffPacket(rssi, data, len);
    }

    if (!isDisneyMfr(data, len)) return;

    const char* tag = classifyScanPacket(data, len);
    bool isNew = scanDedupIsNew(data, len);
    serialLogScanPacket(tag, rssi, data, len, isNew);
    notifyBleCapturePacket(tag, rssi, data, len, isNew);

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
    scannerTransportSend(pkt);
  }
};

void startBLEScan() {
  NimBLEScan* scan = NimBLEDevice::getScan();
  scan->setScanCallbacks(new DisneyBLEScanCallbacks(), true);
  scan->setActiveScan(true);
  scan->setInterval(80);
  scan->setWindow(79);
  scan->setDuplicateFilter(false);
  scan->start(0, false);
  Serial.println("[BLE] Scanner started (active, continuous, no dedup)");
  Serial.printf("[BLE] Scan logging: %s\n", bleScanLogEnabled ? "ON" : "OFF");
}
