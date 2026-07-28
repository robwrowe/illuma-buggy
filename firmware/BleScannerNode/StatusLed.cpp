#include "StatusLed.h"
#include "Config.h"

#if HAS_STATUS_NEOPIXEL

#include "Globals.h"
#include <Adafruit_NeoPixel.h>

static Adafruit_NeoPixel pixel(STATUS_LED_COUNT, STATUS_LED_PIN, NEO_GRB + NEO_KHZ800);

enum class LedState {
  BOOTING,   // blue — first seconds after boot
  UNPAIRED,  // amber fast — ESP-NOW waiting for logic pair
  LINK_IDLE, // amber slow — quiet / no recent forward
  SCAN_ONLY, // cyan — Disney seen, but not forwarding (unpaired / skipped)
  LINKED,    // green — recently forwarded packets
};

static LedState currentState = LedState::BOOTING;
static unsigned long lastToggleMs = 0;
static bool blinkOn = false;
static const unsigned long BOOT_MS = 3000;
static const unsigned long ACTIVITY_MS = SCANNER_ALIVE_MS; // 10s

static LedState computeState() {
  const unsigned long now = millis();
  if (now < BOOT_MS) return LedState::BOOTING;

#if !USE_UART_SCANNER_LINK
  if (!logicPeerConfigured) return LedState::UNPAIRED;
#endif

  const bool recentFwd = lastForwardMs != 0 && (now - lastForwardMs) < ACTIVITY_MS;
  const bool recentScan = lastDisneySeenMs != 0 && (now - lastDisneySeenMs) < ACTIVITY_MS;

  if (recentFwd) return LedState::LINKED;
  if (recentScan) return LedState::SCAN_ONLY;
  return LedState::LINK_IDLE;
}

void statusLedInit() {
  pixel.begin();
  pixel.setBrightness(20); // low — scanner often on marginal USB / shared rail
  pixel.clear();
  pixel.show();
}

void statusLedTick() {
  currentState = computeState();
  unsigned long now = millis();

  uint32_t color = 0;
  unsigned long blinkIntervalMs = 0;

  switch (currentState) {
    case LedState::BOOTING:   color = pixel.Color(0, 0, 255);   blinkIntervalMs = 600; break; // blue
    case LedState::UNPAIRED:  color = pixel.Color(255, 200, 0); blinkIntervalMs = 125; break; // amber fast
    case LedState::LINK_IDLE: color = pixel.Color(255, 200, 0); blinkIntervalMs = 800; break; // amber slow
    case LedState::SCAN_ONLY: color = pixel.Color(0, 200, 255); blinkIntervalMs = 350; break; // cyan
    case LedState::LINKED:    color = pixel.Color(0, 255, 0);   blinkIntervalMs = 0;   break; // green
  }

  if (blinkIntervalMs == 0) {
    pixel.setPixelColor(0, color);
  } else {
    if (now - lastToggleMs >= blinkIntervalMs) {
      lastToggleMs = now;
      blinkOn = !blinkOn;
    }
    pixel.setPixelColor(0, blinkOn ? color : 0);
  }
  pixel.show();
}

#else

void statusLedInit() {}
void statusLedTick() {}

#endif // HAS_STATUS_NEOPIXEL
