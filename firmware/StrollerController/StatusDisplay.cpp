#include "StatusDisplay.h"
#include "Globals.h"
#include "PayloadTransport.h"
#include "MbRuleEngine.h"
#include "Config.h"
#include "Types.h"
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

static Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
static bool displayReady = false;
static String lastFiredRuleName = "";
static unsigned long lastDisplayMs = 0;

void statusDisplaySetWledOk(bool ok) { wledHttpOk = ok; }

void statusDisplaySetLastRule(const char* name) {
  lastFiredRuleName = name ? String(name) : "";
}

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
  display.ssd1306_command(SSD1306_SETCONTRAST);
  display.ssd1306_command(0xFF);
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Illuma Buggy");
  display.println("OLED OK");
  display.print("SDA ");
  display.print(OLED_SDA_PIN);
  display.print(" SCL ");
  display.println(OLED_SCL_PIN);
  display.print("addr 0x");
  display.println(addr, HEX);
  display.display();
  Serial.printf("[Display] SSD1306 ready (SDA=%d SCL=%d addr=0x%02X)\n",
                OLED_SDA_PIN, OLED_SCL_PIN, addr);
  return true;
}

bool statusDisplayInit() {
  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
  Wire.setClock(100000);
  delay(100);
  i2cBusScan();

  // Most modules are 0x3C; some are 0x3D.
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

static String truncate(const String& s, size_t maxLen) {
  if (s.length() <= maxLen) return s;
  return s.substring(0, maxLen - 1) + ".";
}

void statusDisplayUpdate() {
  if (!displayReady) return;
  unsigned long now = millis();
  if (lastDisplayMs != 0 && (now - lastDisplayMs) < STATUS_DISPLAY_INTERVAL_MS) return;
  lastDisplayMs = now;

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);

  display.print("WLED:");
  display.print(wledHttpOk ? "OK" : "FAIL");
  display.print(" Role:");
  display.println(boardRole == BoardRole::LOGIC_BOARD ? "LOGIC" : "STD");

  display.print("Uptime:");
  display.print(now / 1000UL);
  display.println("s");

  unsigned ruleCount = 0;
  {
    JsonArray rules = mbRulesJsonArray();
    if (!rules.isNull()) ruleCount = (unsigned)rules.size();
  }
  bool linkOk = (lastScannerPacketMs != 0) &&
                ((now - lastScannerPacketMs) < SCANNER_ALIVE_MS);
  float ageSec = lastScannerPacketMs ? ((now - lastScannerPacketMs) / 1000.0f) : 0.0f;
  display.print("Rules:");
  display.print(ruleCount);
  display.print(" Link:");
  display.print(linkOk ? "OK" : "LOST");
  if (linkOk) {
    display.print(" (");
    display.print(ageSec, 1);
    display.print("s)");
  }
  display.println();

  static const char* showTypeStr[] = {"NONE", "PARADE", "FWORKS"};
  static const char* showPhaseStr[] = {"-", "PRE", "BLACK", "LIVE", "POST"};
  static const char* overrideStr[] = {"NONE", "ZONE", "MANUAL", "SHOW", "MB", "SW"};
  int st = (int)showModeType;
  int sp = (int)showModePhase;
  int ov = (int)currentOverride;
  if (st < 0 || st > 2) st = 0;
  if (sp < 0 || sp > 4) sp = 0;
  if (ov < 0 || ov > 5) ov = 0;
  display.print("Show:");
  display.print(showTypeStr[st]);
  display.print("/");
  display.print(showPhaseStr[sp]);
  display.print(" Ov:");
  display.println(overrideStr[ov]);

  display.print("Preset:");
  display.println(truncate(currentPresetId.length() ? currentPresetId : "(none)", 20));
  display.print("Rule:");
  display.println(truncate(lastFiredRuleName.length() ? lastFiredRuleName : "(none)", 20));
  display.print("Heap:");
  display.print((unsigned)(ESP.getFreeHeap() / 1024));
  display.print("k PSRAM:");
  display.print((unsigned)(ESP.getFreePsram() / 1024 / 1024));
  display.println("M");

  display.display();
}
