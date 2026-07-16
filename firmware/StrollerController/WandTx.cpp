#include "WandTx.h"
#include "Globals.h"
#include "Config.h"

void startWandTxCast(uint8_t palette, uint32_t durationMs) {
  wandTxCastPalette = palette & 0x1F;
  wandTxCastUntil = millis() + durationMs;
  Serial.printf("[WandTX] Cast palette=%u for %ums\n", wandTxCastPalette, durationMs);
}

void serviceWandTx() {
  unsigned long now = millis();
  bool casting = now < wandTxCastUntil;
  if (!wandTxBeacon && !casting) return;
  if (now - wandTxLastAdvMs < 200) return;
  wandTxLastAdvMs = now;

  if (casting) {
    uint8_t payload[13];
    memcpy(payload, WAND_CAST_SIG, 6);
    for (int i = 6; i < 12; i++) payload[i] = (uint8_t)random(0, 256);
    payload[12] = wandTxCastPalette;
    refreshBleAdvertising(payload, 13);
    return;
  }

  if (wandTxBeacon) {
    uint8_t idle[19];
    memcpy(idle, WAND_IDLE_PAYLOAD, 19);
    idle[18] = (uint8_t)((now / 500) & 0xFF);
    refreshBleAdvertising(idle, 19);
  }
}

// ─────────────────────────────────────────────
// BLE SCANNER — Disney 0x0183 (Adafruit CLUE_BLE_Beacon_Remote protocol)
// ─────────────────────────────────────────────

// Starlight Wand color-cast signature (13-byte payload after 0x8301 CID)

void refreshBleAdvertising(const uint8_t* disneyPayload, size_t plen) {
  NimBLEAdvertisementData advData;
  advData.setName(BLE_NAME);
  advData.setCompleteServices(NimBLEUUID(SERVICE_UUID));
  if (disneyPayload && plen > 0) {
    uint8_t mfr[32];
    mfr[0] = 0x83;
    mfr[1] = 0x01;
    memcpy(mfr + 2, disneyPayload, plen);
    advData.setManufacturerData(std::string((char*)mfr, plen + 2));
  }
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setAdvertisementData(advData);
  adv->start();
}

