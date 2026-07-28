#include "ScannerSerial.h"
#include "Globals.h"
#include "ScannerPayloadTransport.h"
#include "ScannerAdvertise.h"
#include <esp_mac.h>
#if !USE_UART_SCANNER_LINK
#include <WiFi.h>
#endif

static void fillScannerMac(uint8_t out[6]) {
  esp_read_mac(out, ESP_MAC_BT);
}

void processScannerSerial() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.length() == 0) return;

  if (line == "help") {
    Serial.println("[Serial] Commands:");
    Serial.println("  status           — link + forward stats");
#if !USE_UART_SCANNER_LINK
    Serial.println("  pair <mac>       — set logic board MAC (AA:BB:CC:DD:EE:FF)");
    Serial.println("  unpair           — clear pairing, resume unpaired advertisement");
#endif
    Serial.println("  sniff [seconds]  — log all manufacturer data (default 30)");
    Serial.println("  sniff off        — stop sniffing");
    Serial.println("  scanlog on|off   — Disney packet hex logging");
  } else if (line == "status") {
    uint8_t myMac[6];
    fillScannerMac(myMac);
#if USE_UART_SCANNER_LINK
    Serial.printf("[Status] uart=1 fwd_seq=%u scanlog=%s scanner MAC=%s\n",
                  espNowTxSeq,
                  bleScanLogEnabled ? "on" : "off",
                  scannerMacToString(myMac).c_str());
#else
    Serial.printf("[Status] paired=%s logic=%s ch=%u espnow tx-queued ok/fail=%u/%u cb ok/fail=%u/%u seq=%u scanlog=%s\n",
                  logicPeerConfigured ? "yes" : "no",
                  logicPeerConfigured ? scannerMacToString(pairedLogicMac).c_str() : "(none)",
                  (unsigned)pairedChannel,
                  espNowSendOk, espNowSendFail,
                  espNowSendCbOk, espNowSendCbFail, espNowTxSeq,
                  bleScanLogEnabled ? "on" : "off");
    Serial.println("[Status] (queued=esp_now_send OK; cb=over-the-air — compare cb-ok vs logic board rx)");
    Serial.printf("[Status] scanner MAC=%s\n", scannerMacToString(myMac).c_str());
#endif
#if !USE_UART_SCANNER_LINK
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
    pairedChannel = 0;
    prefs.begin("config", false);
    prefs.remove("pairedLogicMac");
    prefs.remove("pairedChan");
    prefs.end();
    scannerAdvertiseInit();
    Serial.println("[Serial] Unpaired — advertising + sweeping channels for discovery");
#endif
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
