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

struct MbEffectMap {
  String presetId;
  String wledPayload;
  uint8_t colorSlots[MB_MAX_COLOR_SLOTS];
  uint8_t colorSlotCount;
};

struct MbSegmentLayout {
  char name[24];
  MbSegMap segMaps[MB_SEG_KEY_COUNT];
};

struct SwFxSignature {
  const char* key;
  const uint8_t* data;
  size_t len;
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
struct __attribute__((packed)) ParsedDisneyPacket {
  DisneyPacketKind kind;
  uint16_t         opcode;
  uint8_t          palettes[PARSED_PACKET_MAX_PALETTES];
  uint8_t          paletteCount;
  uint8_t          maskByte;
  uint8_t          hasRawFallback;  // 0/1 — true when undecodable; rawPayload populated
  uint8_t          rawPayload[PARSED_PACKET_RAW_MAX];
  uint8_t          rawLen;
  uint32_t         capturedAtMs;
};

struct ParsedPacketJob {
  ParsedDisneyPacket pkt;
  volatile bool pending;
};

enum class BoardRole : uint8_t { STANDALONE = 0, LOGIC_BOARD = 1 };

enum OverrideSource { NONE, ZONE, MANUAL, SHOW_MODE, BLE_MAGIC, BLE_STARLIGHT };
enum SwMatchQuality { SW_MATCH_EXACT, SW_MATCH_FUZZY, SW_MATCH_NONE };
enum ShowType  { SHOW_NONE, SHOW_PARADE, SHOW_FIREWORKS };
enum ShowPhase { PHASE_NONE, PHASE_PRE, PHASE_BLACK, PHASE_LIVE, PHASE_POST };

struct EspNowPairMsg {
  uint32_t magic;
  uint8_t  logicMac[6];
} __attribute__((packed));
