#include "ScannerStatusDisplay.h"
#include "Globals.h"
#include "SdRawLogger.h"
#include "Config.h"
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <stdio.h>
#include <string.h>

static Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
static bool displayReady = false;
static unsigned long lastDisplayMs = 0;

static const int OLED_COLS = OLED_WIDTH / 6;  // 21
static const int OLED_ROWS = OLED_HEIGHT / 8; // 8
static const int RSSI_COLS = 5;
static const int FP_HEX_MAX = OLED_COLS - RSSI_COLS; // 16
static const int FP_BYTES_MAX = FP_HEX_MAX / 2;       // 8
static const size_t PACKET_RING_CAP = 6;

struct PacketRow {
  char hex[FP_HEX_MAX + 1];
  int8_t rssi;
  bool valid;
};

static PacketRow packetRing[PACKET_RING_CAP];
static uint8_t packetWrite = 0;
static uint8_t packetCount = 0;

// Sliding 1s Disney packet counter for pps.
static uint16_t disneyHitsSec = 0;
static uint16_t disneyPps = 0;
static unsigned long disneyWindowMs = 0;

static void i2cBusScan() {
  Serial.printf("[Display] I2C scan SDA=%d SCL=%d …\n", OLED_SDA_PIN, OLED_SCL_PIN);
  uint8_t found = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("[Display]   device at 0x%02X\n", addr);
      found++;
    }
  }
  if (!found) Serial.println("[Display]   (no devices — check wiring / 3V3 / GND)");
}

static bool tryOledBegin(uint8_t addr) {
  if (!display.begin(SSD1306_SWITCHCAPVCC, addr)) return false;
  display.ssd1306_command(SSD1306_DISPLAYON);
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Illuma Scanner");
  display.println("OLED OK");
  display.print("SDA ");
  display.print(OLED_SDA_PIN);
  display.print(" SCL ");
  display.println(OLED_SCL_PIN);
  display.display();
  Serial.printf("[Display] SSD1306 ready (SDA=%d SCL=%d addr=0x%02X)\n",
                OLED_SDA_PIN, OLED_SCL_PIN, addr);
  return true;
}

bool scannerStatusDisplayInit() {
  for (size_t i = 0; i < PACKET_RING_CAP; i++) {
    packetRing[i].hex[0] = '\0';
    packetRing[i].rssi = 0;
    packetRing[i].valid = false;
  }
  disneyWindowMs = millis();

  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
  Wire.setClock(100000);
  delay(50);
  i2cBusScan();

  if (tryOledBegin(OLED_I2C_ADDR) || tryOledBegin(0x3D) ||
      (OLED_I2C_ADDR != 0x3C && tryOledBegin(0x3C))) {
    displayReady = true;
    lastDisplayMs = 0;
    return true;
  }

  Serial.printf("[Display] SSD1306 init failed (SDA=%d SCL=%d)\n",
                OLED_SDA_PIN, OLED_SCL_PIN);
  displayReady = false;
  return false;
}

void scannerStatusDisplayNotePacket(const uint8_t* mfrData, size_t len, int rssi) {
  // pps window (always, even if OLED absent)
  unsigned long now = millis();
  if (now - disneyWindowMs >= 1000) {
    disneyPps = disneyHitsSec;
    disneyHitsSec = 0;
    disneyWindowMs = now;
  }
  if (disneyHitsSec < 0xFFFF) disneyHitsSec++;

  if (!mfrData || len < 2) return;

  const uint8_t* payload = mfrData;
  size_t plen = len;
  if (len >= 2 && mfrData[0] == 0x83 && mfrData[1] == 0x01) {
    payload = mfrData + 2;
    plen = len - 2;
  }

  size_t nBytes = plen < (size_t)FP_BYTES_MAX ? plen : (size_t)FP_BYTES_MAX;
  char hex[FP_HEX_MAX + 1];
  size_t hi = 0;
  for (size_t i = 0; i < nBytes && hi + 2 <= (size_t)FP_HEX_MAX; i++) {
    static const char* kHex = "0123456789ABCDEF";
    hex[hi++] = kHex[(payload[i] >> 4) & 0x0F];
    hex[hi++] = kHex[payload[i] & 0x0F];
  }
  hex[hi] = '\0';

  PacketRow& row = packetRing[packetWrite];
  memcpy(row.hex, hex, hi + 1);
  row.rssi = (int8_t)constrain(rssi, -128, 127);
  row.valid = true;
  packetWrite = (uint8_t)((packetWrite + 1) % PACKET_RING_CAP);
  if (packetCount < PACKET_RING_CAP) packetCount++;
}

void scannerStatusDisplayUpdate() {
  if (!displayReady) return;
  unsigned long now = millis();
  if (lastDisplayMs != 0 && (now - lastDisplayMs) < STATUS_DISPLAY_INTERVAL_MS) return;
  lastDisplayMs = now;

  // Close out pps window if quiet
  if (now - disneyWindowMs >= 1000) {
    disneyPps = disneyHitsSec;
    disneyHitsSec = 0;
    disneyWindowMs = now;
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);

  // Line 1: Link + SD
  const char* linkStr = "--";
  if (lastLogicHbMs != 0) {
    linkStr = ((now - lastLogicHbMs) < SCANNER_ALIVE_MS) ? "OK" : "LOST";
  }
  display.print("Link:");
  display.print(linkStr);
  display.print(" SD:");
  display.println(sdRawLoggerReady() ? "OK" : "--");

  // Line 2: Heap + pps
  display.print("Heap:");
  display.print((unsigned)(ESP.getFreeHeap() / 1024));
  display.print("k pps:");
  display.println(disneyPps);

  // Lines 3–8: newest-first packets (fingerprint left, RSSI in last 5 cols)
  const int packetRows = OLED_ROWS - 2;
  for (int i = 0; i < packetRows; i++) {
    if (i >= (int)packetCount) break;
    int idx = (int)packetWrite - 1 - i;
    while (idx < 0) idx += (int)PACKET_RING_CAP;
    const PacketRow& row = packetRing[idx];
    if (!row.valid) continue;

    char line[OLED_COLS + 1];
    // Pad fingerprint to FP_HEX_MAX, then %5d RSSI → 21 chars.
    snprintf(line, sizeof(line), "%-*.*s%5d",
             FP_HEX_MAX, FP_HEX_MAX, row.hex, (int)row.rssi);
    display.println(line);
  }

  display.display();
}
