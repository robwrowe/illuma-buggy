#include "StatusLed.h"
#include "Config.h"
#include "Globals.h"
#include "PayloadTransport.h"
#include <Adafruit_NeoPixel.h>
#include <WiFi.h>

static Adafruit_NeoPixel pixel(STATUS_LED_COUNT, STATUS_LED_PIN, NEO_GRB + NEO_KHZ800);

enum class LedState { BOOTING, NO_SCANNER_MAC, PAIRING, LINKED, FALLBACK, STANDALONE_OK };

static LedState currentState = LedState::BOOTING;
static unsigned long lastToggleMs = 0;
static bool blinkOn = false;

static bool scannerAliveNow() {
  return lastScannerPacketMs != 0 &&
         (millis() - lastScannerPacketMs < SCANNER_ALIVE_MS);
}

static LedState computeState() {
  if (WiFi.status() != WL_CONNECTED) return LedState::BOOTING;
  if (boardRole == BoardRole::STANDALONE) return LedState::STANDALONE_OK;
  if (!scannerPeerConfigured) return LedState::NO_SCANNER_MAC;
  if (localScanFallbackActive) return LedState::FALLBACK;
  if (scannerAliveNow()) return LedState::LINKED;
  return LedState::PAIRING;
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
    case LedState::BOOTING:        color = pixel.Color(0, 0, 255);   blinkIntervalMs = 600; break;
    case LedState::NO_SCANNER_MAC: color = pixel.Color(255, 200, 0); blinkIntervalMs = 500; break;
    case LedState::PAIRING:        color = pixel.Color(255, 200, 0); blinkIntervalMs = 125; break;
    case LedState::LINKED:         color = pixel.Color(0, 255, 0);   blinkIntervalMs = 0;   break;
    case LedState::FALLBACK:       color = pixel.Color(255, 0, 0);   blinkIntervalMs = 500; break;
    case LedState::STANDALONE_OK:  color = pixel.Color(0, 120, 0);   blinkIntervalMs = 0;   break;
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
