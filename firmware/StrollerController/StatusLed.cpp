#include "StatusLed.h"
#include "Config.h"

// 0=normal, 1=dim(~30%), 2=off. Defined unconditionally (outside the
// HAS_STATUS_NEOPIXEL guard below) so RuntimeFields.cpp always links,
// even on builds without the status pixel.
uint8_t statusLedMode = 0;

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
  WIFI_DOWN, LINK_WAIT, LINKED, STANDALONE_OK, WLED_DOWN
};

static LedState currentState = LedState::WIFI_DOWN;
static unsigned long lastToggleMs = 0;
static bool blinkOn = false;

static void writeStatusRgb(uint8_t r, uint8_t g, uint8_t b) {
  if (statusLedMode == 2) {
    r = 0; g = 0; b = 0;
  } else if (statusLedMode == 1) {
    r = (uint8_t)((uint16_t)r * 77 / 255);
    g = (uint8_t)((uint16_t)g * 77 / 255);
    b = (uint8_t)((uint16_t)b * 77 / 255);
  }
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

  // Dual-board: amber while UART silent (link lost); green when heartbeats/packets flow.
  if (scannerAliveNow()) return LedState::LINKED;
  return LedState::LINK_WAIT;
}

void statusLedInit() {
  // Hard-code 38 for DevKitC-1 v1.3 — don't trust PIN_RGB_LED (core defaults to 48).
  // Boot flash is raw (bypasses statusLedMode) so there's always a visible indicator.
  rgbLedWrite(38, 0, 255, 255);
  if (STATUS_LED_PIN_ALT != 38) {
    rgbLedWrite(STATUS_LED_PIN_ALT, 0, 255, 255);
  }
  Serial.printf("[StatusLed] rgbLedWrite GPIO %u + %u (v1.3 LED = 38)\n",
                (unsigned)STATUS_LED_PIN_PRIMARY, (unsigned)STATUS_LED_PIN_ALT);
}

void statusLedTick() {
  currentState = computeState();
  unsigned long now = millis();

  uint8_t r = 0, g = 0, b = 0;
  unsigned long blinkIntervalMs = 0;

  switch (currentState) {
    case LedState::WIFI_DOWN:     r = 0;   g = 0;   b = 255; blinkIntervalMs = 600; break;
    case LedState::WLED_DOWN:     r = 255; g = 0;   b = 255; blinkIntervalMs = 400; break;
    case LedState::LINK_WAIT:     r = 255; g = 200; b = 0;   blinkIntervalMs = 125; break; // UART silent
    case LedState::LINKED:        r = 0;   g = 255; b = 0;   blinkIntervalMs = 0;   break;
    case LedState::STANDALONE_OK: r = 0;   g = 120; b = 0;   blinkIntervalMs = 0;   break;
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
