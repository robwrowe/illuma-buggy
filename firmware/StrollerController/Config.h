#pragma once

// BLE
#define SERVICE_UUID     "12345678-1234-1234-1234-123456789abc"
#define CMD_CHAR_UUID    "12345678-1234-1234-1234-123456789abd"
#define NOTIFY_CHAR_UUID "12345678-1234-1234-1234-123456789abe"

// LED strip / WLED
#define STRIP_LED_COUNT 100
#define WLED_CHASE_FX   28
#define WLED_MB_PAL_SLOT 0
#define WLED_PAL_COLORS_ONLY 5
#define WLED_RESTORE_JSON_CAP 24576

// MagicBand mapping limits
#define MB_MAX_SEG_REFS 8
#define MB_MAX_COLOR_SLOTS 16
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
#define MB_TIMING_FADE_STEP_MS  500UL  // fadeBits * 0.5s


// Starlight wand
#define SW_ANIM_COUNT 10
#define WAND_CAST_LEN 13

// Disney / BLE buffers
#define DISNEY_PAYLOAD_MAX 64
#define PARSED_PACKET_MAX_PALETTES 5
#define PARSED_PACKET_RAW_MAX 32
/** ESP-NOW → rule-engine ring buffer depth (absorbs loop() stalls during WLED HTTP). */
#define PARSED_PACKET_QUEUE_DEPTH 32
#define BLE_CMD_BUF_SIZE 8192
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

#include <stdint.h>
#include <stddef.h>

extern const uint8_t WAND_IDLE_PAYLOAD[19];
extern const uint8_t WAND_CAST_SIG[6];
