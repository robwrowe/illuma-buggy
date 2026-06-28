/**
 * WandSimulator — Second ESP32 to broadcast test Disney BLE packets.
 *
 * Use this to verify IllumaBuggy (StrollerController) receives wand casts
 * without relying on the physical wand's button gesture.
 *
 * Flash to a spare ESP32 (any DevKit). USB Serial @ 115200.
 *
 * Commands:
 *   help              — list commands
 *   cast <0-31>       — Adafruit CF0B00C42022 wand color cast (~3s)
 *   legacy <0-31>     — Older CF9B wiki format cast (~3s)
 *   mb <0-31>         — MagicBand+ E905 single palette (~3s)
 *   idle              — Broadcast 0F11 idle beacon (like your real wand)
 *   loop <0-31>       — Repeat cast every 5s until any key
 *
 * Keep this board ~1m from the StrollerController ESP32.
 * StrollerController should show [Scan:WAND-CAST] NEW and fire lights on "cast".
 *
 * Protocol reference: Adafruit CLUE_BLE_Beacon_Remote / magicband_protocol.py
 */

#include <NimBLEDevice.h>

static const uint8_t WAND_CAST_SIG[6] = {0xCF, 0x0B, 0x00, 0xC4, 0x20, 0x22};
static const uint8_t IDLE_PAYLOAD[19] = {
  0x0F, 0x11, 0x01, 0x4B, 0x72, 0x99, 0x08, 0x83, 0x0A, 0x66,
  0xD4, 0x85, 0xCD, 0x9F, 0x95, 0x75, 0xA8, 0xA3, 0x21
};

NimBLEAdvertising* adv = nullptr;
bool loopCast = false;
uint8_t loopPalette = 4;

void mfrHex(const uint8_t* data, size_t len) {
  for (size_t i = 0; i < len; i++) {
    if (data[i] < 0x10) Serial.print('0');
    Serial.print(data[i], HEX);
  }
  Serial.println();
}

void broadcastMfr(const uint8_t* payload, size_t plen, uint32_t durationMs) {
  if (plen > 27) {
    Serial.println("[TX] payload too long");
    return;
  }
  uint8_t mfr[29];
  mfr[0] = 0x83;
  mfr[1] = 0x01;
  memcpy(mfr + 2, payload, plen);
  size_t mfrLen = plen + 2;

  NimBLEAdvertisementData advData;
  advData.setManufacturerData(std::string((char*)mfr, mfrLen));

  Serial.printf("[TX] Broadcasting %ums (%u bytes): ", durationMs, (unsigned)mfrLen);
  mfrHex(mfr, mfrLen);

  adv->stop();
  adv->setAdvertisementData(advData);
  adv->setScanResponseData(advData);
  adv->start();
  delay(durationMs);
  adv->stop();
  Serial.println("[TX] Done");
}

void broadcastWandCast(uint8_t palette) {
  uint8_t payload[13];
  memcpy(payload, WAND_CAST_SIG, 6);
  for (int i = 6; i < 12; i++) payload[i] = (uint8_t)random(0, 256);
  payload[12] = palette & 0x1F;
  broadcastMfr(payload, 13, 3000);
}

void broadcastLegacyCast(uint8_t palette) {
  // Community wiki example body; palette in last byte
  uint8_t payload[12] = {
    0xCF, 0x9B, 0x00, 0xC4, 0x29, 0x22, 0xEF, 0xD8, 0x19, 0xF2, 0x2A, 0x00
  };
  payload[11] = palette & 0x1F;
  broadcastMfr(payload, 12, 3000);
}

void broadcastMbSingle(uint8_t palette) {
  // E1 00 E9 05 — build_single_color from Adafruit (timing 0x09, mask 0)
  uint8_t colorByte = palette & 0x1F;
  uint8_t payload[9] = {0xE1, 0x00, 0xE9, 0x05, 0x00, 0x09, 0x0E, colorByte, 0xB0};
  broadcastMfr(payload, 9, 3000);
}

void broadcastIdle() {
  broadcastMfr(IDLE_PAYLOAD, sizeof(IDLE_PAYLOAD), 5000);
}

void printHelp() {
  Serial.println("[WandSim] Commands:");
  Serial.println("  cast <0-31>    — CF0B wand color cast (Adafruit format)");
  Serial.println("  legacy <0-31>  — CF9B wiki format");
  Serial.println("  mb <0-31>      — MagicBand+ single palette");
  Serial.println("  idle           — 0F11 idle beacon (5s)");
  Serial.println("  loop <0-31>    — repeat cast every 5s (any key to stop)");
  Serial.println("  help");
}

void handleLine(String line) {
  line.trim();
  line.toLowerCase();
  if (line.length() == 0) return;

  if (line == "help") {
    printHelp();
    return;
  }
  if (line == "idle") {
    broadcastIdle();
    return;
  }
  if (line.startsWith("cast ")) {
    broadcastWandCast((uint8_t)line.substring(5).toInt());
    return;
  }
  if (line.startsWith("legacy ")) {
    broadcastLegacyCast((uint8_t)line.substring(7).toInt());
    return;
  }
  if (line.startsWith("mb ")) {
    broadcastMbSingle((uint8_t)line.substring(3).toInt());
    return;
  }
  if (line.startsWith("loop ")) {
    loopPalette = (uint8_t)line.substring(5).toInt();
    loopCast = true;
    Serial.printf("[WandSim] Loop cast palette %u every 5s — send any command to stop\n", loopPalette);
    return;
  }

  loopCast = false;
  Serial.printf("[WandSim] Unknown: %s\n", line.c_str());
  printHelp();
}

void setup() {
  Serial.begin(115200);
  delay(500);
  randomSeed(esp_random());

  Serial.println();
  Serial.println("[WandSim] Starlight / MB+ BLE packet broadcaster");
  NimBLEDevice::init("WandSim");
  adv = NimBLEDevice::getAdvertising();
  adv->setMinInterval(32);
  adv->setMaxInterval(64);
  printHelp();
}

void loop() {
  if (loopCast) {
    broadcastWandCast(loopPalette);
    unsigned long next = millis() + 5000;
    while (millis() < next) {
      if (Serial.available()) {
        loopCast = false;
        handleLine(Serial.readStringUntil('\n'));
        return;
      }
      delay(20);
    }
    return;
  }

  if (Serial.available()) {
    handleLine(Serial.readStringUntil('\n'));
  }
  delay(10);
}
