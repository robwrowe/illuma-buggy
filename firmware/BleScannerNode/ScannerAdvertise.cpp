#include "ScannerAdvertise.h"
#include "ScannerPayloadTransport.h"
#include "Globals.h"
#include "Config.h"
#include <NimBLEDevice.h>
#include <WiFi.h>

static const char* SCANNER_UNPAIRED_NAME = "IllumaScanner-unpaired";
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

  uint8_t mac[6];
  WiFi.macAddress(mac);
  uint8_t mfr[8];
  mfr[0] = SCANNER_MFR_MAGIC_0;
  mfr[1] = SCANNER_MFR_MAGIC_1;
  memcpy(mfr + 2, mac, 6);

  NimBLEAdvertisementData advData;
  advData.setName(SCANNER_UNPAIRED_NAME);
  advData.setManufacturerData(std::string((char*)mfr, sizeof(mfr)));

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setAdvertisementData(advData);
  if (!scannerAdvActive) {
    adv->start();
    scannerAdvActive = true;
    Serial.printf("[Adv] Unpaired beacon %s MAC=%s\n",
                  SCANNER_UNPAIRED_NAME, scannerMacToString(mac).c_str());
  } else {
    adv->start();
  }
}

void scannerAdvertiseInit() {
  if (logicPeerConfigured) return;
  scannerAdvertiseRefresh();
}
