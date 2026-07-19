#include "MbPacketDecode.h"
#include "DisneyBleFilter.h"
#include <Arduino.h>
#include <string.h>

uint8_t decodeE905MaskByte(const uint8_t* payload) {
  uint8_t b6 = payload[6];
  if (b6 != 0x0E && b6 != 0x0F) return b6;
  return (payload[7] >> 5) & 0x07;
}

uint8_t decodeE905Palette(const uint8_t* payload) {
  return payload[7] & 0x1F;
}

bool e90cIsPaletteSubMode(const uint8_t* payload, size_t plen) {
  if (plen < 12) return false;
  if (payload[6] != 0x0F) return false;
  for (int i = 7; i <= 11; i++) {
    if (((payload[i] >> 5) & 0x07) != 0x05) return false;  // mask 101
  }
  return true;
}

bool e909UsesPatternSlots(const uint8_t* payload) {
  for (int i = 7; i <= 11; i++) {
    if ((payload[i] & 0xE0) != 0xA0) return true;
  }
  return false;
}

uint8_t scale6To8(uint8_t v) {
  v &= 0x3F;
  return (uint8_t)((v << 2) | (v >> 4));
}

// Always retain raw for dedup / defer-to-app / SW matching. hasRawFallback marks
// undecodable classification (apply should not invent palettes / anim fallbacks).
static void copyRaw(ParsedDisneyPacket& pkt, const uint8_t* payload, size_t plen) {
  size_t n = plen < PARSED_PACKET_RAW_MAX ? plen : PARSED_PACKET_RAW_MAX;
  memcpy(pkt.rawPayload, payload, n);
  pkt.rawLen = (uint8_t)n;
}

static void markUndecodable(ParsedDisneyPacket& pkt, const uint8_t* payload, size_t plen) {
  copyRaw(pkt, payload, plen);
  pkt.hasRawFallback = 1;
}

static ParsedDisneyPacket makeBase(unsigned long capturedAtMs) {
  ParsedDisneyPacket pkt = {};
  pkt.kind = DisneyPacketKind::UNKNOWN;
  pkt.capturedAtMs = (uint32_t)capturedAtMs;
  return pkt;
}

static void decodeE1E2(ParsedDisneyPacket& pkt, const uint8_t* payload, size_t plen) {
  uint16_t func = ((uint16_t)payload[2] << 8) | payload[3];
  pkt.opcode = func;
  copyRaw(pkt, payload, plen);

  switch (func) {
    case 0xE905:
      if (plen < 9) {
        pkt.hasRawFallback = 1;
        pkt.kind = DisneyPacketKind::E9_UNCLASSIFIED;
        return;
      }
      pkt.kind = DisneyPacketKind::E905_SINGLE;
      pkt.maskByte = decodeE905MaskByte(payload);
      pkt.palettes[0] = decodeE905Palette(payload);
      pkt.paletteCount = 1;
      return;

    case 0xE906:
      if (plen < 10) {
        pkt.hasRawFallback = 1;
        pkt.kind = DisneyPacketKind::E9_UNCLASSIFIED;
        return;
      }
      pkt.kind = DisneyPacketKind::E906_DUAL;
      pkt.palettes[0] = payload[7];
      pkt.palettes[1] = payload[8];
      pkt.paletteCount = 2;
      return;

    case 0xE908:
      if (plen < 12) {
        pkt.hasRawFallback = 1;
        pkt.kind = DisneyPacketKind::E9_UNCLASSIFIED;
        return;
      }
      pkt.kind = DisneyPacketKind::E908_RGB;
      pkt.palettes[0] = scale6To8((payload[8] >> 1) & 0x3F);
      pkt.palettes[1] = scale6To8((payload[9] >> 1) & 0x3F);
      pkt.palettes[2] = scale6To8((payload[10] >> 1) & 0x3F);
      pkt.paletteCount = 3;
      return;

    case 0xE909:
      if (plen < 13) {
        pkt.hasRawFallback = 1;
        pkt.kind = DisneyPacketKind::E9_UNCLASSIFIED;
        return;
      }
      pkt.kind = DisneyPacketKind::E909_FIVE_PALETTE;
      pkt.palettes[0] = payload[7] & 0x1F;
      pkt.palettes[1] = payload[8] & 0x1F;
      pkt.palettes[2] = payload[9] & 0x1F;
      pkt.palettes[3] = payload[10] & 0x1F;
      pkt.palettes[4] = payload[11] & 0x1F;
      pkt.paletteCount = 5;
      if (e909UsesPatternSlots(payload)) {
        // High bit marks pattern-slot mode; low nibble = pattern index.
        pkt.maskByte = (uint8_t)(0x80 | ((payload[7] >> 5) & 0x07));
      }
      return;

    case 0xE90C:
      if (e90cIsPaletteSubMode(payload, plen)) {
        pkt.kind = DisneyPacketKind::E90C_PALETTE;
        pkt.palettes[0] = payload[7] & 0x1F;
        pkt.palettes[1] = payload[8] & 0x1F;
        pkt.palettes[2] = payload[9] & 0x1F;
        pkt.palettes[3] = payload[10] & 0x1F;
        pkt.palettes[4] = payload[11] & 0x1F;
        pkt.paletteCount = 5;
        return;
      }
      // Sub-mode B — recognized but not palette-decoded.
      pkt.hasRawFallback = 1;
      pkt.kind = DisneyPacketKind::E90C_ANIMATION;
      return;

    case 0xE90E:
      if (plen < 5) {
        pkt.hasRawFallback = 1;
        pkt.kind = DisneyPacketKind::E9_UNCLASSIFIED;
        return;
      }
      pkt.kind = DisneyPacketKind::E90E_FLASH;
      return;

    default:
      // E90F/E910/E911/E912/E913 and other E9-family — tier-2 / undecodable.
      pkt.hasRawFallback = 1;
      pkt.kind = DisneyPacketKind::E9_UNCLASSIFIED;
      return;
  }
}

ParsedDisneyPacket decodeDisneyPayload(const uint8_t* payload, size_t plen, unsigned long capturedAtMs) {
  ParsedDisneyPacket pkt = makeBase(capturedAtMs);
  if (!payload || plen == 0) return pkt;

  if (isWandCast(payload, plen)) {
    pkt.kind = DisneyPacketKind::WAND_CAST;
    pkt.palettes[0] = payload[12] & 0x1F;
    pkt.paletteCount = 1;
    copyRaw(pkt, payload, plen);
    return pkt;
  }

  if (isLegacyCf9bCast(payload, plen)) {
    pkt.kind = DisneyPacketKind::WAND_CF9B_LEGACY;
    pkt.palettes[0] = payload[plen - 1] & 0x1F;
    pkt.paletteCount = 1;
    copyRaw(pkt, payload, plen);
    return pkt;
  }

  if (isWandIdleBeacon(payload, plen)) return pkt;  // UNKNOWN — not an effect
  if (plen >= 2 && payload[0] == 0xCC && payload[1] == 0x03) return pkt;  // wake ping

  if (plen >= 5 && (payload[0] == 0xE1 || payload[0] == 0xE2) && payload[2] == 0xE9) {
    decodeE1E2(pkt, payload, plen);
    return pkt;
  }

  if (plen >= 2 && payload[0] == 0xE9) {
    // Bare show E9 — recognized family, not fully decoded here.
    pkt.opcode = ((uint16_t)payload[0] << 8) | payload[1];
    markUndecodable(pkt, payload, plen);
    pkt.kind = DisneyPacketKind::E9_UNCLASSIFIED;
    return pkt;
  }

  return pkt;
}
