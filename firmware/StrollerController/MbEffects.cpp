#include "MbEffects.h"
#include "Globals.h"
#include "WledClient.h"
#include "OverrideManager.h"
#include "MbMapping.h"
#include "MbPacketDecode.h"
#include "ColorPalette.h"
#include "PresetStore.h"
#include "BlePeripheral.h"

static int countPresetColorSlots(JsonObject wled) {
  JsonArray segs = wled["seg"].as<JsonArray>();
  if (!segs.isNull() && segs.size() > 0) {
    JsonArray col = segs[0]["col"].as<JsonArray>();
    if (!col.isNull() && col.size() > 0) return (int)col.size();
  }
  JsonArray col = wled["col"].as<JsonArray>();
  if (!col.isNull() && col.size() > 0) return (int)col.size();
  return 0;
}



void applyMbSingle(uint8_t colorByte, OverrideSource src) {
  uint8_t payload[9] = { 0xE1, 0x00, 0xE9, 0x05, 0x00, 0x09, 0x0E, colorByte, 0xB0 };
  applyMbSingleE905(payload, src);
}

void applyMbDual(uint8_t innerByte, uint8_t outerByte, OverrideSource src) {
  const char* keys[2] = { "inner", "outer" };
  uint8_t pals[2] = { (uint8_t)(innerByte & 0x1F), (uint8_t)(outerByte & 0x1F) };
  applyMbMultiSegmentSolid(keys, pals, 2, src);
}

void applyMbFive(uint8_t topLeft, uint8_t bottomLeft, uint8_t bottomRight,
                 uint8_t topRight, uint8_t center, OverrideSource src) {
  if (!canTakeOverride(src)) return;
  if (WiFi.status() != WL_CONNECTED) return;

  // E909 wire order is TL, BL, BR, TR, center (Adafruit). On the stroller strip install,
  // those slots map to rotated physical corners — permute into our segment key names.
  static const char* keys[5] = { "topLeft", "bottomLeft", "bottomRight", "topRight", "center" };
  uint8_t pals[5] = { center, topRight, bottomRight, bottomLeft, topLeft };

  applyMbMultiSegmentSolid(keys, pals, 5, src);
}

void applyMbSegmentSolid(const char* segKey, uint8_t palIdx, OverrideSource src) {
  int si = mbSegKeyIndex(segKey);
  if (si < 0) return;
  palIdx &= 0x1F;
  bool isRandom = (palIdx == MB_PAL_RANDOM);
  if (!isRandom && !canTakeOverride(src)) return;
  if (isRandom && !magicBandEnabled) return;
  if (isRandom && currentOverride != src && !canTakeOverride(src)) return;
  if (WiFi.status() != WL_CONNECTED) return;
  uint8_t r, g, b;
  paletteToRGB(palIdx, r, g, b);
  if (isMbColorBlack(r, g, b) && strcmp(segKey, "all") == 0) {
    applyMbFullStripOff(src);
    return;
  }
  MbSegMap& map = activeMbSegMap(si);
  if (map.count == 0) return;
  saveWledStateForOverride();
  uint8_t activeIds[MB_MAX_SEG_REFS * 5];
  uint8_t activeCount = 0;
  collectActiveSegIds(map, activeIds, activeCount);
  bool disableSeg0 = (strcmp(segKey, "all") != 0);
  String body = "{\"on\":true,\"seg\":[";
  bool first = true;
  appendDisableInactiveSegments(body, first, activeIds, activeCount, disableSeg0);
  for (uint8_t i = 0; i < map.count; i++) {
    appendWledSolidSeg(body, map.refs[i], r, g, b, first);
  }
  body += "]}";
  sendToWLEDForBleSolid(body);
  setOverride(src);
  touchOverrideIdleTimer(src);
}

void applyMbMultiSegmentSolid(const char* segKeys[], const uint8_t pals[], int n, OverrideSource src) {
  saveWledStateForOverride();
  uint8_t activeIds[MB_MAX_SEG_REFS * 5];
  uint8_t activeCount = 0;
  for (int i = 0; i < n; i++) {
    int si = mbSegKeyIndex(segKeys[i]);
    if (si < 0) continue;
    collectActiveSegIds(activeMbSegMap(si), activeIds, activeCount);
  }
  String body = "{\"on\":true,\"seg\":[";
  bool first = true;
  // Zone presets use segment 0 full-strip — disable before split layout.
  appendDisableInactiveSegments(body, first, activeIds, activeCount, true);
  for (int i = 0; i < n; i++) {
    int si = mbSegKeyIndex(segKeys[i]);
    if (si < 0) continue;
    uint8_t r, g, b;
    paletteToRGB(pals[i], r, g, b);
    MbSegMap& siMap = activeMbSegMap(si);
    for (uint8_t j = 0; j < siMap.count; j++) {
      const WledSegRef& ref = siMap.refs[j];
      appendWledSolidSeg(body, ref, r, g, b, first);
    }
  }
  body += "]}";
  sendToWLEDForBleSolid(body);
  setOverride(src);
  touchOverrideIdleTimer(src);
}

void applyMagicBandChase(const uint8_t paletteIdxs[5], OverrideSource src) {
  if (!canTakeOverride(src)) {
    Serial.printf("[MB] chase blocked by override %d\n", (int)currentOverride);
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[MB] WiFi down — chase not sent");
    return;
  }
  saveWledStateForOverride();
  Serial.printf("[MB] Chase spd=%u thick=%u pals=%u,%u,%u,%u,%u\n",
                mbChaseSpeed, mbChaseThickness,
                paletteIdxs[0], paletteIdxs[1], paletteIdxs[2], paletteIdxs[3], paletteIdxs[4]);
  sendToWLEDForBleEffect(buildMagicBandChaseJson(paletteIdxs));
  setOverride(src);
  touchOverrideIdleTimer(src);
}

void applyMagicBandChaseFromAnchor(uint8_t anchorPalette, OverrideSource src) {
  uint8_t pals[5];
  for (int i = 0; i < 5; i++) pals[i] = (anchorPalette + (uint8_t)(i * 5)) & 0x1F;
  applyMagicBandChase(pals, src);
}

String buildMagicBandChaseJson(const uint8_t paletteIdxs[5]) {
  static const int positions[5] = {0, 51, 102, 153, 204};
  String pd = "\"pd\":{\"" + String(WLED_MB_PAL_SLOT) + "\":[";
  for (int i = 0; i < 5; i++) {
    uint8_t r, g, b;
    paletteToRGB(paletteIdxs[i], r, g, b);
    if (i > 0) pd += ",";
    pd += "[" + String(positions[i]) + "," + String(r) + "," + String(g) + "," + String(b) + "]";
  }
  pd += "]}";
  String body = "{" + pd + ",\"seg\":[";
  bool first = true;
  uint8_t activeIds[1] = { 0 };
  uint8_t activeCount = 1;
  appendDisableInactiveSegments(body, first, activeIds, activeCount, false);
  body += "{\"id\":0,\"start\":0,\"stop\":" + String(STRIP_LED_COUNT) +
         ",\"fx\":" + String(WLED_CHASE_FX) + ",\"sx\":" + String(mbChaseSpeed) +
         ",\"grp\":" + String(mbChaseThickness) + ",\"pal\":" + String(WLED_MB_PAL_SLOT) + "}";
  body += "]}";
  return body;
}

bool applyMbPresetWithColors(const MbEffectMap& map, const uint8_t* packetPals, int packetPalCount, OverrideSource src) {
  String presetId = resolveEffectPresetId(map);
  if (presetId.length() == 0 && map.wledPayload.length() == 0) return false;
  if (!canTakeOverride(src)) return false;

  int slotCount = map.colorSlotCount;
  if (slotCount <= 0 && packetPalCount > 0) {
    // Wand / MB packet palette → fill every preset color slot (e.g. BPM needs 3× same hue).
    slotCount = 3;
  } else if (slotCount <= 0) {
    slotCount = packetPalCount;
  }

  // No packet palette and no mapped color slots — apply preset unchanged.
  if (slotCount <= 0) {
    saveWledStateForOverride();
    bool ok = presetId.length() > 0 ? applyPreset(presetId) : false;
    if (ok) {
      setOverride(src);
      touchOverrideIdleTimer(src);
      Serial.printf("[BLE] Applied preset %s (zone-style)\n", presetId.c_str());
    } else if (presetId.length() > 0) {
      Serial.printf("[BLE] Preset not found on board: %s\n", presetId.c_str());
    }
    return ok;
  }

  saveWledStateForOverride();
  DynamicJsonDocument wled(12288);
  if (!loadEffectMapWled(map, wled)) return false;

  if (map.colorSlotCount <= 0 && packetPalCount > 0) {
    int presetSlots = countPresetColorSlots(wled.as<JsonObject>());
    if (presetSlots > slotCount) slotCount = presetSlots;
  }

  const bool wandColors = packetPalCount > 0 && (src == BLE_STARLIGHT || src == BLE_MAGIC);

  if (slotCount > 0) {
    auto applyColorsToSeg = [&](JsonObject segObj) {
      int stop = segObj["stop"] | 0;
      int start = segObj["start"] | 0;
      if (stop <= start && stop <= 0) return;
      if (wandColors) segObj["pal"] = WLED_PAL_COLORS_ONLY;
      JsonArray col = segObj["col"].to<JsonArray>();
      col.clear();
      for (int i = 0; i < slotCount; i++) {
        uint8_t pal = packetPalCount > 0 ? packetPals[i % packetPalCount] : 0;
        if (map.colorSlotCount > 0) pal = map.colorSlots[i % map.colorSlotCount];
        uint8_t r, g, b;
        paletteToRGB(pal, r, g, b);
        JsonArray rgb = col.createNestedArray();
        rgb.add(r); rgb.add(g); rgb.add(b);
      }
    };

    JsonArray segs = wled["seg"].as<JsonArray>();
    if (!segs.isNull() && segs.size() > 0) {
      bool touched = false;
      for (JsonObject segObj : segs) {
        int stop = segObj["stop"] | 0;
        if (stop <= 0) continue;
        applyColorsToSeg(segObj);
        touched = true;
      }
      if (!touched) applyColorsToSeg(segs[0]);
    } else {
      if (wandColors) wled["pal"] = WLED_PAL_COLORS_ONLY;
      JsonArray col = wled["col"].to<JsonArray>();
      col.clear();
      for (int i = 0; i < slotCount; i++) {
        uint8_t pal = packetPalCount > 0 ? packetPals[i % packetPalCount] : 0;
        if (map.colorSlotCount > 0) pal = map.colorSlots[i % map.colorSlotCount];
        uint8_t r, g, b;
        paletteToRGB(pal, r, g, b);
        JsonArray rgb = col.createNestedArray();
        rgb.add(r); rgb.add(g); rgb.add(b);
      }
    }
  }

  String wledJson;
  serializeJson(wled, wledJson);
  ensureWledPowerOn();
  disableAllSplitSegments();
  delay(80);
  String payload = preparePresetApplyPayload(wledJson);
  bool ok = sendToWLED(injectWledTransition(payload, bleEffectTransitionMs), 8000, 2);
  if (!ok) return false;
  setOverride(src);
  touchOverrideIdleTimer(src);
  Serial.printf("[BLE] Preset %s + %d color slot(s) (full apply, pal=%d)\n",
                presetId.length() ? presetId.c_str() : "embedded", slotCount, WLED_PAL_COLORS_ONLY);
  return true;
}

bool applyMbAnimationKey(const char* key, const uint8_t* pals, int palCount, OverrideSource src) {
  for (int i = 0; i < 8; i++) {
    if (strcmp(key, MB_ANIM_KEYS[i]) != 0) continue;
    if (applyMbPresetWithColors(mbAnimMap[i], pals, palCount, src)) return true;
    return false;
  }
  return false;
}

bool applyMbPatternKey(const char* patKey, const uint8_t* pals, int palCount, OverrideSource src) {
  for (int i = 0; i < 5; i++) {
    if (strcmp(patKey, MB_PAT_KEYS[i]) != 0) continue;
    // E909 per-corner solids — only hijack when this pattern slot has its own preset.
    if (mbPatMap[i].presetId.length() == 0) return false;
    if (applyMbPresetWithColors(mbPatMap[i], pals, palCount, src)) return true;
    return false;
  }
  return false;
}

void applyMbAnimOpcode(const char* animKey, const char* label) {
  if (!magicBandEnabled) return;
  if (!canTakeOverride(BLE_MAGIC)) return;
  if (applyMbAnimationKey(animKey, nullptr, 0, BLE_MAGIC)) {
    bleNotify("{\"type\":\"ble_event\",\"event\":\"" + String(label) + "\"}");
    return;
  }
  saveWledStateForOverride();
  uint8_t activeIds[1] = { 0 };
  uint8_t activeCount = 1;
  String body = "{\"on\":true,\"seg\":[";
  bool first = true;
  appendDisableInactiveSegments(body, first, activeIds, activeCount, false);
  body += "{\"id\":0,\"start\":0,\"stop\":" + String(STRIP_LED_COUNT) + ",\"fx\":0}";
  body += "]}";
  sendToWLEDForBleEffect(body);
  setOverride(BLE_MAGIC);
  touchOverrideIdleTimer(BLE_MAGIC);
  bleNotify("{\"type\":\"ble_event\",\"event\":\"" + String(label) + "\"}");
}

void disableMbSplitSegments() {
  disableAllSplitSegments();
}

// ─────────────────────────────────────────────
// OVERRIDE LOGIC
// Priority: MagicBand+ (5) > Starlight Wand (4) > Manual (2) > Zone (1)
// ─────────────────────────────────────────────

void disableAllSplitSegments() {
  String body = "{\"seg\":[";
  bool first = true;
  for (uint8_t id = 1; id < MB_WLED_MAX_SEG; id++) {
    appendDisableWledSegment(body, id, first);
  }
  body += "]}";
  sendToWLED(body, 3000, 1);
}

void applyFullStripSolid(uint8_t r, uint8_t g, uint8_t b, OverrideSource src) {
  if (!canTakeOverride(src)) return;
  if (WiFi.status() != WL_CONNECTED) {
    if (src == BLE_STARLIGHT) bleNotify("{\"type\":\"sw_event\",\"event\":\"wifi_down\"}");
    return;
  }
  if (isMbColorBlack(r, g, b)) {
    applyMbFullStripOff(src);
    return;
  }
  saveWledStateForOverride();
  uint8_t activeIds[1] = { 0 };
  uint8_t activeCount = 1;
  String body = "{\"on\":true,\"seg\":[";
  bool first = true;
  appendDisableInactiveSegments(body, first, activeIds, activeCount, false);
  body += "{\"id\":0,\"start\":0,\"stop\":" + String(STRIP_LED_COUNT)
       + ",\"fx\":0,\"col\":[[" + String(r) + "," + String(g) + "," + String(b) + "]]}";
  body += "]}";
  sendToWLEDForBleSolid(body);
  setOverride(src);
  touchOverrideIdleTimer(src);
}

void applyMbFullStripOff(OverrideSource src) {
  if (!canTakeOverride(src)) return;
  if (WiFi.status() != WL_CONNECTED) return;
  saveWledStateForOverride();
  // on:false fades brightness without crossfading chase fx → solid black on seg 0
  sendToWLED(injectWledTransition("{\"on\":false}", bleEffectTransitionMs));
  setOverride(src);
  touchOverrideIdleTimer(src);
}

bool isMbColorBlack(uint8_t r, uint8_t g, uint8_t b) {
  return r == 0 && g == 0 && b == 0;
}

void appendDisableWledSegment(String& body, uint8_t segId, bool& first) {
  if (!first) body += ",";
  first = false;
  body += "{\"id\":" + String(segId) + ",\"stop\":0}";
}

void appendDisableInactiveSegments(String& body, bool& first,
                                  const uint8_t* activeIds, uint8_t activeCount, bool disableSeg0) {
  if (disableSeg0) {
    bool seg0Active = false;
    for (uint8_t i = 0; i < activeCount; i++) {
      if (activeIds[i] == 0) { seg0Active = true; break; }
    }
    if (!seg0Active) appendDisableWledSegment(body, 0, first);
  }
  for (uint8_t id = 1; id < MB_WLED_MAX_SEG; id++) {
    bool keep = false;
    for (uint8_t i = 0; i < activeCount; i++) {
      if (activeIds[i] == id) { keep = true; break; }
    }
    if (!keep) appendDisableWledSegment(body, id, first);
  }
}

void appendWledSolidSeg(String& body, const WledSegRef& ref,
                        uint8_t r, uint8_t g, uint8_t b, bool& first) {
  if (ref.stop <= ref.start) return;
  if (!first) body += ",";
  first = false;
  body += "{\"id\":" + String(ref.id) + ",\"start\":" + String(ref.start) + ",\"stop\":" + String(ref.stop)
       + ",\"grp\":" + String(ref.grp) + ",\"spc\":" + String(ref.spc)
       + ",\"of\":" + String(ref.of) + ",\"rev\":" + String(ref.rev ? "true" : "false")
       + ",\"mi\":" + String(ref.mi ? "true" : "false")
       + ",\"on\":true,\"fx\":0"
       + ",\"col\":[[" + String(r) + "," + String(g) + "," + String(b) + "]]}";
}

void addActiveSegId(uint8_t id, uint8_t* out, uint8_t& count) {
  for (uint8_t i = 0; i < count; i++) {
    if (out[i] == id) return;
  }
  if (count < MB_MAX_SEG_REFS * 5) out[count++] = id;
}

void collectActiveSegIds(const MbSegMap& map, uint8_t* out, uint8_t& count) {
  for (uint8_t i = 0; i < map.count; i++) {
    addActiveSegId(map.refs[i].id, out, count);
  }
}

void applyMbSingleMask(uint8_t mask8, uint8_t pal, OverrideSource src) {
  if (WiFi.status() != WL_CONNECTED) return;
  if (mask8 == 0) {
    applyMbSegmentSolid("all", pal, src);
    return;
  }
  static const char* keys[8] = {
    "band0", "band1", "band2", "band3", "band4", "band5", "band6", "band7"
  };
  const char* segKeys[8];
  uint8_t pals[8];
  int m = 0;
  for (int i = 0; i < 8; i++) {
    if (mask8 & (1 << i)) {
      segKeys[m] = keys[i];
      pals[m] = pal;
      m++;
    }
  }
  if (m == 0) applyMbSegmentSolid("all", pal, src);
  else applyMbMultiSegmentSolid(segKeys, pals, m, src);
}

void applyMbSingleE905(const uint8_t* payload, OverrideSource src) {
  applyMbSingleMask(decodeE905MaskByte(payload), decodeE905Palette(payload), src);
}

