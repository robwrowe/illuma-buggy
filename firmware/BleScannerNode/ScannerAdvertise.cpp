#include "ScannerAdvertise.h"
#include "ScannerPayloadTransport.h"
#include "Globals.h"
#include "Config.h"
#include <NimBLEDevice.h>
#include <WiFi.h>

// Short advertised name so the whole primary advertisement fits in 31 bytes:
// name(2+10=12) + manufacturer data(2+8=10) = 22 bytes. The old 22-char name
// overflowed the 31-byte limit and caused the manufacturer data (which the app
// keys on) to be silently dropped, so the phone never saw the scanner.
static const char* SCANNER_ADV_NAME = "IllumaScan";
static bool scannerAdvActive = false;

void scannerAdvertiseStop() {
  if (!scannerAdvActive) return;
  NimBLEDevice::getAdvertising()->stop();
  scannerAdvActive = false;
  Serial.println("[Adv] Unpaired advertisement stopped");
}

void scannerAdvertiseRefresh() {
  if (logicPeerConfigured) {
    scannerAdvertiseStop();
    return;
  }
  // Advertising persists once started; avoid re-issuing setAdvertisementData /
  // start() on every loop tick, which thrashes the controller.
  if (scannerAdvActive) return;

  uint8_t mac[6];
  WiFi.macAddress(mac);
  uint8_t mfr[8];
  mfr[0] = SCANNER_MFR_MAGIC_0;
  mfr[1] = SCANNER_MFR_MAGIC_1;
  memcpy(mfr + 2, mac, 6);

  NimBLEAdvertisementData advData;
  advData.setName(SCANNER_ADV_NAME);
  advData.setManufacturerData(std::string((char*)mfr, sizeof(mfr)));

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setAdvertisementData(advData);
  adv->start();
  scannerAdvActive = true;
  Serial.printf("[Adv] Unpaired beacon %s MAC=%s\n",
                SCANNER_ADV_NAME, scannerMacToString(mac).c_str());
}

void scannerAdvertiseInit() {
  if (logicPeerConfigured) return;
  scannerAdvertiseRefresh();
}
