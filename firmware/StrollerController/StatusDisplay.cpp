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
static bool wledLastCallOk = true;
static String lastFiredRuleName = "";
static unsigned long lastDisplayMs = 0;

void statusDisplaySetWledOk(bool ok) { wledLastCallOk = ok; }

void statusDisplaySetLastRule(const char* name) {
  lastFiredRuleName = name ? String(name) : "";
}

bool statusDisplayInit() {
  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR)) {
    Serial.println("[Display] SSD1306 init failed");
    displayReady = false;
    return false;
  }
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  displayReady = true;
  Serial.println("[Display] SSD1306 ready");
  statusDisplayUpdate();
  return true;
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
  display.setCursor(0, 0);

  display.printf("WLED:%s Role:%s\n",
                 wledLastCallOk ? "OK" : "FAIL",
                 boardRole == BoardRole::LOGIC_BOARD ? "LOGIC" : "STD");

  display.printf("Uptime:%lus\n", now / 1000UL);

  JsonArray rules = mbRulesJsonArray();
  bool linkOk = (lastScannerPacketMs != 0) &&
                ((now - lastScannerPacketMs) < SCANNER_ALIVE_MS);
  float ageSec = lastScannerPacketMs ? ((now - lastScannerPacketMs) / 1000.0f) : 0.0f;
  display.printf("Rules:%u Link:%s",
                 rules.isNull() ? 0u : (unsigned)rules.size(),
                 linkOk ? "OK" : "LOST");
  if (linkOk) display.printf(" (%.1fs)", ageSec);
  display.print("\n");

  static const char* showTypeStr[] = {"NONE", "PARADE", "FWORKS"};
  static const char* showPhaseStr[] = {"-", "PRE", "BLACK", "LIVE", "POST"};
  static const char* overrideStr[] = {"NONE", "ZONE", "MANUAL", "SHOW", "MB", "SW"};
  int st = (int)showModeType;
  int sp = (int)showModePhase;
  int ov = (int)currentOverride;
  if (st < 0 || st > 2) st = 0;
  if (sp < 0 || sp > 4) sp = 0;
  if (ov < 0 || ov > 5) ov = 0;
  display.printf("Show:%s/%s Ov:%s\n", showTypeStr[st], showPhaseStr[sp], overrideStr[ov]);

  display.printf("Preset:%s\n",
                 truncate(currentPresetId.length() ? currentPresetId : "(none)", 20).c_str());
  display.printf("Rule:%s\n",
                 truncate(lastFiredRuleName.length() ? lastFiredRuleName : "(none)", 20).c_str());
  display.printf("Heap:%uk PSRAM:%uM\n",
                 (unsigned)(ESP.getFreeHeap() / 1024),
                 (unsigned)(ESP.getFreePsram() / 1024 / 1024));

  display.display();
}
