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

// Lab-confirmed timing-byte decode (docs/ble-packets-details/timing-byte.md).
// bit7 is a misnamed "always-on" — it is extended timeout (7.6×t), not indefinite hold.
struct TimingDecode {
  unsigned long onTimeMs;
  unsigned long fadeMs;
  bool extended;
};

static TimingDecode decodeTimingByte(uint8_t b) {
  uint8_t t = b & 0x0F;
  bool scaler = (b >> 6) & 1;
  bool extended = (b >> 7) & 1;
  uint8_t fadeBits = (b >> 4) & 0x03;
  float onSec;
  if (extended) {
    // Unconfirmed for t=0 under extended; use same 3s fallback as scaler=0.
    onSec = (t == 0) ? MB_TIMING_T0_FALLBACK_SEC : (MB_TIMING_MULT_EXTENDED * (float)t);
  } else if (scaler) {
    onSec = (t == 0) ? MB_TIMING_T0_FALLBACK_SEC : (MB_TIMING_MULT_SCALER * (float)t);
  } else {
    onSec = (t == 0) ? MB_TIMING_T0_FALLBACK_SEC : (MB_TIMING_MULT_NORMAL * (float)t);
  }
  TimingDecode out;
  out.onTimeMs = (unsigned long)(onSec * 1000.0f + 0.5f);
  out.fadeMs = (unsigned long)fadeBits * MB_TIMING_FADE_STEP_MS;
  out.extended = extended;
  return out;
}

static JsonObject findSegmentMapById(const char* mapId) {
  JsonObject empty;
  if (!mapId || !mapId[0]) return empty;
  JsonArray maps = gRulesDoc["segmentMaps"].as<JsonArray>();
  if (maps.isNull()) return empty;
  for (JsonVariant v : maps) {
    if (!v.is<JsonObject>()) continue;
    JsonObject m = v.as<JsonObject>();
    if (strcmp(m["id"] | "", mapId) == 0) return m;
  }
  return empty;
}

static JsonObject findSegInMap(JsonObject segMap, const char* segmentId) {
  JsonObject empty;
  if (segMap.isNull() || !segmentId) return empty;
  JsonArray segs = segMap["segments"].as<JsonArray>();
  if (segs.isNull()) return empty;
  for (JsonVariant v : segs) {
    if (!v.is<JsonObject>()) continue;
    JsonObject s = v.as<JsonObject>();
    if (strcmp(s["id"] | "", segmentId) == 0) return s;
  }
  return empty;
}

static JsonObject ensureWledSegByLocalId(JsonObject wled, JsonObject segDef) {
  JsonArray segs = wled["seg"].as<JsonArray>();
  if (segs.isNull()) segs = wled.createNestedArray("seg");
  int wledId = segDef["wledSegId"] | segDef["id"] | 0;
  for (JsonObject seg : segs) {
    if ((int)(seg["id"] | -1) == wledId) return seg;
  }
  JsonObject seg = segs.createNestedObject();
  seg["id"] = wledId;
  seg["start"] = segDef["start"] | 0;
  seg["stop"] = segDef["stop"] | STRIP_LED_COUNT;
  seg["grp"] = segDef["grp"] | 1;
  seg["spc"] = segDef["spc"] | 0;
  seg["of"] = segDef["of"] | 0;
  seg["rev"] = segDef["rev"] | false;
  seg["mi"] = segDef["mi"] | false;
  seg["on"] = true;
  int fx = segDef["fx"] | -1;
  if (fx >= 0) seg["fx"] = fx;
  else seg["fx"] = 0;
  if (segDef.containsKey("sx")) seg["sx"] = segDef["sx"];
  if (segDef.containsKey("ix")) seg["ix"] = segDef["ix"];
  int pal = segDef["pal"] | -1;
  if (pal >= 0) seg["pal"] = pal;
  return seg;
}

static void applyPresetVariables(JsonObject segObj, JsonObject presetVariables) {
  if (presetVariables.isNull()) return;
  for (JsonPair kv : presetVariables) {
    const char* key = kv.key().c_str();
    if (!key || !key[0]) continue;
    JsonVariant val = kv.value();
    if (val.is<bool>()) segObj[key] = val.as<bool>();
    else if (val.is<float>() || val.is<double>()) segObj[key] = val.as<float>();
    else if (val.is<int>() || val.is<long>()) segObj[key] = val.as<long>();
    else if (val.is<const char*>()) segObj[key] = val.as<const char*>();
    else segObj[key] = val;
  }
}

static void setSegColorSlot(JsonObject segObj, int colorSlot, uint8_t r, uint8_t g, uint8_t b) {
  if (colorSlot < 0) colorSlot = 0;
  if (colorSlot > 2) colorSlot = 2;
  segObj["pal"] = WLED_PAL_COLORS_ONLY;
  JsonArray col = segObj["col"].as<JsonArray>();
  if (col.isNull()) col = segObj.createNestedArray("col");
  while ((int)col.size() <= colorSlot) {
    JsonArray rgb = col.createNestedArray();
    rgb.add(0); rgb.add(0); rgb.add(0);
  }
  JsonArray rgb = col[colorSlot].as<JsonArray>();
  if (!rgb.isNull() && rgb.size() >= 3) {
    rgb[0] = r; rgb[1] = g; rgb[2] = b;
  } else if (!rgb.isNull()) {
    rgb.clear();
    rgb.add(r); rgb.add(g); rgb.add(b);
  }
}

static void setSegNumericField(JsonObject segObj, const char* field, float value) {
  if (!field || !field[0]) return;
  int iv = (int)lroundf(value);
  if (iv < 0) iv = 0;
  if (iv > 255 && strcmp(field, "fx") != 0 && strcmp(field, "pal") != 0 &&
      strcmp(field, "transition") != 0) {
    iv = 255;
  }
  segObj[field] = iv;
}

static void parseHexColor(const char* hex, uint8_t& r, uint8_t& g, uint8_t& b) {
  r = g = b = 0;
  if (!hex || hex[0] != '#' || strlen(hex) < 7) return;
  auto nib = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return 0;
  };
  r = (uint8_t)((nib(hex[1]) << 4) | nib(hex[2]));
  g = (uint8_t)((nib(hex[3]) << 4) | nib(hex[4]));
  b = (uint8_t)((nib(hex[5]) << 4) | nib(hex[6]));
}

static void seedWledFromSegmentMap(JsonObject wled, JsonObject segMap) {
  wled["on"] = true;
  JsonArray segs = wled.createNestedArray("seg");
  JsonArray defs = segMap["segments"].as<JsonArray>();
  if (defs.isNull()) return;
  for (JsonVariant v : defs) {
    if (!v.is<JsonObject>()) continue;
    JsonObject def = v.as<JsonObject>();
    JsonObject seg = segs.createNestedObject();
    seg["id"] = def["wledSegId"] | 0;
    seg["start"] = def["start"] | 0;
    seg["stop"] = def["stop"] | STRIP_LED_COUNT;
    seg["grp"] = def["grp"] | 1;
    seg["spc"] = def["spc"] | 0;
    seg["of"] = def["of"] | 0;
    seg["rev"] = def["rev"] | false;
    seg["mi"] = def["mi"] | false;
    seg["on"] = true;
    int fx = def["fx"] | -1;
    seg["fx"] = fx >= 0 ? fx : 0;
    if (def.containsKey("sx")) seg["sx"] = def["sx"];
    if (def.containsKey("ix")) seg["ix"] = def["ix"];
    int pal = def["pal"] | -1;
    if (pal >= 0) seg["pal"] = pal;

    // Static colors from map (empty string = untouched)
    JsonArray colors = def["colors"].as<JsonArray>();
    if (!colors.isNull()) {
      for (int i = 0; i < 3 && i < (int)colors.size(); i++) {
        const char* hex = colors[i] | "";
        if (!hex || !hex[0]) continue;
        uint8_t r, g, b;
        parseHexColor(hex, r, g, b);
        setSegColorSlot(seg, i, r, g, b);
      }
    }

    // Optional per-segment preset baseline
    const char* presetId = def["presetId"] | "";
    if (presetId && presetId[0]) {
      String preset = getPreset(presetId);
      if (preset.length() > 0) {
        DynamicJsonDocument pdoc(8192);
        if (!deserializeJson(pdoc, preset) && pdoc.containsKey("wled")) {
          JsonObject pw = pdoc["wled"].as<JsonObject>();
          JsonArray psegs = pw["seg"].as<JsonArray>();
          JsonObject srcSeg;
          if (!psegs.isNull() && psegs.size() > 0) srcSeg = psegs[0].as<JsonObject>();
          else srcSeg = pw;
          for (JsonPair kv : srcSeg) {
            const char* k = kv.key().c_str();
            if (strcmp(k, "id") == 0 || strcmp(k, "start") == 0 || strcmp(k, "stop") == 0) continue;
            seg[k] = kv.value();
          }
        }
      }
    }
    applyPresetVariables(seg, def["presetVariables"].as<JsonObject>());
  }
}

static void beginTimedRuleOnPhase(const JsonObject& rule, const uint8_t* payload, size_t plen) {
  JsonObject timing = rule["timing"].as<JsonObject>();
  if (timing.isNull() || !(timing["enabled"] | false)) {
    resetMbRuleLifecycle();
    return;
  }
  uint8_t offset = (uint8_t)(timing["offset"] | 5);
  uint8_t byte = (payload && offset < plen) ? payload[offset] : 0;
  TimingDecode td = decodeTimingByte(byte);
  int cooldownSec = timing["cooldownSec"] | 10;
  if (cooldownSec < 0) cooldownSec = 0;
  const char* mode = timing["cooldownResetMode"] | "onMatch";

  strncpy(mbActiveRuleId, rule["id"] | "", MB_RULE_ID_LEN - 1);
  mbActiveRuleId[MB_RULE_ID_LEN - 1] = '\0';
  mbActiveRuleCooldownMode =
    (strcmp(mode, "fixed") == 0) ? MB_COOLDOWN_FIXED : MB_COOLDOWN_ON_MATCH;
  mbRuleFadeMs = td.fadeMs;
  mbRuleCooldownMs = (unsigned long)cooldownSec * 1000UL;
  mbRulePhase = MB_RULE_ON;
  mbRulePhaseDeadlineMs = millis() + td.onTimeMs;
  Serial.printf("[Rule] timing ON %lums fade=%lums cooldown=%lums mode=%s byte=0x%02X\n",
                td.onTimeMs, mbRuleFadeMs, mbRuleCooldownMs,
                mbActiveRuleCooldownMode == MB_COOLDOWN_FIXED ? "fixed" : "onMatch", byte);
}

void resetMbRuleLifecycle() {
  mbRulePhase = MB_RULE_IDLE;
  mbRulePhaseDeadlineMs = 0;
  mbRuleFadeMs = 0;
  mbRuleCooldownMs = 10000;
  mbActiveRuleCooldownMode = MB_COOLDOWN_ON_MATCH;
  mbActiveRuleId[0] = '\0';
}

void serviceMbRuleLifecycle() {
  if (mbRulePhase == MB_RULE_IDLE) return;
  if (currentOverride != BLE_MAGIC) {
    resetMbRuleLifecycle();
    return;
  }
  if ((long)(millis() - mbRulePhaseDeadlineMs) < 0) return;

  if (mbRulePhase == MB_RULE_ON) {
    Serial.printf("[Rule] ON→FADE fadeMs=%lu\n", mbRuleFadeMs);
    sendToWLED(injectWledTransition("{\"on\":false}", mbRuleFadeMs));
    mbRulePhase = MB_RULE_FADE;
    mbRulePhaseDeadlineMs = millis() + (mbRuleFadeMs > 0 ? mbRuleFadeMs : 1);
    return;
  }
  if (mbRulePhase == MB_RULE_FADE) {
    Serial.printf("[Rule] FADE→COOLDOWN cooldownMs=%lu\n", mbRuleCooldownMs);
    mbRulePhase = MB_RULE_COOLDOWN;
    mbRulePhaseDeadlineMs = millis() + (mbRuleCooldownMs > 0 ? mbRuleCooldownMs : 1);
    return;
  }
  if (mbRulePhase == MB_RULE_COOLDOWN) {
    Serial.println("[Rule] COOLDOWN→restore");
    // Already black from FADE — restore without a second dip-to-black.
    unsigned long savedFade = bleEffectTransitionMs;
    bleEffectTransitionMs = 0;
    resetMbRuleLifecycle();
    clearOverride();
    bleEffectTransitionMs = savedFade;
    bleNotify("{\"type\":\"ble_event\",\"event\":\"rule_timeout\"}");
  }
}

void onTimedRuleRepeatMatch(const JsonObject& rule, const uint8_t* payload, size_t plen) {
  (void)payload; (void)plen;
  const char* ruleId = rule["id"] | "";
  if (!ruleId[0] || strcmp(mbActiveRuleId, ruleId) != 0) return;
  if (mbRulePhase == MB_RULE_COOLDOWN && mbActiveRuleCooldownMode == MB_COOLDOWN_FIXED) {
    // Fixed cooldown: acknowledge only — do not mutate deadline.
    return;
  }
  // ON / FADE / onMatch-COOLDOWN: re-enter ON with fresh timing (caller re-applies visuals).
  beginTimedRuleOnPhase(rule, payload, plen);
}

void applyMatchedRule(const JsonObject& rule, const uint8_t* payload, size_t plen) {
  if (!payload || plen == 0) return;

  bool wand = looksLikeWand(payload, plen);
  if (wand) {
    if (currentOverride == BLE_MAGIC) return;
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

  JsonObject timing = rule["timing"].as<JsonObject>();
  bool timingEn = !timing.isNull() && (timing["enabled"] | false);
  const char* ruleId = rule["id"] | "";

  // Same timed rule mid-lifecycle: fixed cooldown = no re-apply; else reset ON after apply.
  if (timingEn && mbRulePhase != MB_RULE_IDLE && ruleId[0] &&
      strcmp(mbActiveRuleId, ruleId) == 0) {
    if (mbRulePhase == MB_RULE_COOLDOWN && mbActiveRuleCooldownMode == MB_COOLDOWN_FIXED) {
      return;
    }
  }

  const char* mapId = rule["segmentMapId"] | "";
  JsonObject segMap = findSegmentMapById(mapId);

  String presetId = rule["presetId"] | "";
  JsonArray extracts = rule["extract"].as<JsonArray>();

  // startTransition
  unsigned long startTransMs = bleEffectTransitionMs;
  JsonObject startTr = rule["startTransition"].as<JsonObject>();
  if (!startTr.isNull()) {
    const char* ttype = startTr["type"] | "fade";
    if (strcmp(ttype, "instant") == 0) startTransMs = 0;
    else if (startTr.containsKey("timeMs")) startTransMs = (unsigned long)(startTr["timeMs"] | 0);
  }

  saveWledStateForOverride();
  DynamicJsonDocument wled(16384);
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

  if (!segMap.isNull()) {
    if (!haveWled) {
      seedWledFromSegmentMap(wled.as<JsonObject>(), segMap);
      haveWled = true;
    } else {
      // Ensure geometry segments from map exist so extract targets can resolve.
      JsonArray defs = segMap["segments"].as<JsonArray>();
      if (!defs.isNull()) {
        for (JsonVariant v : defs) {
          if (!v.is<JsonObject>()) continue;
          ensureWledSegByLocalId(wled.as<JsonObject>(), v.as<JsonObject>());
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

  // Extract → fan-out targets
  if (!extracts.isNull()) {
    for (JsonVariant ev : extracts) {
      if (!ev.is<JsonObject>()) continue;
      JsonObject ex = ev.as<JsonObject>();
      uint8_t offset = (uint8_t)(ex["offset"] | 0);
      uint8_t bitStart = (uint8_t)(ex["bitStart"] | 0);
      uint8_t bitCount = (uint8_t)(ex["bitCount"] | 8);
      uint32_t raw = extractBits(payload, plen, offset, bitStart, bitCount);

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
        uint8_t pal = (uint8_t)((uint32_t)lroundf(mapped) & 0x1F);
        paletteToRGB(pal, r, g, b);
      } else {
        uint8_t pal = (uint8_t)(raw & 0x1F);
        paletteToRGB(pal, r, g, b);
      }

      JsonArray targets = ex["targets"].as<JsonArray>();

      auto applyMaskColor = [&](const char* mask) {
        if (!mask || !mask[0]) mask = "all";
        if (!segMap.isNull()) {
          JsonArray defs = segMap["segments"].as<JsonArray>();
          if (!defs.isNull()) {
            for (JsonVariant v : defs) {
              if (!v.is<JsonObject>()) continue;
              JsonObject def = v.as<JsonObject>();
              const char* assign = def["maskAssignment"] | "";
              if (strcmp(assign, "ignore") == 0) continue;
              if (strcmp(assign, mask) != 0) continue;
              JsonObject segObj = ensureWledSegByLocalId(wled.as<JsonObject>(), def);
              setSegColorSlot(segObj, 0, r, g, b);
            }
          }
          return;
        }
        int si = mbSegKeyIndex(mask);
        if (si < 0) return;
        MbSegMap& map = activeMbSegMap(si);
        JsonArray segs = wled["seg"].as<JsonArray>();
        if (segs.isNull()) segs = wled.createNestedArray("seg");
        for (uint8_t i = 0; i < map.count; i++) {
          JsonObject segObj;
          bool found = false;
          for (JsonObject s : segs) {
            if ((int)(s["id"] | -1) == (int)map.refs[i].id) { segObj = s; found = true; break; }
          }
          if (!found) {
            segObj = segs.createNestedObject();
            segObj["id"] = map.refs[i].id;
            segObj["start"] = map.refs[i].start;
            segObj["stop"] = map.refs[i].stop;
            segObj["fx"] = 0;
            segObj["on"] = true;
          }
          setSegColorSlot(segObj, 0, r, g, b);
        }
      };

      auto dispatchTarget = [&](JsonObject tgt) {
        const char* kind = tgt["kind"] | "";
        if (strcmp(kind, "ignore") == 0 || !kind[0]) return;

        if (strcmp(kind, "segmentColor") == 0) {
          const char* segId = tgt["segmentId"] | "";
          int slot = tgt["colorSlot"] | 0;
          JsonObject def = findSegInMap(segMap, segId);
          if (def.isNull()) return;
          JsonObject segObj = ensureWledSegByLocalId(wled.as<JsonObject>(), def);
          setSegColorSlot(segObj, slot, r, g, b);
          return;
        }
        if (strcmp(kind, "maskColor") == 0) {
          applyMaskColor(tgt["mask"] | "all");
          return;
        }
        if (strcmp(kind, "segmentField") == 0) {
          const char* segId = tgt["segmentId"] | "";
          const char* field = tgt["field"] | "";
          JsonObject def = findSegInMap(segMap, segId);
          if (def.isNull()) return;
          JsonObject segObj = ensureWledSegByLocalId(wled.as<JsonObject>(), def);
          setSegNumericField(segObj, field, mapped);
          return;
        }
        if (strcmp(kind, "color") == 0) {
          applyMaskColor(tgt["segment"] | "all");
          return;
        }
        if (strcmp(kind, "wledField") == 0) {
          const char* field = tgt["field"] | "";
          JsonArray segs = wled["seg"].as<JsonArray>();
          if (!segs.isNull()) {
            for (JsonObject seg : segs) setSegNumericField(seg, field, mapped);
          }
          wled[field] = (int)lroundf(mapped);
        }
      };

      if (!targets.isNull() && targets.size() > 0) {
        for (JsonVariant tv : targets) {
          if (tv.is<JsonObject>()) dispatchTarget(tv.as<JsonObject>());
        }
      } else if (ex.containsKey("target") && ex["target"].is<JsonObject>()) {
        dispatchTarget(ex["target"].as<JsonObject>());
      }
    }
  }

  String wledJson;
  serializeJson(wled, wledJson);
  ensureWledPowerOn();
  disableAllSplitSegments();
  delay(80);
  String body = preparePresetApplyPayload(wledJson);
  bool ok = sendToWLED(injectWledTransition(body, startTransMs), 8000, 2);
  if (!ok) {
    Serial.println("[Rule] WLED apply failed");
    return;
  }

  setOverride(src);
  if (timingEn && src == BLE_MAGIC) {
    beginTimedRuleOnPhase(rule, payload, plen);
  } else {
    resetMbRuleLifecycle();
    touchOverrideIdleTimer(src);
  }

  Serial.printf("[Rule] Applied preset=%s map=%s src=%d\n",
                presetId.c_str(), mapId, (int)src);
  bleNotify(wand
    ? "{\"type\":\"sw_event\",\"event\":\"rule\"}"
    : "{\"type\":\"ble_event\",\"event\":\"rule\"}");
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

  // Cache rules[] / segmentMaps[] when either is present — colors-only pushes must not wipe them.
  if (doc.containsKey("rules") || doc.containsKey("segmentMaps")) {
    String raw;
    serializeJson(doc, raw);
    // If only segmentMaps arrived without rules, merge onto existing cache
    if (!doc.containsKey("rules") && gRulesDoc.containsKey("rules")) {
      DynamicJsonDocument merged(32768);
      String existing;
      serializeJson(gRulesDoc, existing);
      if (!deserializeJson(merged, existing)) {
        merged["segmentMaps"] = doc["segmentMaps"];
        if (doc.containsKey("paradeDetection")) merged["paradeDetection"] = doc["paradeDetection"];
        if (doc.containsKey("defaultPresetId")) merged["defaultPresetId"] = doc["defaultPresetId"];
        gRulesDoc.clear();
        serializeJson(merged, raw);
        deserializeJson(gRulesDoc, raw);
      } else {
        gRulesDoc.clear();
        deserializeJson(gRulesDoc, raw);
      }
    } else {
      gRulesDoc.clear();
      if (deserializeJson(gRulesDoc, raw)) {
        Serial.println("[Rules] cache deserialize failed");
      }
    }
  } else if (doc.containsKey("paradeDetection") || doc.containsKey("defaultPresetId") ||
             doc.containsKey("colors") || doc.containsKey("segments") || doc.containsKey("randomPool")) {
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
  JsonArray maps = gRulesDoc["segmentMaps"].as<JsonArray>();
  Serial.printf("[Rules] loaded rules=%u maps=%u defaultPreset=%s parade=%d prefix=%s rssi>=%d cooldown=%lums\n",
                rules.isNull() ? 0u : (unsigned)rules.size(),
                maps.isNull() ? 0u : (unsigned)maps.size(),
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

JsonArray mbSegmentMapsArray() {
  return gRulesDoc["segmentMaps"].as<JsonArray>();
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
