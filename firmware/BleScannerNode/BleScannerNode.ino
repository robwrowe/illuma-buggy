/**
 * BleScannerNode — optional second ESP32 for Disney BLE scanning.
 * Filters + decodes packets, forwards to logic via UART.
 *
 * Boards:
 *   - ESP32-S3-DevKitC-1 (onboard RGB: GPIO 38 on v1.1+, GPIO 48 on v1.0)
 *   - ESP32-DevKitC-32 (ESP-32D / WROOM-32D, 38-pin, CP2102 USB-C — WandSim class)
 *     — no onboard RGB; StatusLed is a no-op.
 *     UART: TX=GPIO17 RX=GPIO16. Wire to S3 logic: 17→RX**18**, 16←TX17, GND–GND.
 *     OLED (optional): SDA=GPIO21 SCL=GPIO22, 128×64 SSD1306 I2C @ 0x3C.
 *
 * Arduino IDE: Board = "ESP32 Dev Module" (not ESP32S3).
 *
 * No wireless pairing — cross-wire UART and shared GND. Heartbeats keep the
 * logic board's link-alive timer fresh when Disney air is quiet. Logic replies
 * to heartbeats so the scanner OLED can show Link:OK.
 */

#include "Globals.h"
#include "DisneyBleScan.h"
#include "ScannerPayloadTransport.h"
#include "ScannerSerial.h"
#include "ScannerStatusDisplay.h"
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
  prefs.end();

  // Lower BLE TX power before the radio comes up — reduces the current spike that
  // trips the brownout detector on marginal USB power. -3 dBm is plenty co-located.
  NimBLEDevice::init("IllumaScanner");
  NimBLEDevice::setPower(-3);
  delay(300);

  // UART only — no WiFi/ESP-NOW (avoids brownout on weak USB with NimBLE).
  scannerTransportInit();
  delay(300);

  sdRawLoggerInit();
  statusLedInit();
  scannerStatusDisplayInit();

  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_BT);
  Serial.printf("[Boot] Ready — scanner MAC %s uart=1\n",
                scannerMacToString(mac).c_str());
  Serial.println("[Serial] Type 'help' for commands");

  // Start scan last so a callback flood can't WDT us before Ready prints.
  startBLEScan();
}

void loop() {
  statusLedTick();
  processScannerSerial();
  scannerUartPoll();
  scannerUartHeartbeatTick();
  scannerStatusDisplayUpdate();
  delay(10);
}
