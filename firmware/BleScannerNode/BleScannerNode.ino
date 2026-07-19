/**
 * BleScannerNode — optional second ESP32 for Disney BLE scanning.
 * Filters + decodes packets, forwards ParsedDisneyPacket to logic board via ESP-NOW.
 *
 * Pairing:
 *   - Unpaired: advertises as IllumaScan (manufacturer data includes MAC)
 *   - App sets scanner MAC on logic board → reflected ESP-NOW pair closes the loop
 *   - Manual fallback: serial `pair AA:BB:CC:DD:EE:FF`
 */

#include "Globals.h"
#include "DisneyBleScan.h"
#include "ScannerPayloadTransport.h"
#include "ScannerAdvertise.h"
#include "ScannerSerial.h"
#include <NimBLEDevice.h>
#include <WiFi.h>

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[Boot] BleScannerNode");

  prefs.begin("config", true);
  bleScanLogEnabled = prefs.getBool("scanLog", true);
  {
    size_t macLen = prefs.getBytesLength("pairedLogicMac");
    if (macLen == 6) {
      prefs.getBytes("pairedLogicMac", pairedLogicMac, 6);
      logicPeerConfigured = true;
    }
  }
  prefs.end();

  // Lower BLE TX power before the radio comes up — reduces the current spike that
  // trips the brownout detector on marginal USB power. -3 dBm is plenty co-located.
  NimBLEDevice::init("IllumaScanner");
  NimBLEDevice::setPower(-3);
  delay(300);

  // Stagger radio bring-up so BLE + WiFi(STA) init spikes don't stack.
  scannerTransportInit();
  delay(300);

  if (!logicPeerConfigured) {
    scannerAdvertiseInit();
    delay(150);
  }

  startBLEScan();

  uint8_t mac[6];
  WiFi.macAddress(mac);
  Serial.printf("[Boot] Ready — scanner MAC %s paired=%s\n",
                scannerMacToString(mac).c_str(),
                logicPeerConfigured ? "yes" : "no");
  Serial.println("[Serial] Type 'help' for commands");
}

void loop() {
  processScannerSerial();
  if (!logicPeerConfigured) {
    scannerAdvertiseRefresh();
  }
  delay(10);
}
