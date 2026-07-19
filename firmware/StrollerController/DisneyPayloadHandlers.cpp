#include "DisneyPayloadHandlers.h"
#include "Globals.h"
#include "DisneyBleFilter.h"
#include "MbEffects.h"
#include "MbPacketDecode.h"
#include "MbMapping.h"
#include "MbRuleEngine.h"
#include "SwEffects.h"
#include "OverrideManager.h"
#include "ColorPalette.h"
#include "BlePeripheral.h"
#include "DebugLog.h"
#include "PresetStore.h"
#include <string.h>

static const uint8_t* pktRaw(const ParsedDisneyPacket& pkt) {
  return pkt.rawLen > 0 ? pkt.rawPayload : nullptr;
}

static size_t pktRawLen(const ParsedDisneyPacket& pkt) {
  return pkt.rawLen;
}

static bool looksLikeWandPayload(const uint8_t* payload, size_t plen) {
  if (!payload || plen < 6) return false;
  if (memcmp(payload, WAND_CAST_SIG, 6) == 0) return true;
  if (plen >= 2 && payload[0] == 0xCF && payload[1] == 0x9B) return true;
  return false;
}

void notifyWandPalette(uint8_t paletteIdx, OverrideSource src) {
  // Hard lockout: MagicBand+ owns the strip — wand must not interrupt.
  if (currentOverride == BLE_MAGIC) return;

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

void applyParsedDisneyPacket(const ParsedDisneyPacket& pkt) {
  const uint8_t* payload = pktRaw(pkt);
  size_t plen = pktRawLen(pkt);
  int rssi = (int)pkt.rssi;

  // Parade beacon detection runs for any payload (including otherwise-unmapped frames).
  if (payload && plen > 0) {
    checkParadeBeacon(payload, plen, rssi);
  }

  if (!payload || plen == 0) return;

  // Hard lockout: ignore wand packets entirely while MagicBand+ holds override.
  if (looksLikeWandPayload(payload, plen) && currentOverride == BLE_MAGIC) return;

  // Wand cast dedupe
  if (looksLikeWandPayload(payload, plen)) {
    if (wandCastIsDuplicateAdvert(payload, plen)) {
      if (starlightEnabled && currentOverride == BLE_STARLIGHT) {
        touchOverrideIdleTimer(BLE_STARLIGHT);
      }
      return;
    }
    rememberWandCast(payload, plen);
    notifySwDebug(
      (plen >= 2 && payload[0] == 0xCF && payload[1] == 0x9B) ? "wand_cf9b" : "wand_cast",
      payload, plen);
  }

  // MB effect dedupe — refresh idle timer only
  if (mbEffectIsRepeatAdvert(payload, plen)) {
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

  if (mbDeferToApp && bleConnected && magicBandEnabled && plen >= 3 &&
      payload[2] == 0xE9) {
    if (!canTakeOverride(BLE_MAGIC)) return;
    rememberMbEffect(payload, plen);
    notifyMbE9ToApp(payload, plen);
    touchOverrideIdleTimer(BLE_MAGIC);
    Serial.println("[MB+] defer to app");
    return;
  }

  JsonArray rules = mbRulesJsonArray();
  int matchIdx = findMatchingRule(payload, plen, rules);
  if (matchIdx >= 0) {
    JsonObject rule = rules[matchIdx].as<JsonObject>();
    Serial.printf("[Rule] match idx=%d name=%s\n", matchIdx, rule["name"] | "");
    applyMatchedRule(rule, payload, plen);
    rememberMbEffect(payload, plen);
    return;
  }

  // Infrastructure noise (wake pings / wand idle) — don't spam unmatched log or default preset
  bool infraNoise = (plen >= 2 && payload[0] == 0xCC && payload[1] == 0x03) ||
                    (plen >= 2 && payload[0] == 0x0F && payload[1] == 0x11);
  if (infraNoise) return;

  // No rule matched
  notifyMbUnmatched(payload, plen);

  if (bleDefaultPresetId.length() > 0) {
    bool wand = looksLikeWandPayload(payload, plen);
    OverrideSource src = wand ? BLE_STARLIGHT : BLE_MAGIC;
    if (wand && !starlightEnabled) return;
    if (!wand && !magicBandEnabled) return;
    if (!canTakeOverride(src)) return;
    saveWledStateForOverride();
    if (applyPreset(bleDefaultPresetId)) {
      setOverride(src);
      touchOverrideIdleTimer(src);
      rememberMbEffect(payload, plen);
      Serial.printf("[Rule] defaultPresetId=%s\n", bleDefaultPresetId.c_str());
    }
    return;
  }

  Serial.printf("[Rule] no match len=%u rssi=%d\n", (unsigned)plen, rssi);
}

void handleDisneyPayload(const uint8_t* payload, size_t plen) {
  ParsedDisneyPacket pkt = decodeDisneyPayload(payload, plen, millis());
  applyParsedDisneyPacket(pkt);
}

void handleWandCast(const uint8_t* payload, size_t plen) {
  ParsedDisneyPacket pkt = decodeDisneyPayload(payload, plen, millis());
  applyParsedDisneyPacket(pkt);
}

void handleLegacyCf9bCast(const uint8_t* payload, size_t plen) {
  ParsedDisneyPacket pkt = decodeDisneyPayload(payload, plen, millis());
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
