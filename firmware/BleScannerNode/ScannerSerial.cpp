#include "ScannerSerial.h"
#include "Globals.h"
#include "ScannerPayloadTransport.h"
#include "ScannerAdvertise.h"
#include <WiFi.h>

void processScannerSerial() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.length() == 0) return;

  if (line == "help") {
    Serial.println("[Serial] Commands:");
    Serial.println("  status           — pairing + ESP-NOW send stats");
    Serial.println("  pair <mac>       — set logic board MAC (AA:BB:CC:DD:EE:FF)");
    Serial.println("  unpair           — clear pairing, resume unpaired advertisement");
    Serial.println("  sniff [seconds]  — log all manufacturer data (default 30)");
    Serial.println("  sniff off        — stop sniffing");
    Serial.println("  scanlog on|off   — Disney packet hex logging");
  } else if (line == "status") {
    uint8_t myMac[6];
    WiFi.macAddress(myMac);
    Serial.printf("[Status] paired=%s logic=%s espnow tx-queued ok/fail=%u/%u scanlog=%s\n",
                  logicPeerConfigured ? "yes" : "no",
                  logicPeerConfigured ? scannerMacToString(pairedLogicMac).c_str() : "(none)",
                  espNowSendOk, espNowSendFail,
                  bleScanLogEnabled ? "on" : "off");
    Serial.println("[Status] (ok=frames queued for TX; compare vs logic board 'rx' count)");
    Serial.printf("[Status] scanner MAC=%s\n", scannerMacToString(myMac).c_str());
  } else if (line.startsWith("pair ")) {
    String macStr = line.substring(5);
    macStr.trim();
    uint8_t mac[6];
    if (!scannerParseMacString(macStr.c_str(), mac)) {
      Serial.println("[Serial] usage: pair AA:BB:CC:DD:EE:FF");
    } else {
      scannerSetLogicMac(mac);
    }
  } else if (line == "unpair") {
    logicPeerConfigured = false;
    memset(pairedLogicMac, 0, 6);
    prefs.begin("config", false);
    prefs.remove("pairedLogicMac");
    prefs.end();
    scannerAdvertiseInit();
    Serial.println("[Serial] Unpaired — advertising for discovery");
  } else if (line == "scanlog on") {
    bleScanLogEnabled = true;
    Serial.println("[Serial] Scan log ON");
  } else if (line == "scanlog off") {
    bleScanLogEnabled = false;
    Serial.println("[Serial] Scan log OFF");
  } else if (line == "sniff off") {
    bleSniffUntilMs = 0;
    Serial.println("[Serial] Sniff off");
  } else if (line.startsWith("sniff")) {
    int sec = 30;
    int sp = line.indexOf(' ');
    if (sp > 0) sec = line.substring(sp + 1).toInt();
    if (sec < 1) sec = 30;
    bleSniffUntilMs = millis() + (unsigned long)sec * 1000UL;
    Serial.printf("[Serial] Sniffing ALL mfr data for %ds\n", sec);
  } else {
    Serial.printf("[Serial] Unknown: %s (type 'help')\n", line.c_str());
  }
}
