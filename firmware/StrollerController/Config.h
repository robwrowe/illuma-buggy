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
/** Grace after last same-rule advert before ON→FADE (not a full on-time re-arm).
 *  Does not apply during FADE/COOLDOWN — those re-apply the effect instead. */
#define MB_RULE_REPEAT_SLACK_MS 400UL


// Starlight wand
#define WAND_CAST_LEN 13

// Disney / BLE buffers
#define DISNEY_PAYLOAD_MAX 64
#define PARSED_PACKET_MAX_PALETTES 5
#define PARSED_PACKET_RAW_MAX 32
/** ESP-NOW → rule-engine ring buffer depth (absorbs loop() stalls during WLED HTTP). */
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

// ESP-NOW pairing magic ("PAIR" little-endian)
#define ESPNOW_PAIR_MAGIC 0x52494150u
// Illuma scanner unpaired advertisement manufacturer prefix (not Disney 0x8301)
#define SCANNER_MFR_MAGIC_0 0x49
#define SCANNER_MFR_MAGIC_1 0x53

// Timing
#define WIFI_RETRY_MS 5000
#define LIVE_STATE_POLL_MS 12000

// ESP-NOW scanner link health (shared by PayloadTransport + StatusLed)
#define SCANNER_ABSENT_MS 20000
#define SCANNER_ALIVE_MS  10000

// Local board-health NeoPixel (not the show strip / GLEDOPTO).
// DevKitC-1 v1.1+ (incl. v1.3) onboard RGB = GPIO 38; v1.0 used GPIO 48.
#define STATUS_LED_PIN 48
#define STATUS_LED_COUNT 1

// Inter-board UART link (provisional — confirm vs ESP32-S3-DevKitC-1-N16R8 datasheet).
// Default OFF so existing ESP-NOW field units keep working. Set to 1 for UART bench/PCB.
#ifndef USE_UART_SCANNER_LINK
#define USE_UART_SCANNER_LINK 0
#endif
#define UART_LINK_TX_PIN 17
#define UART_LINK_RX_PIN 8
#define UART_LINK_BAUD   115200

// SD card SPI (independent card per board)
#define SD_CS_PIN   10
#define SD_SCK_PIN  12
#define SD_MOSI_PIN 11
#define SD_MISO_PIN 13

// OLED I2C (logic board only)
#define OLED_SDA_PIN 21
#define OLED_SCL_PIN 22
#define OLED_I2C_ADDR 0x3C
#define OLED_WIDTH  128
#define OLED_HEIGHT 64
#define STATUS_DISPLAY_INTERVAL_MS 750

#include <stdint.h>
#include <stddef.h>

extern const uint8_t WAND_IDLE_PAYLOAD[19];
extern const uint8_t WAND_CAST_SIG[6];
