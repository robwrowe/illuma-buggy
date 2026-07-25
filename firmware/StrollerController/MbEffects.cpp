#include "MbEffects.h"
#include "Globals.h"
#include "WledClient.h"
#include "OverrideManager.h"
#include "MbMapping.h"
#include "ColorPalette.h"

// Serial-console debug helpers (mb five / mb <pal> [mask]) — not on the packet→rule path.

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

void disableAllSplitSegments() {
  String body = "{\"seg\":[";
  bool first = true;
  for (uint8_t id = 1; id < MB_WLED_MAX_SEG; id++) {
    appendDisableWledSegment(body, id, first);
  }
  body += "]}";
  sendToWLED(body, 3000, 1);
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
