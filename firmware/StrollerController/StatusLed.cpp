#include "StatusLed.h"
#include "Config.h"

#if HAS_STATUS_NEOPIXEL

#include "Globals.h"
#include "PayloadTransport.h"
#include <WiFi.h>
#include <esp32-hal-rgb-led.h>

// DevKitC-1 v1.3 / v1.1 → GPIO 38. Also pulse 48 in case of a v1.0 board.
#ifndef STATUS_LED_PIN_PRIMARY
#define STATUS_LED_PIN_PRIMARY STATUS_LED_PIN
#endif
#ifndef STATUS_LED_PIN_ALT
#define STATUS_LED_PIN_ALT 48
#endif

enum class LedState {
  WIFI_DOWN, NO_SCANNER_MAC, PAIRING, LINKED, FALLBACK, STANDALONE_OK, WLED_DOWN
};

static LedState currentState = LedState::WIFI_DOWN;
static unsigned long lastToggleMs = 0;
static bool blinkOn = false;

static void writeStatusRgb(uint8_t r, uint8_t g, uint8_t b) {
  // Native HAL path — more reliable on S3 than Adafruit_NeoPixel + WiFi.
  rgbLedWrite(STATUS_LED_PIN_PRIMARY, r, g, b);
  if (STATUS_LED_PIN_ALT != STATUS_LED_PIN_PRIMARY) {
    rgbLedWrite(STATUS_LED_PIN_ALT, r, g, b);
  }
}

static bool scannerAliveNow() {
  return lastScannerPacketMs != 0 &&
         (millis() - lastScannerPacketMs < SCANNER_ALIVE_MS);
}

static LedState computeState() {
  if (WiFi.status() != WL_CONNECTED) return LedState::WIFI_DOWN;
  if (!wledHttpOk) return LedState::WLED_DOWN;

  if (boardRole == BoardRole::STANDALONE) return LedState::STANDALONE_OK;

#if USE_UART_SCANNER_LINK
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
  // Hard-code 38 for DevKitC-1 v1.3 — don't trust PIN_RGB_LED (core defaults to 48).
  rgbLedWrite(38, 0, 255, 255);
  writeStatusRgb(0, 255, 255);
  Serial.printf("[StatusLed] rgbLedWrite GPIO %u + %u (v1.3 LED = 38)\n",
                (unsigned)STATUS_LED_PIN_PRIMARY, (unsigned)STATUS_LED_PIN_ALT);
}

void statusLedTick() {
  currentState = computeState();
  unsigned long now = millis();

  uint8_t r = 0, g = 0, b = 0;
  unsigned long blinkIntervalMs = 0;

  switch (currentState) {
    case LedState::WIFI_DOWN:      r = 0;   g = 0;   b = 255; blinkIntervalMs = 600; break;
    case LedState::WLED_DOWN:      r = 255; g = 0;   b = 255; blinkIntervalMs = 400; break;
    case LedState::NO_SCANNER_MAC: r = 255; g = 200; b = 0;   blinkIntervalMs = 500; break;
    case LedState::PAIRING:        r = 255; g = 200; b = 0;   blinkIntervalMs = 125; break;
    case LedState::LINKED:         r = 0;   g = 255; b = 0;   blinkIntervalMs = 0;   break;
    case LedState::FALLBACK:       r = 255; g = 0;   b = 0;   blinkIntervalMs = 500; break;
    case LedState::STANDALONE_OK:  r = 0;   g = 120; b = 0;   blinkIntervalMs = 0;   break;
  }

  if (blinkIntervalMs == 0) {
    writeStatusRgb(r, g, b);
  } else {
    if (now - lastToggleMs >= blinkIntervalMs) {
      lastToggleMs = now;
      blinkOn = !blinkOn;
    }
    if (blinkOn) writeStatusRgb(r, g, b);
    else writeStatusRgb(0, 0, 0);
  }
}

#else

void statusLedInit() {}
void statusLedTick() {}

#endif // HAS_STATUS_NEOPIXEL
