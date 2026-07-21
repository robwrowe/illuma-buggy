#pragma once

#include "Config.h"
#include <Arduino.h>

struct WledSegRef {
  uint8_t id;
  uint16_t start;
  uint16_t stop;
  uint8_t grp = 1;
  uint8_t spc = 0;
  int16_t of = 0;
  bool rev = false;
  bool mi = false;
  int fx = -1;
  uint8_t sx = 128;
  uint8_t ix = 128;
  int pal = -1;
};

struct MbSegMap { WledSegRef refs[MB_MAX_SEG_REFS]; uint8_t count; };

struct MbSegmentLayout {
  char name[24];
  MbSegMap segMaps[MB_SEG_KEY_COUNT];
};

struct PendingCmd {
  char type[32];
};

struct PendingBleCmd {
  char* data;
};

struct DisneyPayloadJob {
  uint8_t data[DISNEY_PAYLOAD_MAX];
  uint8_t len;
  volatile bool pending;
};

enum class DisneyPacketKind : uint8_t {
  UNKNOWN = 0,
  WAND_CAST,
  WAND_CF9B_LEGACY,
  E905_SINGLE,
  E906_DUAL,
  E908_RGB,
  E909_FIVE_PALETTE,
  E90C_PALETTE,
  E90C_ANIMATION,
  E90E_FLASH,
  E9_UNCLASSIFIED,
};

// Wire contract for ESP-NOW and decode→apply boundary. Packed for stable sizeof.
// rssi is filled by the scanner; rule engine / parade detection consume it on the logic board.
struct __attribute__((packed)) ParsedDisneyPacket {
  DisneyPacketKind kind;
  uint16_t         opcode;
  uint8_t          palettes[PARSED_PACKET_MAX_PALETTES];
  uint8_t          paletteCount;
  uint8_t          maskByte;
  uint8_t          hasRawFallback;  // 0/1 — true when undecodable; rawPayload populated
  uint8_t          rawPayload[PARSED_PACKET_RAW_MAX];
  uint8_t          rawLen;
  int8_t           rssi;
  uint32_t         capturedAtMs;
};

enum class BoardRole : uint8_t { STANDALONE = 0, LOGIC_BOARD = 1 };

enum OverrideSource { NONE, ZONE, MANUAL, SHOW_MODE, BLE_MAGIC, BLE_STARLIGHT };
enum ShowType  { SHOW_NONE, SHOW_PARADE, SHOW_FIREWORKS };
enum ShowPhase { PHASE_NONE, PHASE_PRE, PHASE_BLACK, PHASE_LIVE, PHASE_POST };

// Rule-engine effect lifecycle (timing-byte driven). IDLE = use flat magicBandTimeoutMs.
enum MbRulePhase : uint8_t {
  MB_RULE_IDLE = 0,
  MB_RULE_ON,
  MB_RULE_FADE,
  MB_RULE_COOLDOWN,
};

enum MbCooldownResetMode : uint8_t {
  MB_COOLDOWN_ON_MATCH = 0,
  MB_COOLDOWN_FIXED    = 1,
};

struct EspNowPairMsg {
  uint32_t magic;
  uint8_t  logicMac[6];
  uint8_t  channel;      // logic board's current Wi-Fi channel; scanner locks onto it
} __attribute__((packed));
