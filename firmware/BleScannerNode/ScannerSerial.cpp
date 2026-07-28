#include "ScannerSerial.h"
#include "Globals.h"
#include "ScannerPayloadTransport.h"
#include "SdRawLogger.h"
#include "Config.h"
#include <esp_mac.h>

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
    Serial.println("  status           — UART link + forward stats");
    Serial.println("  sniff [seconds]  — log all manufacturer data (default 30)");
    Serial.println("  sniff off        — stop sniffing");
    Serial.println("  scanlog on|off   — Disney packet hex logging");
  } else if (line == "status") {
    uint8_t myMac[6];
    fillScannerMac(myMac);
    unsigned long now = millis();
    const char* link = "never";
    char ageBuf[24] = "never";
    if (lastLogicHbMs) {
      unsigned long age = now - lastLogicHbMs;
      link = (age < SCANNER_ALIVE_MS) ? "OK" : "LOST";
      snprintf(ageBuf, sizeof(ageBuf), "%lums ago", age);
    }
    Serial.printf("[Status] link=%s logic_hb=%s fwd_seq=%u scanlog=%s sd=%s MAC=%s\n",
                  link,
                  ageBuf,
                  uartFwdSeq,
                  bleScanLogEnabled ? "on" : "off",
                  sdRawLoggerReady() ? "ok" : "--",
                  scannerMacToString(myMac).c_str());
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
