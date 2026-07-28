#include "StatusLed.h"
#include "Config.h"

#if HAS_STATUS_NEOPIXEL

#include "Globals.h"
#include "PayloadTransport.h"
#include <Adafruit_NeoPixel.h>
#include <WiFi.h>

static Adafruit_NeoPixel pixel(STATUS_LED_COUNT, STATUS_LED_PIN, NEO_GRB + NEO_KHZ800);

// WIFI_DOWN  = not associated with StrollerNet
// WLED_DOWN  = WiFi up but WLED HTTP failing / never succeeded
enum class LedState {
  WIFI_DOWN, NO_SCANNER_MAC, PAIRING, LINKED, FALLBACK, STANDALONE_OK, WLED_DOWN
};

static LedState currentState = LedState::WIFI_DOWN;
static unsigned long lastToggleMs = 0;
static bool blinkOn = false;

static bool scannerAliveNow() {
  return lastScannerPacketMs != 0 &&
         (millis() - lastScannerPacketMs < SCANNER_ALIVE_MS);
}

static LedState computeState() {
  if (WiFi.status() != WL_CONNECTED) return LedState::WIFI_DOWN;
  // Green means "ready to drive lights" — WiFi alone is not enough.
  if (!wledHttpOk) return LedState::WLED_DOWN;

  if (boardRole == BoardRole::STANDALONE) return LedState::STANDALONE_OK;

#if USE_UART_SCANNER_LINK
  // UART link: no scanner MAC required — age of last packet is the health signal.
  if (localScanFallbackActive) return LedState::FALLBACK;
  if (scannerAliveNow()) return LedState::LINKED;
  return LedState::PAIRING;
#else
  if (!scannerPeerConfigured) return LedState::NO_SCANNER_MAC;
  if (localScanFallbackActive) return LedState::FALLBACK;
  if (scannerAliveNow()) return LedState::LINKED;
  return LedState::PAIRING;
#endif
}

void statusLedInit() {
  pixel.begin();
  pixel.setBrightness(40); // keep it a status indicator, not a headlight
  pixel.show();
}

void statusLedTick() {
  currentState = computeState();
  unsigned long now = millis();

  uint32_t color = 0;
  unsigned long blinkIntervalMs = 0; // 0 = solid, no blink

  switch (currentState) {
    case LedState::WIFI_DOWN:      color = pixel.Color(0, 0, 255);   blinkIntervalMs = 600; break; // blue
    case LedState::WLED_DOWN:      color = pixel.Color(255, 0, 255); blinkIntervalMs = 400; break; // magenta
    case LedState::NO_SCANNER_MAC: color = pixel.Color(255, 200, 0); blinkIntervalMs = 500; break; // amber
    case LedState::PAIRING:        color = pixel.Color(255, 200, 0); blinkIntervalMs = 125; break; // amber fast
    case LedState::LINKED:         color = pixel.Color(0, 255, 0);   blinkIntervalMs = 0;   break; // green
    case LedState::FALLBACK:       color = pixel.Color(255, 0, 0);   blinkIntervalMs = 500; break; // red
    case LedState::STANDALONE_OK:  color = pixel.Color(0, 120, 0);   blinkIntervalMs = 0;   break; // dim green
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
