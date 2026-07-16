#include "DisneyPayloadHandlers.h"
#include "Globals.h"
#include "DisneyBleFilter.h"
#include "MbEffects.h"
#include "MbPacketDecode.h"
#include "MbMapping.h"
#include "SwEffects.h"
#include "OverrideManager.h"
#include "ColorPalette.h"
#include "BlePeripheral.h"
#include "DebugLog.h"
#include <string.h>

static const uint8_t* pktRaw(const ParsedDisneyPacket& pkt) {
  return pkt.rawLen > 0 ? pkt.rawPayload : nullptr;
}

static size_t pktRawLen(const ParsedDisneyPacket& pkt) {
  return pkt.rawLen;
}

void notifyWandPalette(uint8_t paletteIdx, OverrideSource src) {
  uint8_t r, g, b;
  paletteToRGB(paletteIdx, r, g, b);
  if (!canTakeOverride(src)) {
    if (src == BLE_STARLIGHT) bleNotify("{\"type\":\"sw_event\",\"event\":\"blocked\"}");
    return;
  }
  uint8_t pals[1] = { paletteIdx };
  int wandIdx = -1;
  for (int i = 0; i < SW_ANIM_COUNT; i++) {
    if (strcmp("wand", SW_ANIM_KEYS[i]) == 0) { wandIdx = i; break; }
  }
  if (wandIdx >= 0) {
    Serial.printf("[Wand] map preset=%s embedded=%u bytes\n",
                  swAnimMap[wandIdx].presetId.c_str(),
                  (unsigned)swAnimMap[wandIdx].wledPayload.length());
  }
  if (applySwAnimationKey("wand", pals, 1, src)) {
    if (src == BLE_STARLIGHT) {
      bleNotify("{\"type\":\"sw_color\",\"palette\":" + String(paletteIdx) +
                ",\"r\":" + String(r) + ",\"g\":" + String(g) + ",\"b\":" + String(b) + "}");
    }
    Serial.printf("[Wand] Applied SW animation preset (palette %u)\n", paletteIdx);
    return;
  }
  if (applyMbAnimationKey("wand", pals, 1, src)) {
    if (src == BLE_STARLIGHT) {
      bleNotify("{\"type\":\"sw_color\",\"palette\":" + String(paletteIdx) +
                ",\"r\":" + String(r) + ",\"g\":" + String(g) + ",\"b\":" + String(b) + "}");
    }
    return;
  }
  Serial.printf("[Wand] No preset on board for SW/MB wand — solid fallback (palette %u)\n", paletteIdx);
  applyMbSegmentSolid("all", paletteIdx, src);
  if (src == BLE_STARLIGHT) {
    bleNotify("{\"type\":\"sw_color\",\"palette\":" + String(paletteIdx) +
              ",\"r\":" + String(r) + ",\"g\":" + String(g) + ",\"b\":" + String(b) + "}");
  }
}

bool mbEffectIsRepeatAdvert(const uint8_t* payload, size_t plen) {
  if (plen == 0 || lastMbEffectLen == 0) return false;
  size_t n = plen < sizeof(lastMbEffectPayload) ? plen : sizeof(lastMbEffectPayload);
  if (n != lastMbEffectLen) return false;
  if (memcmp(payload, lastMbEffectPayload, n) != 0) return false;
  return currentOverride == BLE_MAGIC;
}

void rememberMbEffect(const uint8_t* payload, size_t plen) {
  if (plen > sizeof(lastMbEffectPayload)) plen = sizeof(lastMbEffectPayload);
  memcpy(lastMbEffectPayload, payload, plen);
  lastMbEffectLen = plen;
}

void notifyMbE9ToApp(const uint8_t* payload, size_t plen) {
  if (!bleConnected) return;
  bleNotify("{\"type\":\"ble_e9\",\"hex\":\"" + mfrToHexFull(payload, plen, 64) +
            "\",\"len\":" + String(plen) +
            ",\"ts\":" + String(millis()) + "}");
}

void notifyUnknownAnimation(const uint8_t* payload, size_t plen, SwMatchQuality quality, uint16_t func) {
  if (!bleCaptureToApp || !bleConnected) return;
  String q = quality == SW_MATCH_FUZZY ? "fuzzy" : "none";
  bleNotify("{\"type\":\"unknown_anim\",\"quality\":\"" + q +
            "\",\"func\":\"0x" + String(func, HEX) +
            "\",\"hex\":\"" + mfrToHexFull(payload, plen, 64) +
            "\",\"len\":" + String(plen) +
            ",\"label\":\"" + String(captureLabel) +
            "\",\"ts\":" + String(millis()) + "}");
}

static void applyWandFromParsed(const ParsedDisneyPacket& pkt, bool legacy) {
  const uint8_t* payload = pktRaw(pkt);
  size_t plen = pktRawLen(pkt);
  if (!payload || plen == 0) {
    // No raw — apply palette only
    uint8_t paletteIdx = pkt.paletteCount > 0 ? pkt.palettes[0] : 0;
    if (!starlightEnabled) {
      bleNotify("{\"type\":\"sw_event\",\"event\":\"disabled\"}");
      return;
    }
    notifyWandPalette(paletteIdx, BLE_STARLIGHT);
    return;
  }

  if (wandCastIsDuplicateAdvert(payload, plen)) {
    if (starlightEnabled && currentOverride == BLE_STARLIGHT) {
      touchOverrideIdleTimer(BLE_STARLIGHT);
    }
    return;
  }
  rememberWandCast(payload, plen);

  uint8_t paletteIdx = pkt.paletteCount > 0 ? pkt.palettes[0]
                      : (legacy ? (payload[plen - 1] & 0x1F) : (payload[12] & 0x1F));
  if (legacy) {
    Serial.printf("[Wand] CF9B legacy cast palette=%u len=%u\n", paletteIdx, (unsigned)plen);
    notifySwDebug("wand_cf9b", payload, plen);
  } else {
    Serial.printf("[Wand] CAST palette=%u roll=%02X%02X%02X%02X%02X%02X\n",
                  paletteIdx, plen > 6 ? payload[6] : 0, plen > 7 ? payload[7] : 0,
                  plen > 8 ? payload[8] : 0, plen > 9 ? payload[9] : 0,
                  plen > 10 ? payload[10] : 0, plen > 11 ? payload[11] : 0);
    notifySwDebug("wand_cast", payload, plen);
  }

  if (!starlightEnabled) {
    bleNotify("{\"type\":\"sw_event\",\"event\":\"disabled\"}");
    return;
  }
  notifyWandPalette(paletteIdx, BLE_STARLIGHT);
}

void applyParsedDisneyPacket(const ParsedDisneyPacket& pkt) {
  if (pkt.kind == DisneyPacketKind::UNKNOWN) return;

  // MB effect dedupe / defer needs raw when available
  const uint8_t* payload = pktRaw(pkt);
  size_t plen = pktRawLen(pkt);

  if (pkt.kind == DisneyPacketKind::WAND_CAST) {
    applyWandFromParsed(pkt, false);
    return;
  }
  if (pkt.kind == DisneyPacketKind::WAND_CF9B_LEGACY) {
    applyWandFromParsed(pkt, true);
    return;
  }

  // MagicBand / show family
  if (payload && plen > 0 && mbEffectIsRepeatAdvert(payload, plen)) {
    if (magicBandEnabled) touchOverrideIdleTimer(BLE_MAGIC);
    return;
  }

  pendingMbEffectPayload = payload;
  pendingMbEffectPayloadLen = plen;
  struct MbPendingGuard {
    ~MbPendingGuard() {
      pendingMbEffectPayload = nullptr;
      pendingMbEffectPayloadLen = 0;
    }
  } mbPendingGuard;

  Serial.printf("[MB+] kind=%u opcode=0x%04X len=%u\n",
                (unsigned)pkt.kind, pkt.opcode, (unsigned)plen);

  if (mbDeferToApp && bleConnected && magicBandEnabled && payload && plen >= 3 &&
      payload[2] == 0xE9) {
    if (!canTakeOverride(BLE_MAGIC)) return;
    rememberMbEffect(payload, plen);
    notifyMbE9ToApp(payload, plen);
    touchOverrideIdleTimer(BLE_MAGIC);
    Serial.println("[MB+] defer to app");
    return;
  }

  switch (pkt.kind) {
    case DisneyPacketKind::E905_SINGLE:
      if (!magicBandEnabled || !canTakeOverride(BLE_MAGIC)) return;
      applyMbSingleMask(pkt.maskByte, pkt.palettes[0], BLE_MAGIC);
      {
        uint8_t r, g, b;
        paletteToRGB(pkt.palettes[0], r, g, b);
        bleNotify("{\"type\":\"ble_color\",\"r\":" + String(r) + ",\"g\":" + String(g) + ",\"b\":" + String(b) + "}");
      }
      if (payload && plen) rememberMbEffect(payload, plen);
      break;

    case DisneyPacketKind::E906_DUAL:
      if (!magicBandEnabled || !canTakeOverride(BLE_MAGIC)) return;
      applyMbDual(pkt.palettes[0], pkt.palettes[1], BLE_MAGIC);
      {
        uint8_t r, g, b;
        paletteToRGB(pkt.palettes[1] & 0x1F, r, g, b);
        bleNotify("{\"type\":\"ble_color\",\"r\":" + String(r) + ",\"g\":" + String(g) + ",\"b\":" + String(b) + "}");
      }
      if (payload && plen) rememberMbEffect(payload, plen);
      break;

    case DisneyPacketKind::E908_RGB:
      if (!magicBandEnabled || !canTakeOverride(BLE_MAGIC)) return;
      applyFullStripSolid(pkt.palettes[0], pkt.palettes[1], pkt.palettes[2], BLE_MAGIC);
      bleNotify("{\"type\":\"ble_event\",\"event\":\"rgb\"}");
      if (payload && plen) rememberMbEffect(payload, plen);
      break;

    case DisneyPacketKind::E909_FIVE_PALETTE: {
      if (!magicBandEnabled || !canTakeOverride(BLE_MAGIC)) return;
      uint8_t tl = pkt.palettes[0], bl = pkt.palettes[1], br = pkt.palettes[2];
      uint8_t tr = pkt.palettes[3], c = pkt.palettes[4];
      if (pkt.maskByte & 0x80) {
        char patKey[2] = { 0, 0 };
        const char* hex = "0123456789ABCDEF";
        patKey[0] = hex[pkt.maskByte & 0x0F];
        uint8_t pals[5] = { tl, bl, br, tr, c };
        if (applyMbPatternKey(patKey, pals, 5, BLE_MAGIC)) {
          if (payload && plen) rememberMbEffect(payload, plen);
          break;
        }
      }
      applyMbFive(tl, bl, br, tr, c, BLE_MAGIC);
      bleNotify("{\"type\":\"ble_event\",\"event\":\"five_color\"}");
      if (payload && plen) rememberMbEffect(payload, plen);
      break;
    }

    case DisneyPacketKind::E90C_PALETTE: {
      if (!magicBandEnabled || !canTakeOverride(BLE_MAGIC)) return;
      applyMbFive(pkt.palettes[0], pkt.palettes[1], pkt.palettes[2],
                  pkt.palettes[3], pkt.palettes[4], BLE_MAGIC);
      bleNotify("{\"type\":\"ble_event\",\"event\":\"five_color\"}");
      if (payload && plen) rememberMbEffect(payload, plen);
      break;
    }

    case DisneyPacketKind::E90E_FLASH:
      if (payload && plen) {
        if (!tryApplySwE9Payload(payload, plen, "E90E", "flash"))
          applyMbAnimOpcode("E90E", "flash");
        rememberMbEffect(payload, plen);
      } else {
        applyMbAnimOpcode("E90E", "flash");
      }
      break;

    case DisneyPacketKind::E90C_ANIMATION:
      if (payload && plen) {
        if (!tryApplySwE9Payload(payload, plen, "E90C", "show_fx")) {
          notifyUnknownAnimation(payload, plen, SW_MATCH_NONE, 0xE90C);
          applyMbAnimOpcode("E90C", "show_fx");
        }
        rememberMbEffect(payload, plen);
      }
      break;

    case DisneyPacketKind::E9_UNCLASSIFIED: {
      // Opcodes that previously had dedicated applyMbAnimOpcode paths keep them
      // after SW match fails. Truly unknown opcodes only log (no inventing).
      if (payload && plen) rememberMbEffect(payload, plen);

      if (pkt.opcode == 0xE90E) {
        if (!payload || !tryApplySwE9Payload(payload, plen, "E90E", "flash"))
          applyMbAnimOpcode("E90E", "flash");
        break;
      }
      if (pkt.opcode == 0xE90F) {
        if (magicBandEnabled && canTakeOverride(BLE_MAGIC)) {
          if (payload) notifyUnknownAnimation(payload, plen, SW_MATCH_NONE, 0xE90F);
          applyMbAnimOpcode("E90F", "animation");
        }
        break;
      }
      if (pkt.opcode == 0xE910) {
        if (!payload || !tryApplySwE9Payload(payload, plen, "E910", "animation"))
          applyMbAnimOpcode("E910", "animation");
        break;
      }
      if (pkt.opcode == 0xE911) {
        if (!payload || !tryApplySwE9Payload(payload, plen, "E911", "animation"))
          applyMbAnimOpcode("E911", "animation");
        break;
      }
      if (pkt.opcode == 0xE912) {
        if (!payload || !tryApplySwE9Payload(payload, plen, "E912", "animation"))
          applyMbAnimOpcode("E912", "animation");
        break;
      }
      if (pkt.opcode == 0xE913) {
        if (!payload || !tryApplySwE9Payload(payload, plen, "E913", "animation"))
          applyMbAnimOpcode("E913", "animation");
        break;
      }

      // Bare show E9 (historically try SW then E90C anim)
      if (payload && plen >= 2 && payload[0] == 0xE9) {
        if (tryApplySwE9Payload(payload, plen, "E90C", "show")) break;
        if (!magicBandEnabled || !canTakeOverride(BLE_MAGIC)) break;
        applyMbAnimOpcode("E90C", "show");
        break;
      }

      Serial.printf("[MB+] unhandled func 0x%04X\n", pkt.opcode);
      if (magicBandEnabled && canTakeOverride(BLE_MAGIC))
        bleNotify("{\"type\":\"ble_event\",\"event\":\"animation\"}");
      break;
    }

    default:
      Serial.printf("[MB+] unhandled kind %u\n", (unsigned)pkt.kind);
      break;
  }
}

void handleDisneyPayload(const uint8_t* payload, size_t plen) {
  ParsedDisneyPacket pkt = decodeDisneyPayload(payload, plen, millis());
  applyParsedDisneyPacket(pkt);
}

void handleWandCast(const uint8_t* payload, size_t plen) {
  ParsedDisneyPacket pkt = decodeDisneyPayload(payload, plen, millis());
  if (pkt.kind != DisneyPacketKind::WAND_CAST) return;
  applyParsedDisneyPacket(pkt);
}

void handleLegacyCf9bCast(const uint8_t* payload, size_t plen) {
  ParsedDisneyPacket pkt = decodeDisneyPayload(payload, plen, millis());
  if (pkt.kind != DisneyPacketKind::WAND_CF9B_LEGACY) return;
  applyParsedDisneyPacket(pkt);
}

void handleE1E2Payload(const uint8_t* payload, size_t plen) {
  ParsedDisneyPacket pkt = decodeDisneyPayload(payload, plen, millis());
  applyParsedDisneyPacket(pkt);
}

void handleShowPayload(const uint8_t* payload, size_t plen) {
  ParsedDisneyPacket pkt = decodeDisneyPayload(payload, plen, millis());
  applyParsedDisneyPacket(pkt);
}
