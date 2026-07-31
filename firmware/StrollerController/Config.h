#pragma once

// BLE
#define SERVICE_UUID     "12345678-1234-1234-1234-123456789abc"
#define CMD_CHAR_UUID    "12345678-1234-1234-1234-123456789abd"
#define NOTIFY_CHAR_UUID "12345678-1234-1234-1234-123456789abe"

// LED strip / WLED
#define STRIP_LED_COUNT 100
#define WLED_PAL_COLORS_ONLY 5
#define WLED_RESTORE_JSON_CAP 24576

// MagicBand mapping limits
#define MB_MAX_SEG_REFS 8
#define MB_SEG_KEY_COUNT 16
#define MB_MAX_LAYOUTS 6
#define MB_WLED_MAX_SEG 16
#define MB_PAL_OFF            29
#define MB_PAL_UNIQUE         30
#define MB_PAL_RANDOM         31
#define MB_MAX_RANDOM_POOL    32
#define MB_MAX_RANDOM_CUSTOM  16

// Rule-engine segment maps (Part 5)
#define MB_MAX_RULE_SEG_MAPS   8
#define MB_MAX_SEGS_PER_MAP    8
#define MB_MAX_PRESET_VARS     8
#define MB_SEG_ID_LEN          24
#define MB_SEG_MAP_ID_LEN      24
#define MB_RULE_ID_LEN         32

// Timing-byte on-time multipliers (lab-confirmed — docs/ble-packets-details/timing-byte.md)
#define MB_TIMING_MULT_NORMAL   1.6f
#define MB_TIMING_MULT_SCALER   3.0f
#define MB_TIMING_MULT_EXTENDED 7.6f
#define MB_TIMING_T0_FALLBACK_SEC 3.0f
/** @deprecated Prefer timing-model fadeBitsStretchSec[]. Kept for reference only. */
#define MB_TIMING_FADE_STEP_MS  500UL
/** Grace after last same-rule advert before ON→DIP (not a full on-time re-arm). */
#define MB_RULE_REPEAT_SLACK_MS 400UL
/**
 * Same-payload repeats must not restart mid-FTB: ON slack ends when the advert burst
 * stops, but UART/queue often still drains identical frames into DIP/FADE — that used
 * to re-apply the BLE look ("comes back on, then black, then restore"), especially on
 * short on-times. COOLDOWN onMatch re-apply only after this quiet gap since the last
 * seen packet (intentional re-cast after the burst ends).
 */
#define MB_RULE_RETRIGGER_QUIET_MS 750UL


// Starlight wand
#define WAND_CAST_LEN 13

// Disney / BLE buffers
#define DISNEY_PAYLOAD_MAX 64
#define PARSED_PACKET_MAX_PALETTES 5
#define PARSED_PACKET_RAW_MAX 32
/** Scanner/UART → rule-engine ring buffer depth (absorbs loop() stalls during WLED HTTP). */
#define PARSED_PACKET_QUEUE_DEPTH 32
/**
 * Chunk reassembly + ArduinoJson rules-cache budget (512KB).
 * Soft software cap only — both buffers are PSRAM-backed (8MB pool via JsonPsram.h /
 * gRulesDoc) with internal-heap fallback if PSRAM alloc fails; this is not a hardware
 * ceiling. Compact wire payloads stay far below this
 * (see docs/ble-packets-details/mb-rules-wire-format.md).
 */
#define BLE_CMD_BUF_SIZE 524288
/** ArduinoJson pool for BLE command parse + cached rules document (must track BLE_CMD_BUF_SIZE). */
#define BLE_JSON_DOC_SIZE 524288
/**
 * Scratch budget for maps/models-only merge when in-place assignment is not enough.
 * Measured segmentMaps+timingModels+paradeDetection ≈ <10KB; leave headroom.
 */
#define BLE_RULES_MERGE_SCRATCH 16384
/** Depth for complete BLE commands (reconnect burst is ~5–8; leave headroom). */
#define BLE_CMD_QUEUE_DEPTH 24
/** Max commands handled per loop() — empty a full burst in ~2 iterations. */
#define BLE_CMD_DRAIN_PER_LOOP 12

// Timing
#define WIFI_RETRY_MS 5000
#define LIVE_STATE_POLL_MS 12000

// UART scanner link health (shared by PayloadTransport + StatusLed)
#define SCANNER_ALIVE_MS  10000

// Local board-health NeoPixel (not the show strip / GLEDOPTO).
// Logic board (DevKitC-1 v1.3): GPIO 38. Do not key this off CONFIG_IDF_TARGET —
// that macro has been wrong in some Arduino TU orderings and left HAS_STATUS_NEOPIXEL=0.
#if defined(ILLUMA_LOGIC_BOARD) || CONFIG_IDF_TARGET_ESP32S3
#define HAS_STATUS_NEOPIXEL 1
#ifndef STATUS_LED_PIN
#define STATUS_LED_PIN 38
#endif
#define STATUS_LED_COUNT 1
#else
#define HAS_STATUS_NEOPIXEL 0
#endif

// Inter-board UART link (scanner ↔ logic). Always on for dual-board.
#if defined(ILLUMA_LOGIC_BOARD)
// StrollerController / ESP32-S3-DevKitC-1-N16R8 v1.3
// RX is GPIO 18 — NOT 8. Arduino's default Wire SDA is GPIO 8; OLED remaps
// Wire to 21/47, but UART on 8 was unreliable. Scanner TX(17) → this RX(18).
#define UART_LINK_TX_PIN 17
#define UART_LINK_RX_PIN 18
#elif CONFIG_IDF_TARGET_ESP32S3
#define UART_LINK_TX_PIN 17
#define UART_LINK_RX_PIN 18
#else
// Classic ESP32 scanner (DevKitC-32 / ESP-32D): GPIO 6–11 are flash — not RX=8.
// Cross-wire to the logic (S3) board: scanner TX→logic RX(18), scanner RX←logic TX(17).
#define UART_LINK_TX_PIN 17
#define UART_LINK_RX_PIN 16
#endif
#define UART_LINK_BAUD   115200

// SD card SPI (independent card per board).
// S3 logic: SPI pins 10–13. Classic ESP32 scanner: GPIO 6–11 are flash — use VSPI.
#if defined(ILLUMA_LOGIC_BOARD) || CONFIG_IDF_TARGET_ESP32S3
#define HAS_SD_LOGGER 1
#define SD_CS_PIN   10
#define SD_SCK_PIN  12
#define SD_MOSI_PIN 11
#define SD_MISO_PIN 13
#else
// Classic ESP32-DevKitC-32 (scanner): CS=5 SCK=18 MOSI=23 MISO=19
#define HAS_SD_LOGGER 1
#define SD_CS_PIN   5
#define SD_SCK_PIN  18
#define SD_MOSI_PIN 23
#define SD_MISO_PIN 19
#endif

// OLED I2C
// Logic S3: SDA 21 / SCL 47 (DevKitC-1 header; GPIO 22 not broken out).
// Scanner classic ESP32: SDA 21 / SCL 22 (Arduino Wire defaults; free of UART/SD).
#if defined(ILLUMA_LOGIC_BOARD) || CONFIG_IDF_TARGET_ESP32S3
#define OLED_SDA_PIN 21
#define OLED_SCL_PIN 47
#define OLED_I2C_ADDR 0x3C
#else
#define SCANNER_OLED_SDA_PIN 21
#define SCANNER_OLED_SCL_PIN 22
#define SCANNER_OLED_I2C_ADDR 0x3C
#define OLED_SDA_PIN SCANNER_OLED_SDA_PIN
#define OLED_SCL_PIN SCANNER_OLED_SCL_PIN
#define OLED_I2C_ADDR SCANNER_OLED_I2C_ADDR
#endif
#define OLED_WIDTH  128
#define OLED_HEIGHT 64
// Status OLED redraw period. Keep ≥250ms — full 128×64 I2C frame is ~1KB.
#define STATUS_DISPLAY_INTERVAL_MS 300
// 0 = SSD1306_SWITCHCAPVCC (internal charge pump). 1 = EXTERNALVCC (many 2.42″ SSD1309).
#define OLED_USE_EXTERNAL_VCC 0
// I2C clock for status OLED (Hz). 400k is standard for SSD1306/09; faster = snappier redraws.
#define OLED_I2C_HZ 400000

#include <stdint.h>
#include <stddef.h>

extern const uint8_t WAND_IDLE_PAYLOAD[19];
extern const uint8_t WAND_CAST_SIG[6];
