#include "MbRuleEngine.h"
#include "Globals.h"
#include "ColorPalette.h"
#include "MbMapping.h"
#include "MbEffects.h"
#include "OverrideManager.h"
#include "PresetStore.h"
#include "WledClient.h"
#include "BlePeripheral.h"
#include "DebugLog.h"
#include "DisneyBleFilter.h"
#include <math.h>
#include <string.h>
#include <stdlib.h>
#include <ctype.h>

// Cached rules document — refreshed by applyMbRulesJson / loadMbRulesFromJson.
static DynamicJsonDocument gRulesDoc(32768);

static JsonArray rulesArray() {
  return gRulesDoc["rules"].as<JsonArray>();
}

// ── Bit / curve primitives ──────────────────────────────────────────────

uint32_t extractBits(const uint8_t* payload, size_t plen, uint8_t byteOffset,
                     uint8_t bitStart, uint8_t bitCount) {
  if (!payload || byteOffset >= plen || bitCount == 0 || bitCount > 32 || bitStart > 7) return 0;
  uint8_t byte = payload[byteOffset];
  uint8_t avail = (uint8_t)(8 - bitStart);
  if (bitCount > avail) bitCount = avail;
  uint32_t mask = (bitCount == 32) ? 0xFFFFFFFFu : ((1u << bitCount) - 1u);
  return (uint32_t)((byte >> bitStart) & mask);
}

float applyCurve(uint32_t rawValue, uint32_t inMin, uint32_t inMax,
                 float outMin, float outMax, CurveType type, float exponent) {
  if (inMax == inMin) return outMin;
  uint32_t v = rawValue;
  if (v < inMin) v = inMin;
  if (v > inMax) v = inMax;
  float t = (float)(v - inMin) / (float)(inMax - inMin);
  if (type == CurveType::EXPONENTIAL) {
    if (exponent <= 0.0f) exponent = 2.0f;
    t = powf(t, exponent);
  }
  return outMin + t * (outMax - outMin);
}

// ── Condition matching ──────────────────────────────────────────────────

static int hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static bool matchHexPrefix(const uint8_t* payload, size_t plen, const char* hex) {
  if (!hex || !payload) return false;
  size_t hexLen = strlen(hex);
  if (hexLen == 0 || (hexLen & 1)) return false;
  size_t need = hexLen / 2;
  if (need > plen) return false;
  for (size_t i = 0; i < need; i++) {
    int hi = hexNibble(hex[i * 2]);
    int lo = hexNibble(hex[i * 2 + 1]);
    if (hi < 0 || lo < 0) return false;
    if (payload[i] != (uint8_t)((hi << 4) | lo)) return false;
  }
  return true;
}

static bool compareOp(uint32_t lhs, const char* op, uint32_t rhs) {
  if (!op) return false;
  if (strcmp(op, "eq") == 0)  return lhs == rhs;
  if (strcmp(op, "gt") == 0)  return lhs > rhs;
  if (strcmp(op, "gte") == 0) return lhs >= rhs;
  if (strcmp(op, "lt") == 0)  return lhs < rhs;
  if (strcmp(op, "lte") == 0)  return lhs <= rhs;
  return false;
}

static bool evaluateLeaf(const uint8_t* payload, size_t plen, const JsonObject& leaf) {
  const char* type = leaf["type"] | "";
  if (strcmp(type, "hexPrefix") == 0) {
    return matchHexPrefix(payload, plen, leaf["value"] | "");
  }
  if (strcmp(type, "length") == 0) {
    return compareOp((uint32_t)plen, leaf["op"] | "eq", (uint32_t)(leaf["value"] | 0));
  }
  if (strcmp(type, "byte") == 0) {
    uint8_t offset = (uint8_t)(leaf["offset"] | 0);
    const char* op = leaf["op"] | "eq";
    if (strcmp(op, "maskEq") == 0) {
      if (offset >= plen) return false;
      uint8_t mask = (uint8_t)(leaf["mask"] | 0xFF);
      uint8_t want = (uint8_t)(leaf["value"] | 0);
      return (uint8_t)(payload[offset] & mask) == want;
    }
    // Whole-byte convenience → extractBits path
    uint32_t v = extractBits(payload, plen, offset, 0, 8);
    return compareOp(v, op, (uint32_t)(leaf["value"] | 0));
  }
  if (strcmp(type, "bits") == 0) {
    uint8_t offset = (uint8_t)(leaf["offset"] | 0);
    uint8_t bitStart = (uint8_t)(leaf["bitStart"] | 0);
    uint8_t bitCount = (uint8_t)(leaf["bitCount"] | 1);
    uint32_t v = extractBits(payload, plen, offset, bitStart, bitCount);
    return compareOp(v, leaf["op"] | "eq", (uint32_t)(leaf["value"] | 0));
  }
  return false;
}

bool evaluateConditionGroup(const uint8_t* payload, size_t plen, const JsonObject& groupNode) {
  if (groupNode.isNull()) return false;

  // Leaf nodes have "type"; groups have "mode" + "children"
  if (groupNode.containsKey("type")) {
    return evaluateLeaf(payload, plen, groupNode);
  }

  const char* mode = groupNode["mode"] | "all";
  JsonArray children = groupNode["children"].as<JsonArray>();
  if (children.isNull() || children.size() == 0) return false;

  bool isAll = (strcmp(mode, "all") == 0);
  for (JsonVariant v : children) {
    if (!v.is<JsonObject>()) continue;
    bool ok = evaluateConditionGroup(payload, plen, v.as<JsonObject>());
    if (isAll && !ok) return false;
    if (!isAll && ok) return true;
  }
  return isAll;
}

int findMatchingRule(const uint8_t* payload, size_t plen, const JsonArray& rules) {
  if (!payload || plen == 0 || rules.isNull()) return -1;

  // Collect enabled rule indices sorted by priority (lower first), then array order.
  const int MAX_RULES = 64;
  int idxs[MAX_RULES];
  int prios[MAX_RULES];
  int n = 0;
  int i = 0;
  for (JsonVariant v : rules) {
    if (n >= MAX_RULES) break;
    if (!v.is<JsonObject>()) { i++; continue; }
    JsonObject rule = v.as<JsonObject>();
    if (!(rule["enabled"] | true)) { i++; continue; }
    idxs[n] = i;
    prios[n] = rule["priority"] | 100;
    n++;
    i++;
  }
  for (int a = 0; a < n; a++) {
    for (int b = a + 1; b < n; b++) {
      if (prios[b] < prios[a] || (prios[b] == prios[a] && idxs[b] < idxs[a])) {
        int tp = prios[a]; prios[a] = prios[b]; prios[b] = tp;
        int ti = idxs[a]; idxs[a] = idxs[b]; idxs[b] = ti;
      }
    }
  }
  for (int k = 0; k < n; k++) {
    JsonObject rule = rules[idxs[k]].as<JsonObject>();
    JsonObject match = rule["match"].as<JsonObject>();
    if (match.isNull()) continue;
    if (evaluateConditionGroup(payload, plen, match)) return idxs[k];
  }
  return -1;
}

// ── Apply matched rule ──────────────────────────────────────────────────

static bool looksLikeWand(const uint8_t* payload, size_t plen) {
  if (!payload || plen < 6) return false;
  if (memcmp(payload, WAND_CAST_SIG, 6) == 0) return true;
  if (plen >= 2 && payload[0] == 0xCF && payload[1] == 0x9B) return true;
  return false;
}

static void setWledNumericField(JsonObject wled, const char* field, float value) {
  if (!field || !field[0]) return;
  int iv = (int)lroundf(value);
  if (iv < 0) iv = 0;
  if (iv > 255 && (strcmp(field, "fx") != 0 && strcmp(field, "pal") != 0 &&
                   strcmp(field, "transition") != 0)) {
    iv = 255;
  }
  // Prefer writing onto every live segment; also set top-level for convenience.
  wled[field] = iv;
  JsonArray segs = wled["seg"].as<JsonArray>();
  if (!segs.isNull()) {
    for (JsonObject seg : segs) {
      int stop = seg["stop"] | 0;
      if (stop <= 0) continue;
      seg[field] = iv;
    }
  }
}

static void setSegmentColor(JsonObject wled, const char* segKey, uint8_t r, uint8_t g, uint8_t b) {
  int si = mbSegKeyIndex(segKey);
  if (si < 0) return;
  MbSegMap& map = activeMbSegMap(si);
  if (map.count == 0) return;

  JsonArray segs = wled["seg"].as<JsonArray>();
  if (segs.isNull()) segs = wled.createNestedArray("seg");

  for (uint8_t i = 0; i < map.count; i++) {
    const WledSegRef& ref = map.refs[i];
    JsonObject target;
    bool found = false;
    for (JsonObject seg : segs) {
      if ((int)(seg["id"] | -1) == (int)ref.id) {
        target = seg;
        found = true;
        break;
      }
    }
    if (!found) {
      target = segs.createNestedObject();
      target["id"] = ref.id;
      target["start"] = ref.start;
      target["stop"] = ref.stop;
      target["grp"] = ref.grp;
      target["fx"] = 0;
    }
    target["on"] = true;
    target["pal"] = WLED_PAL_COLORS_ONLY;
    JsonArray col = target["col"].to<JsonArray>();
    col.clear();
    JsonArray rgb = col.createNestedArray();
    rgb.add(r); rgb.add(g); rgb.add(b);
  }
}

void applyMatchedRule(const JsonObject& rule, const uint8_t* payload, size_t plen) {
  if (!payload || plen == 0) return;

  bool wand = looksLikeWand(payload, plen);
  if (wand) {
    if (currentOverride == BLE_MAGIC) return;  // hard lockout
    if (!starlightEnabled) {
      bleNotify("{\"type\":\"sw_event\",\"event\":\"disabled\"}");
      return;
    }
  } else {
    if (!magicBandEnabled) return;
  }

  OverrideSource src = wand ? BLE_STARLIGHT : BLE_MAGIC;
  if (!canTakeOverride(src)) {
    if (wand) bleNotify("{\"type\":\"sw_event\",\"event\":\"blocked\"}");
    return;
  }

  // Optional layout override by name
  const char* layoutId = rule["segmentLayoutId"] | "";
  uint8_t savedLayout = mbActiveLayoutIdx;
  bool switchedLayout = false;
  if (layoutId && layoutId[0]) {
    for (uint8_t i = 0; i < mbLayoutCount; i++) {
      if (strcmp(mbLayouts[i].name, layoutId) == 0) {
        mbActiveLayoutIdx = i;
        switchedLayout = true;
        break;
      }
    }
  }

  JsonArray extracts = rule["extract"].as<JsonArray>();
  String presetId = rule["presetId"] | "";

  // Collect color extracts for multi-segment solid path when no preset
  const char* colorKeys[16];
  uint8_t colorPals[16];
  uint8_t colorRgb[16][3];
  bool colorHasRgb[16];
  int colorCount = 0;
  bool hasWledField = false;

  struct FieldWrite { const char* field; float value; };
  FieldWrite fields[16];
  int fieldCount = 0;

  if (!extracts.isNull()) {
    for (JsonVariant ev : extracts) {
      if (!ev.is<JsonObject>() || colorCount >= 16) continue;
      JsonObject ex = ev.as<JsonObject>();
      uint8_t offset = (uint8_t)(ex["offset"] | 0);
      uint8_t bitStart = (uint8_t)(ex["bitStart"] | 0);
      uint8_t bitCount = (uint8_t)(ex["bitCount"] | 8);
      uint32_t raw = extractBits(payload, plen, offset, bitStart, bitCount);

      JsonObject target = ex["target"].as<JsonObject>();
      const char* kind = target["kind"] | "";

      bool paletteMap = ex["paletteMap"] | false;
      uint8_t r = 0, g = 0, b = 0;
      float mapped = (float)raw;

      if (paletteMap) {
        uint8_t pal = (uint8_t)(raw & 0x1F);
        paletteToRGB(pal, r, g, b);
        mapped = (float)pal;
      } else if (ex.containsKey("curve")) {
        JsonObject curve = ex["curve"].as<JsonObject>();
        const char* ctype = curve["type"] | "linear";
        CurveType ct = (strcmp(ctype, "exponential") == 0) ? CurveType::EXPONENTIAL : CurveType::LINEAR;
        float expv = curve["exponent"] | 2.0f;
        mapped = applyCurve(raw,
                            (uint32_t)(curve["inMin"] | 0),
                            (uint32_t)(curve["inMax"] | 15),
                            (float)(curve["outMin"] | 0),
                            (float)(curve["outMax"] | 255),
                            ct, expv);
      }

      if (strcmp(kind, "color") == 0) {
        const char* seg = target["segment"] | "all";
        colorKeys[colorCount] = seg;
        if (paletteMap) {
          colorHasRgb[colorCount] = true;
          colorRgb[colorCount][0] = r;
          colorRgb[colorCount][1] = g;
          colorRgb[colorCount][2] = b;
          colorPals[colorCount] = (uint8_t)(raw & 0x1F);
        } else {
          colorHasRgb[colorCount] = false;
          colorPals[colorCount] = (uint8_t)((uint32_t)lroundf(mapped) & 0x1F);
        }
        colorCount++;
      } else if (strcmp(kind, "wledField") == 0) {
        hasWledField = true;
        if (fieldCount < 16) {
          fields[fieldCount].field = target["field"] | "";
          fields[fieldCount].value = mapped;
          fieldCount++;
        }
      }
    }
  }

  // No preset + only colors → multi-segment solid (reuse existing helper)
  if (presetId.length() == 0 && !hasWledField && colorCount > 0) {
    saveWledStateForOverride();
    // Build via RGB-aware path: applyMbMultiSegmentSolid uses palette indices
    applyMbMultiSegmentSolid(colorKeys, colorPals, colorCount, src);
    if (switchedLayout) mbActiveLayoutIdx = savedLayout;
    bleNotify(wand
      ? "{\"type\":\"sw_event\",\"event\":\"rule\"}"
      : "{\"type\":\"ble_event\",\"event\":\"rule\"}");
    return;
  }

  if (presetId.length() == 0 && colorCount == 0 && !hasWledField) {
    // Nothing to apply
    if (switchedLayout) mbActiveLayoutIdx = savedLayout;
    return;
  }

  saveWledStateForOverride();
  DynamicJsonDocument wled(12288);
  bool haveWled = false;

  if (presetId.length() > 0) {
    String preset = getPreset(presetId);
    if (preset.length() > 0) {
      DynamicJsonDocument pdoc(12288);
      if (!deserializeJson(pdoc, preset) && pdoc.containsKey("wled")) {
        String wledStr;
        serializeJson(pdoc["wled"], wledStr);
        if (!deserializeJson(wled, wledStr)) {
          haveWled = true;
          currentPresetId = presetId;
        }
      }
    }
  }
  if (!haveWled) {
    wled["on"] = true;
    JsonArray segs = wled.createNestedArray("seg");
    JsonObject seg0 = segs.createNestedObject();
    seg0["id"] = 0;
    seg0["start"] = 0;
    seg0["stop"] = STRIP_LED_COUNT;
    seg0["fx"] = 0;
    haveWled = true;
  }

  for (int i = 0; i < colorCount; i++) {
    uint8_t r, g, b;
    if (colorHasRgb[i]) {
      r = colorRgb[i][0]; g = colorRgb[i][1]; b = colorRgb[i][2];
    } else {
      paletteToRGB(colorPals[i], r, g, b);
    }
    setSegmentColor(wled.as<JsonObject>(), colorKeys[i], r, g, b);
  }
  for (int i = 0; i < fieldCount; i++) {
    setWledNumericField(wled.as<JsonObject>(), fields[i].field, fields[i].value);
  }

  String wledJson;
  serializeJson(wled, wledJson);
  ensureWledPowerOn();
  disableAllSplitSegments();
  delay(80);
  String body = preparePresetApplyPayload(wledJson);
  bool ok = sendToWLED(injectWledTransition(body, bleEffectTransitionMs), 8000, 2);
  if (ok) {
    setOverride(src);
    touchOverrideIdleTimer(src);
    Serial.printf("[Rule] Applied preset=%s colors=%d fields=%d src=%d\n",
                  presetId.c_str(), colorCount, fieldCount, (int)src);
    if (wand && colorCount > 0) {
      uint8_t r = colorHasRgb[0] ? colorRgb[0][0] : 0;
      uint8_t g = colorHasRgb[0] ? colorRgb[0][1] : 0;
      uint8_t b = colorHasRgb[0] ? colorRgb[0][2] : 0;
      if (!colorHasRgb[0]) paletteToRGB(colorPals[0], r, g, b);
      bleNotify("{\"type\":\"sw_color\",\"palette\":" + String(colorPals[0]) +
                ",\"r\":" + String(r) + ",\"g\":" + String(g) + ",\"b\":" + String(b) + "}");
    } else {
      bleNotify("{\"type\":\"ble_event\",\"event\":\"rule\"}");
    }
  }

  if (switchedLayout) mbActiveLayoutIdx = savedLayout;
}

// ── Unmatched notify ────────────────────────────────────────────────────

void notifyMbUnmatched(const uint8_t* payload, size_t plen) {
  if (!mbUnmatchedLogEnabled || !bleConnected) return;
  bleNotify("{\"type\":\"mb_unmatched\",\"hex\":\"" + mfrToHexFull(payload, plen, 64) +
            "\",\"len\":" + String(plen) +
            ",\"ts\":" + String(millis()) + "}");
}

// ── Rules JSON load ─────────────────────────────────────────────────────

void applyMbRulesJson(JsonObject doc) {
  // Reuse colors / segments / randomPool / defaultPresetId via existing mapper
  applyMbMappingJson(doc);

  // Cache rules[] only when the payload includes them — colors-only / legacy
  // mb_mapping_config pushes from the phone must not wipe authoring done via set_mb_rules.
  if (doc.containsKey("rules")) {
    String raw;
    serializeJson(doc, raw);
    gRulesDoc.clear();
    if (deserializeJson(gRulesDoc, raw)) {
      Serial.println("[Rules] cache deserialize failed");
    }
  } else if (doc.containsKey("paradeDetection") || doc.containsKey("defaultPresetId") ||
             doc.containsKey("colors") || doc.containsKey("segments") || doc.containsKey("randomPool")) {
    // Merge non-rule fields into the cached doc without clearing rules
    if (doc.containsKey("paradeDetection")) {
      gRulesDoc["paradeDetection"] = doc["paradeDetection"];
    }
    if (doc.containsKey("defaultPresetId")) {
      gRulesDoc["defaultPresetId"] = doc["defaultPresetId"];
    }
  }

  // Persist parade detection settings
  paradeDetectEnabled = false;
  paradeBeaconPrefix[0] = '\0';
  paradeRssiThreshold = -70;
  paradeCooldownMs = 30000;

  if (doc.containsKey("paradeDetection")) {
    JsonObject pd = doc["paradeDetection"].as<JsonObject>();
    paradeDetectEnabled = pd["enabled"] | false;
    const char* prefix = pd["beaconOpcodeHexPrefix"] | "cd07";
    strncpy(paradeBeaconPrefix, prefix, sizeof(paradeBeaconPrefix) - 1);
    paradeBeaconPrefix[sizeof(paradeBeaconPrefix) - 1] = '\0';
    for (char* p = paradeBeaconPrefix; *p; p++) *p = (char)tolower((unsigned char)*p);
    paradeRssiThreshold = pd["rssiThreshold"] | -70;
    int cooldownSec = pd["cooldownSec"] | 30;
    if (cooldownSec < 1) cooldownSec = 1;
    paradeCooldownMs = (unsigned long)cooldownSec * 1000UL;
  } else if (gRulesDoc.containsKey("paradeDetection")) {
    JsonObject pd = gRulesDoc["paradeDetection"].as<JsonObject>();
    paradeDetectEnabled = pd["enabled"] | false;
    const char* prefix = pd["beaconOpcodeHexPrefix"] | "cd07";
    strncpy(paradeBeaconPrefix, prefix, sizeof(paradeBeaconPrefix) - 1);
    paradeBeaconPrefix[sizeof(paradeBeaconPrefix) - 1] = '\0';
    for (char* p = paradeBeaconPrefix; *p; p++) *p = (char)tolower((unsigned char)*p);
    paradeRssiThreshold = pd["rssiThreshold"] | -70;
    int cooldownSec = pd["cooldownSec"] | 30;
    if (cooldownSec < 1) cooldownSec = 1;
    paradeCooldownMs = (unsigned long)cooldownSec * 1000UL;
  }

  JsonArray rules = rulesArray();
  Serial.printf("[Rules] loaded rules=%u defaultPreset=%s parade=%d prefix=%s rssi>=%d cooldown=%lums\n",
                rules.isNull() ? 0u : (unsigned)rules.size(),
                bleDefaultPresetId.c_str(), paradeDetectEnabled ? 1 : 0,
                paradeBeaconPrefix, paradeRssiThreshold, paradeCooldownMs);
}

void loadMbRulesFromJson() {
  bleDefaultPresetId = "";
  const String& src = mbRulesJson.length() > 0 ? mbRulesJson : mbMappingJson;
  if (src.length() == 0) return;
  DynamicJsonDocument doc(32768);
  if (deserializeJson(doc, src)) {
    Serial.println("[Rules] JSON parse failed");
    return;
  }
  applyMbRulesJson(doc.as<JsonObject>());
}

// Public accessor used by DisneyPayloadHandlers
JsonArray mbRulesJsonArray() {
  return rulesArray();
}

// ── Parade detection ────────────────────────────────────────────────────

static bool hexPrefixMatchCI(const uint8_t* payload, size_t plen, const char* hex) {
  return matchHexPrefix(payload, plen, hex);
}

void checkParadeBeacon(const uint8_t* payload, size_t plen, int rssi) {
  if (!paradeDetectEnabled || !payload || plen == 0) return;
  if (paradeBeaconPrefix[0] == '\0') return;
  if (!hexPrefixMatchCI(payload, plen, paradeBeaconPrefix)) return;
  if (rssi < paradeRssiThreshold) return;

  paradeLastBeaconMs = millis();

  // Fresh crossing into parade: enter LIVE if not already in parade show
  if (showModeType != SHOW_PARADE || showModePhase == PHASE_NONE || showModePhase == PHASE_POST) {
    Serial.printf("[Parade] beacon match rssi=%d — start LIVE\n", rssi);
    if (currentOverride != SHOW_MODE && currentOverride != BLE_MAGIC && currentOverride != BLE_STARLIGHT) {
      saveWledStateForOverride();
    }
    showModeType = SHOW_PARADE;
    showModePhase = PHASE_LIVE;
    setOverride(SHOW_MODE);
    applyShowPhaseLook(SHOW_PARADE, PHASE_LIVE, bleEffectTransitionMs);
    bleNotify("{\"type\":\"ble_event\",\"event\":\"parade_start\"}");
  }
}

void serviceParadeCooldown() {
  if (!paradeDetectEnabled) return;
  if (showModeType != SHOW_PARADE) return;
  if (showModePhase != PHASE_LIVE && showModePhase != PHASE_PRE) return;
  if (paradeLastBeaconMs == 0) return;
  if (millis() - paradeLastBeaconMs < paradeCooldownMs) return;

  Serial.println("[Parade] beacon cooldown — end");
  showModePhase = PHASE_NONE;
  showModeType = SHOW_NONE;
  if (currentOverride == SHOW_MODE) clearOverride();
  paradeLastBeaconMs = 0;
  bleNotify("{\"type\":\"ble_event\",\"event\":\"parade_end\"}");
}

void manualParadeStart() {
  paradeLastBeaconMs = millis();
  showModeType = SHOW_PARADE;
  showModePhase = PHASE_LIVE;
  if (currentOverride != SHOW_MODE) {
    saveWledStateForOverride();
    setOverride(SHOW_MODE);
  }
  applyShowPhaseLook(SHOW_PARADE, PHASE_LIVE, bleEffectTransitionMs);
  bleNotify("{\"type\":\"ble_event\",\"event\":\"parade_start\"}");
}

void manualParadeStop() {
  showModePhase = PHASE_NONE;
  showModeType = SHOW_NONE;
  paradeLastBeaconMs = 0;  // next qualifying beacon can re-trigger
  if (currentOverride == SHOW_MODE) clearOverride();
  bleNotify("{\"type\":\"ble_event\",\"event\":\"parade_end\"}");
}
