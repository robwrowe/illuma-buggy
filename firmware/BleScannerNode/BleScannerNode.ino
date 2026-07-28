/**
 * BleScannerNode — optional second ESP32 for Disney BLE scanning.
 * Filters + decodes packets, forwards to logic via UART (or ESP-NOW).
 *
 * Boards:
 *   - ESP32-S3-DevKitC-1 (onboard RGB status LED on GPIO 48)
 *   - ESP32-DevKitC-32 (ESP-32D / WROOM-32D, 38-pin, CP2102 USB-C — WandSim class)
 *     — no onboard RGB; StatusLed is a no-op.
 *     UART: TX=GPIO17 RX=GPIO16. Wire to S3 logic: 17→RX8, 16←TX17, GND–GND.
 *
 * Arduino IDE: Board = "ESP32 Dev Module" (not ESP32S3).
 *
 * Pairing (ESP-NOW mode only):
 *   - Unpaired: advertises as IllumaScan (manufacturer data includes MAC)
 *   - App sets scanner MAC on logic board → reflected ESP-NOW pair closes the loop
 *   - Manual fallback: serial `pair AA:BB:CC:DD:EE:FF`
 */

#include "Globals.h"
#include "DisneyBleScan.h"
#include "ScannerPayloadTransport.h"
#include "ScannerAdvertise.h"
#include "ScannerSerial.h"
#include "SdRawLogger.h"
#include "StatusLed.h"
#include <NimBLEDevice.h>
#include <esp_mac.h>

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[Boot] BleScannerNode");
#if CONFIG_IDF_TARGET_ESP32S3
  Serial.println("[Boot] target=ESP32-S3 statusLed=neo");
#else
  Serial.println("[Boot] target=ESP32 statusLed=none (DevKitC-32 / ESP-32D)");
#endif

  prefs.begin("config", true);
  bleScanLogEnabled = prefs.getBool("scanLog", true);
  {
    size_t macLen = prefs.getBytesLength("pairedLogicMac");
    if (macLen == 6) {
      prefs.getBytes("pairedLogicMac", pairedLogicMac, 6);
      logicPeerConfigured = true;
    }
    pairedChannel = prefs.getUChar("pairedChan", 0);
  }
  prefs.end();

  // Lower BLE TX power before the radio comes up — reduces the current spike that
  // trips the brownout detector on marginal USB power. -3 dBm is plenty co-located.
  NimBLEDevice::init("IllumaScanner");
  NimBLEDevice::setPower(-3);
  delay(300);

  // UART mode skips WiFi/ESP-NOW (big current spike). ESP-NOW path still staggers.
  scannerTransportInit();
  delay(300);

#if !USE_UART_SCANNER_LINK
  if (!logicPeerConfigured) {
    scannerAdvertiseInit();
    delay(150);
  }
#endif

  // SD before BLE scan — on classic ESP32 this is a no-op (flash pin conflict).
  sdRawLoggerInit();
  statusLedInit();

  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_BT);
  Serial.printf("[Boot] Ready — scanner MAC %s paired=%s uart=%d\n",
                scannerMacToString(mac).c_str(),
                logicPeerConfigured ? "yes" : "no",
                USE_UART_SCANNER_LINK);
  Serial.println("[Serial] Type 'help' for commands");

  // Start scan last so a callback flood can't WDT us before Ready prints.
  startBLEScan();
}

void loop() {
  statusLedTick();
  processScannerSerial();
#if !USE_UART_SCANNER_LINK
  if (!logicPeerConfigured) {
    scannerAdvertiseRefresh();
    scannerChannelSweepTick();
  }
#endif
  delay(10);
}
