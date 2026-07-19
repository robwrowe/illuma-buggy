#include "SerialConsole.h"
#include "Globals.h"
#include "WandTx.h"
#include "DebugLog.h"
#include "OverrideManager.h"
#include "MbEffects.h"
#include "ColorPalette.h"
#include "WledClient.h"
#include "BlePeripheral.h"
#include "WiFiManager.h"
#include "PayloadTransport.h"
#include "Config.h"

void processSerialCommands() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.length() == 0) return;

  if (line == "help") {
    Serial.println("[Serial] Commands:");
    Serial.println("  status           — WiFi, override, preset, queue");
    Serial.println("  wled si          — GET WLED state (fx/bri/segments)");
    Serial.println("  sniff [seconds]  — log every BLE mfr packet (default 30)");
    Serial.println("  sniff off        — stop sniffing");
    Serial.println("  tx on            — broadcast WAND-IDLE beacon (pairing test)");
    Serial.println("  tx off           — stop wand TX beacon");
    Serial.println("  tx cast <0-31>   — broadcast WAND-CAST for 3s");
    Serial.println("  chase speed <0-255>   — MB chase sx (0 = static)");
    Serial.println("  chase thick <1-50>    — MB chase grp (pixels per block)");
    Serial.println("  mb five <tl bl br tr c>  — E909 five corners (palette 0-31)");
    Serial.println("  mb <palette> [mask]      — E905 single color (mask 0 = all)");
    Serial.println("  mb defer on|off          — forward E9 to app vs firmware apply");
    Serial.println("  role standalone|logic    — board role (reboot to apply scan)");
    Serial.println("  scanner <mac>            — set ESP-NOW scanner MAC (AA:BB:...)");
    Serial.println("  nvs wifi                 — dump stored vs in-memory WiFi config");
  } else if (line == "status") {
    Serial.printf("[Status] WiFi=%s override=%d preset=%s bri=%d queue=%u role=%s scanner=%s age=%lums\n",
                  WiFi.status() == WL_CONNECTED ? "up" : "down",
                  (int)currentOverride,
                  currentPresetId.length() ? currentPresetId.c_str() : "(none)",
                  currentBrightness,
                  (unsigned)uxQueueMessagesWaiting(cmdQueue),
                  boardRole == BoardRole::LOGIC_BOARD ? "logic" : "standalone",
                  scannerPeerConfigured ? transportMacToString(scannerPeerMac).c_str() : "(none)",
                  lastScannerPacketMs ? (millis() - lastScannerPacketMs) : 0UL);
    Serial.printf("[Status] ESP-NOW rx=%lu rejected=%lu last=%s\n",
                  (unsigned long)espNowRxCount, (unsigned long)espNowRxRejected,
                  lastScannerPacketMs ? String((millis() - lastScannerPacketMs)) + "ms ago" : String("never"));
  } else if (line == "nvs wifi") {
    Preferences dbgPrefs;
    dbgPrefs.begin("config", true);
    String nvsSsid = dbgPrefs.getString("wledSsid", "<not set>");
    String nvsPass = dbgPrefs.getString("wledPass", "<not set>");
    String nvsIp   = dbgPrefs.getString("wledIp", "<not set>");
    int    nvsPort = dbgPrefs.getInt("wledPort", -1);
    dbgPrefs.end();

    Serial.println("[NVS] --- Stored in flash (config namespace) ---");
    Serial.printf("[NVS] wledSsid = \"%s\"\n", nvsSsid.c_str());
    Serial.printf("[NVS] wledPass = \"%s\"\n", nvsPass.c_str());
    Serial.printf("[NVS] wledIp   = \"%s\"\n", nvsIp.c_str());
    Serial.printf("[NVS] wledPort = %d\n", nvsPort);
    Serial.println("[NVS] --- Current in-memory values ---");
    Serial.printf("[NVS] wledSsid = \"%s\"\n", wledSsid.c_str());
    Serial.printf("[NVS] wledPass = \"%s\"\n", wledPass.c_str());
    Serial.printf("[NVS] wledIp   = \"%s\"\n", wledIp.c_str());
    Serial.printf("[NVS] wledPort = %d\n", wledPort);
    Serial.printf("[NVS] WiFi.status() = %d (%s)\n", (int)WiFi.status(),
                  WiFi.status() == WL_CONNECTED ? "CONNECTED" :
                  WiFi.status() == WL_IDLE_STATUS ? "IDLE" :
                  WiFi.status() == WL_NO_SSID_AVAIL ? "NO_SSID_AVAIL" :
                  WiFi.status() == WL_CONNECT_FAILED ? "CONNECT_FAILED" :
                  WiFi.status() == WL_CONNECTION_LOST ? "CONNECTION_LOST" :
                  WiFi.status() == WL_DISCONNECTED ? "DISCONNECTED" : "OTHER");
  } else if (line == "wled si") {
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WLED] WiFi not connected");
    } else {
      HTTPClient http;
      http.begin("http://" + wledIp + ":" + String(wledPort) + "/json/si");
      http.setTimeout(5000);
      int code = http.GET();
      if (code == 200) {
        String body = http.getString();
        DynamicJsonDocument doc(4096);
        if (deserializeJson(doc, body) == DeserializationError::Ok) {
          JsonObject state = doc["state"];
          int fx = state["seg"][0]["fx"] | state["fx"] | -1;
          int bri = state["bri"] | -1;
          int segN = state["seg"].isNull() ? 0 : (int)state["seg"].size();
          Serial.printf("[WLED] on=%d bri=%d fx=%d segs=%d (%u bytes)\n",
                        state["on"] | false, bri, fx, segN, (unsigned)body.length());
        } else {
          Serial.printf("[WLED] si parse fail (%u bytes)\n", (unsigned)body.length());
        }
      } else {
        Serial.printf("[WLED] si GET failed HTTP %d\n", code);
      }
      http.end();
    }
  } else if (line == "mb defer on") {
    mbDeferToApp = true;
    prefs.begin("config", false);
    prefs.putBool("mbDefer", true);
    prefs.end();
    Serial.println("[Serial] MB defer to app ON");
  } else if (line == "mb defer off") {
    mbDeferToApp = false;
    prefs.begin("config", false);
    prefs.putBool("mbDefer", false);
    prefs.end();
    Serial.println("[Serial] MB defer to app OFF (firmware applies)");
  } else if (line.startsWith("mb five")) {
    int vals[5] = { 0, 0, 0, 0, 0 };
    int count = 0;
    int pos = 7;
    while (pos < (int)line.length() && count < 5) {
      while (pos < (int)line.length() && line.charAt(pos) == ' ') pos++;
      if (pos >= (int)line.length()) break;
      int sp = pos;
      while (pos < (int)line.length() && line.charAt(pos) != ' ') pos++;
      vals[count++] = line.substring(sp, pos).toInt();
    }
    if (count < 5) {
      Serial.println("[Serial] Usage: mb five <tl bl br tr c>  (palette indices 0-31)");
    } else {
      Serial.printf("[Serial] MB five %d %d %d %d %d\n", vals[0], vals[1], vals[2], vals[3], vals[4]);
      applyMbFive((uint8_t)vals[0], (uint8_t)vals[1], (uint8_t)vals[2], (uint8_t)vals[3], (uint8_t)vals[4], BLE_MAGIC);
    }
  } else if (line.startsWith("mb ")) {
    int sp = line.indexOf(' ', 3);
    uint8_t pal = (uint8_t)line.substring(3, sp > 0 ? sp : line.length()).toInt();
    uint8_t mask = 0;
    if (sp > 0) mask = (uint8_t)line.substring(sp + 1).toInt();
    Serial.printf("[Serial] MB single pal=%u mask=%u\n", pal, mask);
    if (mask == 0) applyMbSegmentSolid("all", pal, BLE_MAGIC);
    else applyMbSingleMask(mask, pal, BLE_MAGIC);
  } else if (line == "tx on") {
    wandTxBeacon = true;
    wandTxLastAdvMs = 0;
    Serial.println("[Serial] Wand TX idle beacon ON — physical wand should see another wand");
  } else if (line == "tx off") {
    wandTxBeacon = false;
    wandTxCastUntil = 0;
    refreshBleAdvertising(nullptr, 0);
    Serial.println("[Serial] Wand TX off — normal IllumaBuggy advertising");
  } else if (line.startsWith("tx cast")) {
    int pal = 4;
    int sp = line.indexOf(' ', 7);
    if (sp > 0) pal = line.substring(sp + 1).toInt();
    startWandTxCast((uint8_t)pal, 3000);
  } else if (line.startsWith("chase speed")) {
    int sp = line.indexOf(' ', 11);
    if (sp > 0) {
      mbChaseSpeed = (uint8_t)line.substring(sp + 1).toInt();
      prefs.begin("config", false);
      prefs.putUChar("mbSpd", mbChaseSpeed);
      prefs.end();
      Serial.printf("[Serial] Chase speed (sx) = %u\n", mbChaseSpeed);
    }
  } else if (line.startsWith("chase thick")) {
    int sp = line.indexOf(' ', 11);
    if (sp > 0) {
      mbChaseThickness = (uint8_t)line.substring(sp + 1).toInt();
      if (mbChaseThickness < 1) mbChaseThickness = 1;
      prefs.begin("config", false);
      prefs.putUChar("mbGrp", mbChaseThickness);
      prefs.end();
      Serial.printf("[Serial] Chase thickness (grp) = %u\n", mbChaseThickness);
    }
  } else if (line == "sniff off") {
    bleSniffUntilMs = 0;
    Serial.println("[Serial] Sniff off");
  } else if (line.startsWith("sniff")) {
    int sec = 30;
    int sp = line.indexOf(' ');
    if (sp > 0) sec = line.substring(sp + 1).toInt();
    if (sec < 1) sec = 30;
    bleSniffUntilMs = millis() + (unsigned long)sec * 1000UL;
    Serial.printf("[Serial] Sniffing ALL mfr data for %ds — press wand button now\n", sec);
  } else if (line.startsWith("role ")) {
    String r = line.substring(5);
    r.trim();
    if (r == "standalone" || r == "logic" || r == "logic_board") {
      boardRole = (r == "standalone") ? BoardRole::STANDALONE : BoardRole::LOGIC_BOARD;
      prefs.begin("config", false);
      prefs.putUChar("boardRole", (uint8_t)boardRole);
      prefs.end();
      payloadTransportInit();
      Serial.printf("[Serial] boardRole=%s — reboot to apply BLE scan on/off\n",
                    boardRole == BoardRole::LOGIC_BOARD ? "logic_board" : "standalone");
    } else {
      Serial.println("[Serial] usage: role standalone|logic");
    }
  } else if (line.startsWith("scanner ")) {
    String macStr = line.substring(8);
    macStr.trim();
    uint8_t mac[6];
    if (!transportParseMacString(macStr.c_str(), mac)) {
      Serial.println("[Serial] usage: scanner AA:BB:CC:DD:EE:FF");
    } else {
      transportSetScannerMac(mac);
      Serial.printf("[Serial] scanner MAC = %s\n", transportMacToString(mac).c_str());
    }
  } else {
    Serial.printf("[Serial] Unknown: %s (type 'help')\n", line.c_str());
  }
}

