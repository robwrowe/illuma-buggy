#include "MbRuleEngine.h"
#include "Globals.h"
#include "ColorPalette.h"
#include "MbMapping.h"
#include "MbPacketDecode.h"
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

/** Apply per-channel LUT to raw BLE RGB (not palette-indexed colors). */
static inline void applyMbRgbCalibration(uint8_t& r, uint8_t& g, uint8_t& b) {
  if (!mbCalibrationEnabled) return;
  r = mbCalCurveR[r];
  g = mbCalCurveG[g];
  b = mbCalCurveB[b];
}

static void parseHexColor(const char* hex, uint8_t& r, uint8_t& g, uint8_t& b);

// Cached rules document — refreshed by applyMbRulesJson / loadMbRulesFromJson.
static DynamicJsonDocument gRulesDoc(BLE_JSON_DOC_SIZE);

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

float applyCurve(float rawValue, float inMin, float inMax,
                 float outMin, float outMax, CurveType type, float exponent,
                 float outScale) {
  if (fabsf(inMax - inMin) < 1e-6f) return outMin;
  float v = rawValue;
  if (v < inMin) v = inMin;
  if (v > inMax) v = inMax;

  if (type == CurveType::RECIPROCAL) {
    // rawValue is a rate/frequency (e.g. Hz); inMin/inMax clamp it.
    // out = outMax - outScale/hz  (WLED Strobe: sx = 255 - 50/hz when outScale=50).
    float hz = v;
    if (hz <= 0.01f) return outMax;
    float scale = (outScale > 0.0f) ? outScale : 50.0f;
    float out = outMax - (scale / hz);
    if (out < outMin) out = outMin;
    if (out > outMax) out = outMax;
    return out;
  }

  float t = (v - inMin) / (inMax - inMin);
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
  bool isWandPkt = (plen >= 2 && payload && payload[0] == 0xCF &&
                    (payload[1] == 0x0B || payload[1] == 0x9B));
  if (isWandPkt) {
    Serial.printf("[RuleDbg] evaluateLeaf type=%s value=%s plen=%u p0=%02X p1=%02X\n",
                  type, leaf["value"] | "(none)", (unsigned)plen,
                  plen > 0 ? payload[0] : 0, plen > 1 ? payload[1] : 0);
  }
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
  bool isWandPkt = (plen >= 2 && payload && payload[0] == 0xCF &&
                    (payload[1] == 0x0B || payload[1] == 0x9B));
  if (isWandPkt) {
    Serial.printf("[RuleDbg] group mode=%s childCount=%u\n",
                  mode, children.isNull() ? 0u : (unsigned)children.size());
  }
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

  static unsigned long lastRuleDumpMs = 0;
  if (millis() - lastRuleDumpMs > 5000) {
    lastRuleDumpMs = millis();
    Serial.printf("[RuleDbg] findMatchingRule: %d enabled rules loaded\n", n);
    for (int k = 0; k < n; k++) {
      JsonObject r = rules[idxs[k]].as<JsonObject>();
      JsonObject m = r["match"].as<JsonObject>();
      Serial.printf("[RuleDbg]   idx=%d prio=%d name=%s hasMatch=%d mode=%s\n",
                    idxs[k], prios[k], r["name"] | "(no name)",
                    !m.isNull(), m["mode"] | "(leaf/none)");
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
// bit7 is a misnamed "always-on" — it is extended timeout, not indefinite hold.
// onTimeMs includes final-cycle stretch; stretchMs is the FTB duration for that last cycle
// (not a separate post-on fade phase).
struct TimingDecode {
  unsigned long onTimeMs;
  unsigned long stretchMs;
  bool extended;
  bool scaler;
};

static JsonObject findTimingModelById(const char* modelId) {
  JsonObject empty;
  if (!modelId || !modelId[0]) return empty;
  JsonArray models = gRulesDoc["timingModels"].as<JsonArray>();
  if (models.isNull()) return empty;
  for (JsonVariant v : models) {
    if (!v.is<JsonObject>()) continue;
    JsonObject m = v.as<JsonObject>();
    if (strcmp(m["id"] | "", modelId) == 0) return m;
  }
  return empty;
}

static TimingDecode decodeTimingByte(uint8_t b, JsonObject model) {
  uint8_t t = b & 0x0F;
  bool scaler = (b >> 6) & 1;
  bool extended = (b >> 7) & 1;
  uint8_t fadeBits = (b >> 4) & 0x03;
  float multNormal   = model.isNull() ? MB_TIMING_MULT_NORMAL
                                      : (float)(model["multNormal"] | MB_TIMING_MULT_NORMAL);
  float multScaler   = model.isNull() ? MB_TIMING_MULT_SCALER
                                      : (float)(model["multScaler"] | MB_TIMING_MULT_SCALER);
  float multExtended = model.isNull() ? MB_TIMING_MULT_EXTENDED
                                      : (float)(model["multExtended"] | MB_TIMING_MULT_EXTENDED);
  float t0Fallback   = model.isNull() ? MB_TIMING_T0_FALLBACK_SEC
                                      : (float)(model["t0FallbackSec"] | MB_TIMING_T0_FALLBACK_SEC);

  // fadeBits stretches the final flash cycle — folded into on-time, not a separate fade
  // phase. Null model (firmware defaults) has no stretch — matches E9 05/09 where stretch
  // has not been observed. Prefer fadeBitsStretchSec[]; fall back to deprecated fadeStepSec.
  float stretchSec = 0.0f;
  if (!model.isNull()) {
    bool stretchAppliesToExtended = model["fadeBitsStretchAppliesToExtended"] | false;
    if (model["fadeBitsStretchSec"].is<JsonArray>()) {
      JsonArray stretchArr = model["fadeBitsStretchSec"].as<JsonArray>();
      if (fadeBits < stretchArr.size()) {
        if (!extended || stretchAppliesToExtended) {
          stretchSec = stretchArr[fadeBits].as<float>();
          if (stretchSec < 0.0f) stretchSec = 0.0f;
        }
      }
    } else if (model.containsKey("fadeStepSec") && (!extended || stretchAppliesToExtended)) {
      // Deprecated: old fadeBits * fadeStepSec → treat as stretch amount.
      float fadeStepSec = (float)(model["fadeStepSec"] | 0.0);
      if (fadeStepSec > 0.0f) stretchSec = (float)fadeBits * fadeStepSec;
    }
  }

  float onSec;
  if (extended) {
    onSec = (t == 0) ? t0Fallback : (multExtended * (float)t);
  } else if (scaler) {
    onSec = (t == 0) ? t0Fallback : (multScaler * (float)t);
  } else {
    onSec = (t == 0) ? t0Fallback : (multNormal * (float)t);
  }
  onSec += stretchSec;

  TimingDecode out;
  out.onTimeMs = (unsigned long)(onSec * 1000.0f + 0.5f);
  out.stretchMs = (unsigned long)(stretchSec * 1000.0f + 0.5f);
  out.extended = extended;
  out.scaler = scaler;
  return out;
}

/** WLED Strobe: cycleTime_ms = (255 - sx) * 20 → sx = 255 - 50/hz. */
static int strobeSxFromHz(float hz) {
  if (hz <= 0.01f) return 128;
  int sx = (int)lroundf(255.0f - (50.0f / hz));
  if (sx < 0) sx = 0;
  if (sx > 255) sx = 255;
  return sx;
}

/**
 * WLED Chase (FX_MODE_CHASE_COLOR / fx=28) in FX.cpp:
 *   counter = strip.now * ((SEGMENT.speed >> 2) + 1);
 *   a = (counter * SEGLEN) >> 16;
 * Full lap when counter advances 65536 → T_ms = 65536 / ((sx >> 2) + 1).
 * Inverse used to map Disney on_time (or on_time/5 × 5 zones) onto sx.
 */
static int chaseSxFromCycleMs(unsigned long cycleMs) {
  if (cycleMs == 0) return 255;
  float rate = 65536.0f / (float)cycleMs;
  if (rate < 1.0f) rate = 1.0f;
  if (rate > 64.0f) rate = 64.0f;  // sx=255 → (255>>2)+1 = 64
  int sx = (int)lroundf((rate - 1.0f) * 4.0f);
  if (sx < 0) sx = 0;
  if (sx > 255) sx = 255;
  return sx;
}

/** Shared by applyStrobeFromTimingModel + timing* extract sources. */
static float resolveFlashRateHz(const JsonObject& rule, const uint8_t* payload, size_t plen) {
  JsonObject timingObj = rule["timing"].as<JsonObject>();
  if (timingObj.isNull() || !(timingObj["enabled"] | false)) return 0.0f;
  const char* tmId = timingObj["timingModelId"] | "";
  JsonObject tm = findTimingModelById(tmId);
  uint8_t tOff = (uint8_t)(timingObj["offset"] | 5);
  uint8_t tByte = (payload && tOff < plen) ? payload[tOff] : 0;
  TimingDecode td = decodeTimingByte(tByte, tm);
  JsonObject strobe = tm.isNull() ? JsonObject() : tm["strobeEffect"].as<JsonObject>();
  float hz = strobe.isNull() ? 2.0f : (float)(strobe["flashRateNormalHz"] | 2.0);
  if (td.extended) hz = strobe.isNull() ? 0.35f : (float)(strobe["flashRateExtendedHz"] | 0.35);
  else if (td.scaler) hz = strobe.isNull() ? 1.0f : (float)(strobe["flashRateScalerHz"] | 1.0);
  return hz;
}

/** Decoded timing-derived scalar for extract sources (Hz or seconds). */
static float resolveTimingDerivedValue(const JsonObject& rule, const uint8_t* payload,
                                       size_t plen, const char* source) {
  if (!source) return 0.0f;
  if (strcmp(source, "timingFlashRate") == 0) {
    return resolveFlashRateHz(rule, payload, plen);
  }
  JsonObject timingObj = rule["timing"].as<JsonObject>();
  if (timingObj.isNull() || !(timingObj["enabled"] | false)) return 0.0f;
  const char* tmId = timingObj["timingModelId"] | "";
  JsonObject tm = findTimingModelById(tmId);
  uint8_t tOff = (uint8_t)(timingObj["offset"] | 5);
  uint8_t tByte = (payload && tOff < plen) ? payload[tOff] : 0;
  TimingDecode td = decodeTimingByte(tByte, tm);
  if (strcmp(source, "timingOnSec") == 0) return td.onTimeMs / 1000.0f;
  if (strcmp(source, "timingFadeSec") == 0) return td.stretchMs / 1000.0f;
  return 0.0f;
}

static bool isTimingDerivedSource(const char* source) {
  if (!source) return false;
  return strcmp(source, "timingFlashRate") == 0
      || strcmp(source, "timingOnSec") == 0
      || strcmp(source, "timingFadeSec") == 0;
}

static void applyStrobeFromTimingModel(JsonObject wled, const JsonObject& rule,
                                       const uint8_t* payload, size_t plen) {
  JsonObject timingObj = rule["timing"].as<JsonObject>();
  if (timingObj.isNull()) return;
  const char* tmId = timingObj["timingModelId"] | "";
  JsonObject model = findTimingModelById(tmId);
  if (model.isNull()) return;
  JsonObject strobe = model["strobeEffect"].as<JsonObject>();
  if (strobe.isNull() || !(strobe["enabled"] | false)) return;

  float hz = resolveFlashRateHz(rule, payload, plen);
  int sx = strobeSxFromHz(hz);
  int fx = strobe["fx"] | 23;

  JsonArray segs = wled["seg"].as<JsonArray>();
  if (segs.isNull() || segs.size() == 0) {
    wled["fx"] = fx;
    wled["sx"] = sx;
    return;
  }
  for (JsonObject seg : segs) {
    int stop = seg["stop"] | 0;
    int start = seg["start"] | 0;
    if (stop <= start) continue;
    seg["fx"] = fx;
    seg["sx"] = sx;
  }
  Serial.printf("[Rule] strobe fx=%d sx=%d (%.2f Hz)\n", fx, sx, hz);
}

/** Author-sized timing→WLED field buckets (optional; mutually exclusive with strobe). */
static bool resolveSpeedBucketValue(JsonObject model, uint8_t timingByte,
                                    int* outValue, const char** outField) {
  if (model.isNull() || !outValue || !outField) return false;
  JsonObject sb = model["speedBuckets"].as<JsonObject>();
  if (sb.isNull() || !(sb["enabled"] | false)) return false;
  JsonArray buckets = sb["buckets"].as<JsonArray>();
  if (buckets.isNull() || buckets.size() == 0) return false;

  uint8_t key = timingByte;
  JsonObject maskBits = sb["maskBits"].as<JsonObject>();
  if (!maskBits.isNull()) {
    uint8_t bitStart = (uint8_t)(maskBits["bitStart"] | 0);
    uint8_t bitCount = (uint8_t)(maskBits["bitCount"] | 8);
    key = (uint8_t)extractBits(&timingByte, 1, 0, bitStart, bitCount);
  }

  JsonObject chosen;
  int chosenMax = 256;
  int fallbackMax = -1;
  JsonObject fallback;
  for (JsonVariant v : buckets) {
    if (!v.is<JsonObject>()) continue;
    JsonObject b = v.as<JsonObject>();
    int maxByte = b["maxByte"] | 255;
    if (maxByte > fallbackMax) { fallbackMax = maxByte; fallback = b; }
    if ((int)key <= maxByte && maxByte < chosenMax) {
      chosenMax = maxByte;
      chosen = b;
    }
  }
  if (chosen.isNull()) chosen = fallback;
  if (chosen.isNull()) return false;

  *outValue = chosen["value"] | 128;
  *outField = sb["field"] | "sx";
  return true;
}

/** Resolve one color source to RGB (fixed hex, palette index, raw gray, or channel group). */
static void resolveColorSource(JsonObject srcObj, const uint8_t* payload, size_t plen,
                               uint8_t& r, uint8_t& g, uint8_t& b) {
  r = g = b = 0;
  if (srcObj.isNull()) return;

  const char* kind = srcObj["kind"] | "";
  // Authored constant — do not apply BLE RGB calibration (display values as written).
  if (strcmp(kind, "fixed") == 0) {
    parseHexColor(srcObj["value"] | "#000000", r, g, b);
    return;
  }

  JsonObject channelGroup = srcObj["channelGroup"].as<JsonObject>();
  // Named sources use kind:"rgb"; legacy colorBlend a/b may embed channelGroup without kind.
  bool useRgb = (strcmp(kind, "rgb") == 0) || (kind[0] == 0 && !channelGroup.isNull());
  if (useRgb) {
    if (channelGroup.isNull()) return;
    auto extractChannel = [&](const char* key) -> uint8_t {
      JsonObject ch = channelGroup[key].as<JsonObject>();
      if (ch.isNull()) return 0;
      uint8_t offset = (uint8_t)(ch["offset"] | 0);
      uint8_t bitStart = (uint8_t)(ch["bitStart"] | 0);
      uint8_t bitCount = (uint8_t)(ch["bitCount"] | 6);
      uint32_t chRaw = extractBits(payload, plen, offset, bitStart, bitCount);
      const char* scale = channelGroup["scale"] | "bitReplicate6to8";
      if (strcmp(scale, "bitReplicate6to8") == 0) return scale6To8((uint8_t)chRaw);
      // "direct8" / "none" / unrecognized → pass through full extracted value
      return (uint8_t)chRaw;
    };
    r = extractChannel("r");
    g = extractChannel("g");
    b = extractChannel("b");
    applyMbRgbCalibration(r, g, b);
    return;
  }

  uint8_t offset = (uint8_t)(srcObj["offset"] | 0);
  uint8_t bitStart = (uint8_t)(srcObj["bitStart"] | 0);
  uint8_t bitCount = (uint8_t)(srcObj["bitCount"] | 8);
  uint32_t raw = extractBits(payload, plen, offset, bitStart, bitCount);
  // kind:"palette" always maps; legacy colorBlend a/b uses paletteMap (default true).
  bool asPalette = (strcmp(kind, "palette") == 0) || (srcObj["paletteMap"] | true);
  if (asPalette) {
    paletteToRGB((uint8_t)(raw & 0x1F), r, g, b);
  } else {
    r = g = b = (uint8_t)raw;
  }
}

static float resolveBlendRatio(JsonObject ratioObj, const uint8_t* payload, size_t plen) {
  if (ratioObj.isNull()) return 0.5f;
  const char* mode = ratioObj["mode"] | "fixed";
  if (strcmp(mode, "extract") == 0) {
    uint8_t offset = (uint8_t)(ratioObj["offset"] | 0);
    uint8_t bitStart = (uint8_t)(ratioObj["bitStart"] | 0);
    uint8_t bitCount = (uint8_t)(ratioObj["bitCount"] | 8);
    uint32_t raw = extractBits(payload, plen, offset, bitStart, bitCount);
    uint32_t maxVal = (bitCount >= 32) ? 0xFFFFFFFFu : ((1u << bitCount) - 1u);
    return maxVal > 0 ? ((float)raw / (float)maxVal) : 0.5f;
  }
  float v = ratioObj["value"] | 0.5f;
  if (v < 0.0f) v = 0.0f;
  if (v > 1.0f) v = 1.0f;
  return v;
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
  if (col.isNull()) return;  // document full — do not spin
  // ArduinoJson returns a null array when the pool is exhausted; size() stays
  // unchanged → an unbounded while would hang loop() forever (BLE queue fills).
  while ((int)col.size() <= colorSlot) {
    size_t before = col.size();
    JsonArray rgb = col.createNestedArray();
    if (rgb.isNull() || col.size() <= before) return;
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

/** WLED v16 seg.bm from Illuma blend id (legacy "normal" → Top). */
static uint8_t blendModeToBm(const char* blend) {
  if (!blend || !blend[0]) return 0;
  if (strcmp(blend, "top") == 0 || strcmp(blend, "normal") == 0) return 0;
  if (strcmp(blend, "bottom") == 0 || strcmp(blend, "none") == 0) return 1;
  if (strcmp(blend, "add") == 0) return 2;
  if (strcmp(blend, "subtract") == 0) return 3;
  if (strcmp(blend, "difference") == 0) return 4;
  if (strcmp(blend, "average") == 0) return 5;
  if (strcmp(blend, "multiply") == 0) return 6;
  if (strcmp(blend, "divide") == 0) return 7;
  if (strcmp(blend, "lighten") == 0) return 8;
  if (strcmp(blend, "darken") == 0) return 9;
  if (strcmp(blend, "screen") == 0) return 10;
  if (strcmp(blend, "overlay") == 0) return 11;
  if (strcmp(blend, "hardLight") == 0) return 12;
  if (strcmp(blend, "softLight") == 0) return 13;
  if (strcmp(blend, "dodge") == 0) return 14;
  if (strcmp(blend, "burn") == 0) return 15;
  if (strcmp(blend, "stencil") == 0) return 32;
  return 0;
}

/** Seed WLED segs from a segment map. When hasRuleEffect, rule.effect fills gaps
 *  for fx/pal/sx/ix that the segment itself does not set. Per-rule segmentOverrides
 *  (custom/default) are applied afterward via applySegmentOverridesOntoWled. */
static void seedWledFromSegmentMap(JsonObject wled, JsonObject segMap,
                                   JsonObject ruleEffect, bool hasRuleEffect) {
  wled["on"] = true;
  JsonArray segs = wled.createNestedArray("seg");
  JsonArray defs = segMap["segments"].as<JsonArray>();
  if (defs.isNull()) return;
  int fallbackFx = hasRuleEffect ? (ruleEffect["fx"] | 0) : 0;
  if (fallbackFx < 0) fallbackFx = 0;
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
    {
      const char* blend = def["blend"] | "top";
      if (def.containsKey("bm")) seg["bm"] = def["bm"] | 0;
      else seg["bm"] = blendModeToBm(blend);
    }
    int fx = def["fx"] | -1;
    seg["fx"] = fx >= 0 ? fx : fallbackFx;
    if (def.containsKey("sx")) seg["sx"] = def["sx"];
    else if (hasRuleEffect && ruleEffect.containsKey("sx")) seg["sx"] = ruleEffect["sx"];
    if (def.containsKey("ix")) seg["ix"] = def["ix"];
    else if (hasRuleEffect && ruleEffect.containsKey("ix")) seg["ix"] = ruleEffect["ix"];
    int pal = def["pal"] | -1;
    if (pal >= 0) {
      seg["pal"] = pal;
    } else if (hasRuleEffect) {
      int rpal = ruleEffect["pal"] | -1;
      if (rpal >= 0) seg["pal"] = rpal;
    }

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

/** Apply rule.segmentOverrides custom/default modes onto seeded WLED segs.
 *  stored/extract/missing leave the map (or preset) seed alone; extracts run later. */
static void applySegmentOverridesOntoWled(JsonObject wled, JsonObject segMap,
                                          JsonObject ruleEffect, bool hasRuleEffect,
                                          JsonObject segmentOverrides) {
  if (segmentOverrides.isNull() || segMap.isNull()) return;
  JsonArray defs = segMap["segments"].as<JsonArray>();
  if (defs.isNull()) return;
  int fallbackFx = hasRuleEffect ? (ruleEffect["fx"] | 0) : 0;
  if (fallbackFx < 0) fallbackFx = 0;

  for (JsonVariant v : defs) {
    if (!v.is<JsonObject>()) continue;
    JsonObject def = v.as<JsonObject>();
    const char* localId = def["id"] | "";
    if (!localId[0] || !segmentOverrides.containsKey(localId)) continue;
    JsonObject ov = segmentOverrides[localId].as<JsonObject>();
    if (ov.isNull()) continue;
    JsonObject seg = ensureWledSegByLocalId(wled, def);

    if (ov.containsKey("fx") && ov["fx"].is<JsonObject>()) {
      const char* mode = ov["fx"]["mode"] | "stored";
      if (strcmp(mode, "custom") == 0) {
        int fx = ov["fx"]["value"] | 0;
        seg["fx"] = fx >= 0 ? fx : 0;
      } else if (strcmp(mode, "default") == 0) {
        seg["fx"] = fallbackFx;
      }
    }
    if (ov.containsKey("pal") && ov["pal"].is<JsonObject>()) {
      const char* mode = ov["pal"]["mode"] | "stored";
      if (strcmp(mode, "custom") == 0) {
        int pal = ov["pal"]["value"] | -1;
        if (pal >= 0) seg["pal"] = pal;
      } else if (strcmp(mode, "default") == 0 && hasRuleEffect) {
        int rpal = ruleEffect["pal"] | -1;
        if (rpal >= 0) seg["pal"] = rpal;
      }
    }
    if (ov.containsKey("sx") && ov["sx"].is<JsonObject>()) {
      const char* mode = ov["sx"]["mode"] | "stored";
      if (strcmp(mode, "custom") == 0) seg["sx"] = ov["sx"]["value"] | 128;
      else if (strcmp(mode, "default") == 0) {
        if (hasRuleEffect && ruleEffect.containsKey("sx")) seg["sx"] = ruleEffect["sx"];
        else seg["sx"] = 128;
      }
    }
    if (ov.containsKey("ix") && ov["ix"].is<JsonObject>()) {
      const char* mode = ov["ix"]["mode"] | "stored";
      if (strcmp(mode, "custom") == 0) seg["ix"] = ov["ix"]["value"] | 128;
      else if (strcmp(mode, "default") == 0) {
        if (hasRuleEffect && ruleEffect.containsKey("ix")) seg["ix"] = ruleEffect["ix"];
        else seg["ix"] = 128;
      }
    }
    if (ov.containsKey("blend") && ov["blend"].is<JsonObject>()) {
      const char* mode = ov["blend"]["mode"] | "stored";
      if (strcmp(mode, "custom") == 0) {
        if (ov["blend"]["value"].is<int>()) seg["bm"] = ov["blend"]["value"] | 0;
        else seg["bm"] = blendModeToBm(ov["blend"]["value"] | "top");
      } else if (strcmp(mode, "default") == 0) {
        seg["bm"] = 0;
      }
    }
    JsonArray ovColors = ov["colors"].as<JsonArray>();
    if (!ovColors.isNull()) {
      for (int i = 0; i < 3 && i < (int)ovColors.size(); i++) {
        if (!ovColors[i].is<JsonObject>()) continue;
        JsonObject cOv = ovColors[i].as<JsonObject>();
        const char* cmode = cOv["mode"] | "stored";
        if (strcmp(cmode, "custom") != 0) continue;
        const char* hex = cOv["value"] | "";
        if (!hex || !hex[0]) continue;
        uint8_t r, g, b;
        parseHexColor(hex, r, g, b);
        setSegColorSlot(seg, i, r, g, b);
      }
    }
  }
}

/** Map Illuma start/stop transition type strings → WLED TRANSITION_* (FX.h). */
static int blendingStyleFromTypeString(const char* ttype) {
  if (!ttype) return 0x00;
  if      (strcmp(ttype, "instant") == 0)     return 0;
  else if (strcmp(ttype, "fairyDust") == 0)   return 0x01;
  else if (strcmp(ttype, "swipeRight") == 0)  return 0x02;
  else if (strcmp(ttype, "swipeLeft") == 0)   return 0x03;
  else if (strcmp(ttype, "outsideIn") == 0)   return 0x04;
  else if (strcmp(ttype, "insideOut") == 0)   return 0x05;
  else if (strcmp(ttype, "swipeUp") == 0)     return 0x06;
  else if (strcmp(ttype, "swipeDown") == 0)   return 0x07;
  else if (strcmp(ttype, "openH") == 0)       return 0x08;
  else if (strcmp(ttype, "openV") == 0)       return 0x09;
  else if (strcmp(ttype, "swipeTL") == 0)     return 0x0A;
  else if (strcmp(ttype, "swipeTR") == 0)     return 0x0B;
  else if (strcmp(ttype, "swipeBR") == 0)     return 0x0C;
  else if (strcmp(ttype, "swipeBL") == 0)     return 0x0D;
  else if (strcmp(ttype, "circularOut") == 0) return 0x0E;
  else if (strcmp(ttype, "circularIn") == 0)  return 0x0F;
  else if (strcmp(ttype, "pushRight") == 0)   return 0x10;
  else if (strcmp(ttype, "pushLeft") == 0)    return 0x11;
  else if (strcmp(ttype, "pushUp") == 0)      return 0x12;
  else if (strcmp(ttype, "pushDown") == 0)    return 0x13;
  else if (strcmp(ttype, "pushTL") == 0)      return 0x14;
  else if (strcmp(ttype, "pushTR") == 0)      return 0x15;
  else if (strcmp(ttype, "pushBR") == 0)      return 0x16;
  else if (strcmp(ttype, "pushBL") == 0)      return 0x17;
  return 0x00; // fade
}

// -1 = no bs override on FTB (plain transition); set from stopTransition when enabled.
static int mbRuleStopBlendingStyle = -1;

static void sendMbRuleOff(unsigned long fadeMs) {
  int bs = mbRuleStopBlendingStyle;  // -1 if no stopTransition configured
  if (mbFadeToBlackPresetId.length() > 0) {
    if (restorePresetWithTransitionStyled(mbFadeToBlackPresetId, fadeMs, bs)) return;
    Serial.printf("[Rule] FTB preset '%s' failed, falling back to on:false\n",
                  mbFadeToBlackPresetId.c_str());
    bleNotify("{\"type\":\"ble_event\",\"event\":\"ftb_fallback\",\"presetId\":\"" +
              mbFadeToBlackPresetId + "\"}");
  }
  sendToWLED(injectWledTransition("{\"on\":false}", fadeMs));
}

static void beginTimedRuleOnPhase(const JsonObject& rule, const uint8_t* payload, size_t plen) {
  JsonObject timing = rule["timing"].as<JsonObject>();
  bool timingActive = !timing.isNull() && (timing["enabled"] | false);

  TimingDecode td = {};
  int cooldownSec = 2;
  bool haveSchedule = false;
  uint8_t timingByte = 0;
  const char* timingModelId = "";

  if (timingActive) {
    uint8_t offset = (uint8_t)(timing["offset"] | 5);
    timingByte = (payload && offset < plen) ? payload[offset] : 0;
    timingModelId = timing["timingModelId"] | "";
    JsonObject timingModel = findTimingModelById(timingModelId);
    td = decodeTimingByte(timingByte, timingModel);
    cooldownSec = timing["cooldownSec"] | 2;
    haveSchedule = true;
  } else {
    JsonObject fb = rule["fallbackDuration"].as<JsonObject>();
    if (!fb.isNull() && (fb["enabled"] | false)) {
      float onSec = fb["onSec"] | 10.0f;
      float fadeSec = fb["fadeSec"] | 0.0f;
      if (onSec < 0) onSec = 0;
      if (fadeSec < 0) fadeSec = 0;
      td.onTimeMs = (unsigned long)(onSec * 1000.0f + 0.5f);
      td.stretchMs = (unsigned long)(fadeSec * 1000.0f + 0.5f);
      td.extended = false;
      td.scaler = false;
      // cooldownSec: fallback's own value, else inherit timing block's (even if disabled), else 2.
      if (fb.containsKey("cooldownSec") && !fb["cooldownSec"].isNull()) {
        cooldownSec = fb["cooldownSec"] | 2;
      } else if (!timing.isNull() && timing.containsKey("cooldownSec")) {
        cooldownSec = timing["cooldownSec"] | 2;
      } else {
        cooldownSec = 2;
      }
      haveSchedule = true;
    }
  }

  if (!haveSchedule) {
    resetMbRuleLifecycle();
    return;
  }
  if (cooldownSec < 0) cooldownSec = 0;

  const char* mode = timing.isNull() ? "onMatch" : (timing["cooldownResetMode"] | "onMatch");

  strncpy(mbActiveRuleId, rule["id"] | "", MB_RULE_ID_LEN - 1);
  mbActiveRuleId[MB_RULE_ID_LEN - 1] = '\0';
  mbActiveRuleCooldownMode =
    (strcmp(mode, "fixed") == 0) ? MB_COOLDOWN_FIXED : MB_COOLDOWN_ON_MATCH;
  long fadeOverride = -1;
  if (!timing.isNull() && timing.containsKey("fadeOverrideMs") && !timing["fadeOverrideMs"].isNull()) {
    fadeOverride = (long)(timing["fadeOverrideMs"] | -1);
  }
  // stretchMs drives the FTB transition during the final flash cycle (timingFade mode).
  mbRuleFadeMs = (fadeOverride >= 0) ? (unsigned long)fadeOverride : td.stretchMs;

  mbRuleStopBlendingStyle = -1;
  JsonObject stopTr = rule["stopTransition"].as<JsonObject>();
  if (!stopTr.isNull() && (stopTr["enabled"] | false)) {
    const char* stype = stopTr["type"] | "fade";
    const char* durMode = stopTr["durationMode"] | "timingFade";
    if (strcmp(stype, "instant") == 0) {
      mbRuleFadeMs = 0;
    } else if (strcmp(durMode, "custom") == 0 && stopTr.containsKey("timeMs")
               && !stopTr["timeMs"].isNull()) {
      mbRuleFadeMs = (unsigned long)(stopTr["timeMs"] | mbRuleFadeMs);
    }
    // else durationMode "timingFade": keep mbRuleFadeMs from stretch / fadeOverrideMs
    mbRuleStopBlendingStyle = blendingStyleFromTypeString(stype);
  }

  mbRuleCooldownMs = (unsigned long)cooldownSec * 1000UL;
  mbRulePhase = MB_RULE_ON;
  // onTimeMs already includes stretch. Start FTB stretchMs before the end so total
  // lit+fading time matches onTimeMs (fade IS the last cycle, not appended after).
  unsigned long onHoldMs = td.onTimeMs;
  if (mbRuleFadeMs > 0 && mbRuleFadeMs < onHoldMs) {
    onHoldMs -= mbRuleFadeMs;
  } else if (mbRuleFadeMs >= onHoldMs && onHoldMs > 0) {
    onHoldMs = 1;
  }
  mbRulePhaseDeadlineMs = millis() + (onHoldMs > 0 ? onHoldMs : 1);
  if (timingActive) {
    Serial.printf("[Rule] timing ON hold=%lums (totalOn=%lums) stretch/fade=%lums blackHold=%lums mode=%s model=%s byte=0x%02X stopBs=%d\n",
                  onHoldMs, td.onTimeMs, mbRuleFadeMs, mbRuleCooldownMs,
                  mbActiveRuleCooldownMode == MB_COOLDOWN_FIXED ? "fixed" : "onMatch",
                  timingModelId[0] ? timingModelId : "(default)", timingByte, mbRuleStopBlendingStyle);
  } else {
    Serial.printf("[Rule] fallbackDuration ON hold=%lums (totalOn=%lums) stretch/fade=%lums blackHold=%lums mode=%s stopBs=%d\n",
                  onHoldMs, td.onTimeMs, mbRuleFadeMs, mbRuleCooldownMs,
                  mbActiveRuleCooldownMode == MB_COOLDOWN_FIXED ? "fixed" : "onMatch",
                  mbRuleStopBlendingStyle);
  }
}

void resetMbRuleLifecycle() {
  mbRulePhase = MB_RULE_IDLE;
  mbRulePhaseDeadlineMs = 0;
  mbRuleFadeMs = 0;
  mbRuleCooldownMs = 2000;
  mbRuleStopBlendingStyle = -1;
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
    sendMbRuleOff(mbRuleFadeMs);
    mbRulePhase = MB_RULE_FADE;
    mbRulePhaseDeadlineMs = millis() + (mbRuleFadeMs > 0 ? mbRuleFadeMs : 1);
    return;
  }
  if (mbRulePhase == MB_RULE_FADE) {
    Serial.printf("[Rule] FADE→BLACK_HOLD holdMs=%lu\n", mbRuleCooldownMs);
    mbRulePhase = MB_RULE_COOLDOWN;
    mbRulePhaseDeadlineMs = millis() + (mbRuleCooldownMs > 0 ? mbRuleCooldownMs : 1);
    return;
  }
  if (mbRulePhase == MB_RULE_COOLDOWN) {
    Serial.println("[Rule] BLACK_HOLD→restore");
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
  const char* ruleId = rule["id"] | "";
  if (!ruleId[0] || strcmp(mbActiveRuleId, ruleId) != 0) return;

  // FADE / COOLDOWN: FTB (or black hold) already turned the effect off. A same-payload
  // match must re-POST WLED — flipping phase/deadline alone leaves the strip black.
  if (mbRulePhase == MB_RULE_FADE) {
    Serial.printf("[Rule] repeat during FTB — re-apply id=%s\n", ruleId);
    applyMatchedRule(rule, payload, plen);
    return;
  }
  if (mbRulePhase == MB_RULE_COOLDOWN) {
    if (mbActiveRuleCooldownMode == MB_COOLDOWN_FIXED) return;
    Serial.printf("[Rule] repeat during black hold — re-apply id=%s\n", ruleId);
    applyMatchedRule(rule, payload, plen);
    return;
  }

  // ON: keep alive with a short slack window — do not rebuild WLED on every advert.
  if (mbRulePhase == MB_RULE_ON) {
    unsigned long slackDeadline = millis() + MB_RULE_REPEAT_SLACK_MS;
    if ((long)(slackDeadline - mbRulePhaseDeadlineMs) > 0) {
      mbRulePhaseDeadlineMs = slackDeadline;
    }
  }
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

  // Payload-identity dedup already happened in applyParsedDisneyPacket() /
  // mbEffectIsRepeatAdvert() before this function was called. A payload only
  // reaches here if it's new or the first match — never a true byte-identical
  // repeat. Do not short-circuit on mbActiveRuleId alone (that skipped WLED
  // rebuilds when the same rule matched a different packet).

  const char* mapId = rule["segmentMapId"] | "";
  JsonObject segMap = findSegmentMapById(mapId);

  String presetId = rule["presetId"] | "";
  JsonArray extracts = rule["extract"].as<JsonArray>();

  // Lightweight rule-level effect (ignored when a preset is set — preset wins).
  JsonObject ruleEffect = rule["effect"].as<JsonObject>();
  bool hasRuleEffect = presetId.length() == 0
                    && !ruleEffect.isNull()
                    && (ruleEffect["enabled"] | false);
  // Default-mode overrides may still reference rule.effect even when a preset is set.
  bool ruleEffectEnabled = !ruleEffect.isNull() && (ruleEffect["enabled"] | false);
  JsonObject segmentOverrides = rule["segmentOverrides"].as<JsonObject>();

  // startTransition — WLED v16 blending style (`bs`) + duration
  unsigned long startTransMs = bleEffectTransitionMs;
  int blendingStyle = 0; // TRANSITION_FADE
  bool hasStartTr = false;
  JsonObject startTr = rule["startTransition"].as<JsonObject>();
  if (!startTr.isNull()) {
    hasStartTr = true;
    const char* ttype = startTr["type"] | "fade";
    if (strcmp(ttype, "instant") == 0) {
      startTransMs = 0;
      blendingStyle = 0;
    } else {
      if (startTr.containsKey("timeMs")) startTransMs = (unsigned long)(startTr["timeMs"] | 0);
      blendingStyle = blendingStyleFromTypeString(ttype);
    }
  }

  saveWledStateForOverride();
  // Use the same cap as restore payloads — segment maps + extracts need headroom.
  // A failed alloc (capacity 0) + setSegColorSlot used to infinite-loop and stall loop().
  DynamicJsonDocument wled(WLED_RESTORE_JSON_CAP);
  if (wled.capacity() < 2048) {
    Serial.println("[Rule] WLED doc alloc failed — abort apply");
    return;
  }
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
      // as<JsonObject>() on an empty doc is null — writes are discarded and
      // serializeJson yields "null" (4 bytes). to<JsonObject>() creates the root.
      JsonObject wledObj = wled.to<JsonObject>();
      seedWledFromSegmentMap(wledObj, segMap, ruleEffect, hasRuleEffect);
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
    // custom/default overrides beat map (and preset geometry); extracts still win later.
    applySegmentOverridesOntoWled(
      wled.as<JsonObject>(), segMap, ruleEffect, ruleEffectEnabled, segmentOverrides);
  }

  if (!haveWled) {
    wled["on"] = true;
    JsonArray segs = wled.createNestedArray("seg");
    JsonObject seg0 = segs.createNestedObject();
    seg0["id"] = 0;
    seg0["start"] = 0;
    seg0["stop"] = STRIP_LED_COUNT;
    if (hasRuleEffect) {
      int fx = ruleEffect["fx"] | 0;
      seg0["fx"] = fx >= 0 ? fx : 0;
      if (ruleEffect.containsKey("sx")) seg0["sx"] = ruleEffect["sx"];
      if (ruleEffect.containsKey("ix")) seg0["ix"] = ruleEffect["ix"];
      int pal = ruleEffect["pal"] | -1;
      if (pal >= 0) seg0["pal"] = pal;
    } else {
      seg0["fx"] = 0;
    }
    haveWled = true;
  }

  // Extract → fan-out targets
  // Resolve all named color sources once per apply — avoids re-parsing the same
  // bytes if multiple segment targets reference the same source.
  struct NamedColor { const char* name; uint8_t r, g, b; };
  NamedColor resolvedSources[8];
  int resolvedSourceCount = 0;

  JsonArray colorSources = rule["colorSources"].as<JsonArray>();
  if (!colorSources.isNull()) {
    for (JsonVariant v : colorSources) {
      if (resolvedSourceCount >= 8) break;
      if (!v.is<JsonObject>()) continue;
      JsonObject src = v.as<JsonObject>();
      const char* name = src["name"] | "";
      if (!name[0]) continue;
      uint8_t sr = 0, sg = 0, sb = 0;
      resolveColorSource(src, payload, plen, sr, sg, sb);
      resolvedSources[resolvedSourceCount++] = { name, sr, sg, sb };
      Serial.printf("[Rule] colorSource '%s' rgb=%u,%u,%u\n", name, sr, sg, sb);
    }
  }

  auto findResolvedSource = [&](const char* name) -> const NamedColor* {
    if (!name || !name[0]) return nullptr;
    for (int i = 0; i < resolvedSourceCount; i++) {
      if (strcmp(resolvedSources[i].name, name) == 0) return &resolvedSources[i];
    }
    return nullptr;
  };

  if (!extracts.isNull()) {
    for (JsonVariant ev : extracts) {
      if (!ev.is<JsonObject>()) continue;
      JsonObject ex = ev.as<JsonObject>();
      const char* source = ex["source"] | "payloadBits";
      uint32_t raw = 0;
      float derivedValue = -1.0f;  // sentinel: not a timing-derived extract
      bool paletteMap = ex["paletteMap"] | false;
      bool hasFixedColor = (strcmp(source, "fixedColor") == 0);
      JsonObject channelGroup = ex["channelGroup"].as<JsonObject>();
      bool hasChannelGroup = !hasFixedColor && !channelGroup.isNull();
      JsonObject colorBlend = ex["colorBlend"].as<JsonObject>();
      bool hasColorBlend = !hasFixedColor && !colorBlend.isNull();
      bool hasColorSourceBlend = (strcmp(source, "colorSourceBlend") == 0);

      if (isTimingDerivedSource(source)) {
        derivedValue = resolveTimingDerivedValue(rule, payload, plen, source);
        paletteMap = false;
      } else if (!hasFixedColor && !hasChannelGroup && !hasColorBlend && !hasColorSourceBlend) {
        uint8_t offset = (uint8_t)(ex["offset"] | 0);
        uint8_t bitStart = (uint8_t)(ex["bitStart"] | 0);
        uint8_t bitCount = (uint8_t)(ex["bitCount"] | 8);
        raw = extractBits(payload, plen, offset, bitStart, bitCount);
      }

      uint8_t r = 0, g = 0, b = 0;
      float mapped = (derivedValue >= 0.0f) ? derivedValue : (float)raw;
      if (hasFixedColor) {
        parseHexColor(ex["value"] | "#000000", r, g, b);
        mapped = 0.0f;
        Serial.printf("[Rule] fixedColor rgb=%u,%u,%u\n", r, g, b);
      } else if (hasChannelGroup) {
        auto extractChannel = [&](const char* key, bool* flashOut) -> uint8_t {
          JsonObject ch = channelGroup[key].as<JsonObject>();
          if (ch.isNull()) {
            if (flashOut) *flashOut = false;
            return 0;
          }
          uint8_t offset = (uint8_t)(ch["offset"] | 0);
          uint8_t bitStart = (uint8_t)(ch["bitStart"] | 0);
          uint8_t bitCount = (uint8_t)(ch["bitCount"] | 6);
          uint32_t chRaw = extractBits(payload, plen, offset, bitStart, bitCount);
          if (flashOut) {
            *flashOut = false;
            JsonObject flashBit = ch["flashBit"].as<JsonObject>();
            if (!flashBit.isNull()) {
              uint8_t fOff = (uint8_t)(flashBit["offset"] | offset);
              uint8_t fBit = (uint8_t)(flashBit["bit"] | 7);
              *flashOut = extractBits(payload, plen, fOff, fBit, 1) != 0;
            }
          }
          const char* scale = channelGroup["scale"] | "bitReplicate6to8";
          if (strcmp(scale, "bitReplicate6to8") == 0) return scale6To8((uint8_t)chRaw);
          if (strcmp(scale, "direct8") == 0) return (uint8_t)chRaw;
          return (uint8_t)chRaw;  // "none" or unrecognized
        };
        bool flashR = false, flashG = false, flashB = false;
        r = extractChannel("r", &flashR);
        g = extractChannel("g", &flashG);
        b = extractChannel("b", &flashB);
        applyMbRgbCalibration(r, g, b);
        mapped = 0.0f;
        Serial.printf("[Rule] channelGroup rgb=%u,%u,%u flash=%u%u%u\n",
                      r, g, b, flashR ? 1u : 0u, flashG ? 1u : 0u, flashB ? 1u : 0u);
      } else if (hasColorBlend) {
        uint8_t ar, ag, ab, br_, bg, bb;
        resolveColorSource(colorBlend["a"].as<JsonObject>(), payload, plen, ar, ag, ab);
        resolveColorSource(colorBlend["b"].as<JsonObject>(), payload, plen, br_, bg, bb);
        float ratio = resolveBlendRatio(colorBlend["ratio"].as<JsonObject>(), payload, plen);
        r = (uint8_t)lroundf((float)ar + ((float)br_ - (float)ar) * ratio);
        g = (uint8_t)lroundf((float)ag + ((float)bg - (float)ag) * ratio);
        b = (uint8_t)lroundf((float)ab + ((float)bb - (float)ab) * ratio);
        mapped = 0.0f;
        Serial.printf("[Rule] colorBlend rgb=%u,%u,%u ratio=%.3f\n", r, g, b, ratio);
      } else if (hasColorSourceBlend) {
        JsonArray blend = ex["blend"].as<JsonArray>();
        float sumWeight = 0.0f;
        if (!blend.isNull()) {
          for (JsonVariant v : blend) {
            if (!v.is<JsonObject>()) continue;
            sumWeight += (float)(v.as<JsonObject>()["weightPct"] | 0.0f);
          }
        }
        if (sumWeight <= 0.0f) sumWeight = 100.0f;

        float rf = 0.0f, gf = 0.0f, bf = 0.0f;
        int used = 0;
        if (!blend.isNull()) {
          for (JsonVariant v : blend) {
            if (!v.is<JsonObject>()) continue;
            JsonObject be = v.as<JsonObject>();
            const char* srcName = be["source"] | "";
            float w = (float)(be["weightPct"] | 0.0f) / sumWeight;
            const NamedColor* nc = findResolvedSource(srcName);
            if (!nc) {
              Serial.printf("[Rule] colorSourceBlend unknown source '%s'\n", srcName);
              continue;
            }
            rf += (float)nc->r * w;
            gf += (float)nc->g * w;
            bf += (float)nc->b * w;
            used++;
          }
        }
        r = (uint8_t)lroundf(rf);
        g = (uint8_t)lroundf(gf);
        b = (uint8_t)lroundf(bf);
        mapped = 0.0f;
        Serial.printf("[Rule] colorSourceBlend rgb=%u,%u,%u (%d/%d entries)\n",
                      r, g, b, used, blend.isNull() ? 0 : (int)blend.size());
      } else if (paletteMap) {
        uint8_t pal = (uint8_t)(raw & 0x1F);
        paletteToRGB(pal, r, g, b);
        mapped = (float)pal;
      } else if (ex.containsKey("curve")) {
        JsonObject curve = ex["curve"].as<JsonObject>();
        const char* ctype = curve["type"] | "linear";
        CurveType ct = CurveType::LINEAR;
        if (strcmp(ctype, "exponential") == 0) ct = CurveType::EXPONENTIAL;
        else if (strcmp(ctype, "reciprocal") == 0) ct = CurveType::RECIPROCAL;
        float expv = curve["exponent"] | 2.0f;
        float outScale = curve["outScale"] | 50.0f;
        float curveRaw = (derivedValue >= 0.0f) ? derivedValue : (float)raw;
        mapped = applyCurve(curveRaw,
                            (float)(curve["inMin"] | 0),
                            (float)(curve["inMax"] | 15),
                            (float)(curve["outMin"] | 0),
                            (float)(curve["outMax"] | 255),
                            ct, expv, outScale);
        uint8_t pal = (uint8_t)((uint32_t)lroundf(mapped) & 0x1F);
        paletteToRGB(pal, r, g, b);
      } else if (derivedValue < 0.0f) {
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
          int slot = tgt["colorSlot"] | 0;
          JsonArray segIds = tgt["segmentIds"].as<JsonArray>();
          if (!segIds.isNull() && segIds.size() > 0) {
            for (JsonVariant sv : segIds) {
              const char* segId = sv.as<const char*>();
              if (!segId || !segId[0]) continue;
              JsonObject def = findSegInMap(segMap, segId);
              if (def.isNull()) continue;
              JsonObject segObj = ensureWledSegByLocalId(wled.as<JsonObject>(), def);
              setSegColorSlot(segObj, slot, r, g, b);
            }
            return;
          }
          const char* segId = tgt["segmentId"] | "";
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

  // Timing-model speed buckets (author table) take precedence over strobe when enabled.
  if (timingEn && payload && plen > 0) {
    JsonObject timingObj = rule["timing"].as<JsonObject>();
    const char* tmId = timingObj.isNull() ? "" : (timingObj["timingModelId"] | "");
    JsonObject tm = findTimingModelById(tmId);
    uint8_t tOff = (uint8_t)(timingObj.isNull() ? 5 : (timingObj["offset"] | 5));
    uint8_t tByte = (tOff < plen) ? payload[tOff] : 0;

    int bucketValue = 0;
    const char* bucketField = nullptr;
    if (resolveSpeedBucketValue(tm, tByte, &bucketValue, &bucketField)) {
      JsonArray segs = wled["seg"].as<JsonArray>();
      if (!segs.isNull()) {
        for (JsonObject seg : segs) setSegNumericField(seg, bucketField, (float)bucketValue);
      }
      Serial.printf("[Rule] speedBuckets %s=%d (timing=0x%02X)\n",
                    bucketField ? bucketField : "sx", bucketValue, tByte);
    } else {
      applyStrobeFromTimingModel(wled.as<JsonObject>(), rule, payload, plen);
    }
  }

  if (wled.overflowed()) {
    Serial.println("[Rule] WLED doc overflowed while building — abort apply");
    return;
  }

  String wledJson;
  serializeJson(wled, wledJson);
  if (wledJson.length() < 8 || wledJson == "null") {
    Serial.printf("[Rule] abort apply — empty WLED payload (%u bytes: %s)\n",
                  (unsigned)wledJson.length(), wledJson.c_str());
    return;
  }
  Serial.printf("[Rule] posting WLED (%u bytes) id=%s name=%s\n",
                (unsigned)wledJson.length(),
                rule["id"] | "(no id)", rule["name"] | "(no name)");
  // preparePresetApplyPayload forces on:true in the same POST (GLEDOPTO relay).
  // Do not call ensureWledPowerOn() first — an extra HTTP under scan load often
  // fails silently and is redundant once on is in the apply body.
  String body = preparePresetApplyPayload(wledJson);
  // Fail fast under scan load — long POST timeouts starve bleCmdQueue.
  bool ok = sendToWLED(
    injectWledTransition(body, startTransMs, hasStartTr ? blendingStyle : -1),
    1200, 0);
  if (!ok) {
    Serial.printf("[Rule] WLED apply failed id=%s name=%s\n",
                  rule["id"] | "(no id)", rule["name"] | "(no name)");
    return;
  }

  setOverride(src);
  // Fallback duration reuses the timed ON→FADE→COOLDOWN machine when timing is off.
  // Keep BLE_MAGIC-only (same restriction as the packet-timing path).
  bool hasFallback = !timingEn && (rule["fallbackDuration"]["enabled"] | false);
  if ((timingEn || hasFallback) && src == BLE_MAGIC) {
    beginTimedRuleOnPhase(rule, payload, plen);
  } else {
    resetMbRuleLifecycle();
    touchOverrideIdleTimer(src);
  }

  Serial.printf("[Rule] Applied id=%s name=%s preset=%s map=%s src=%d\n",
                rule["id"] | "(no id)", rule["name"] | "(no name)",
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

  // Cache rules[] / segmentMaps[] / timingModels[] when any are present —
  // colors-only pushes must not wipe them.
  if (doc.containsKey("rules") || doc.containsKey("segmentMaps") || doc.containsKey("timingModels")) {
    String raw;
    serializeJson(doc, raw);
    // If only maps/models arrived without rules, merge onto existing cache
    if (!doc.containsKey("rules") && gRulesDoc.containsKey("rules")) {
      DynamicJsonDocument merged(BLE_JSON_DOC_SIZE);
      String existing;
      serializeJson(gRulesDoc, existing);
      DeserializationError existingErr = deserializeJson(merged, existing);
      if (!existingErr) {
        if (doc.containsKey("segmentMaps")) merged["segmentMaps"] = doc["segmentMaps"];
        if (doc.containsKey("timingModels")) merged["timingModels"] = doc["timingModels"];
        if (doc.containsKey("paradeDetection")) merged["paradeDetection"] = doc["paradeDetection"];
        if (doc.containsKey("defaultPresetId")) merged["defaultPresetId"] = doc["defaultPresetId"];
        gRulesDoc.clear();
        serializeJson(merged, raw);
        DeserializationError mergeErr = deserializeJson(gRulesDoc, raw);
        if (mergeErr) {
          Serial.printf("[Rules] cache deserialize failed (merge writeback): %s\n", mergeErr.c_str());
        }
      } else {
        Serial.printf("[Rules] existing cache deserialize failed: %s — replacing with incoming doc\n",
                      existingErr.c_str());
        gRulesDoc.clear();
        DeserializationError replaceErr = deserializeJson(gRulesDoc, raw);
        if (replaceErr) {
          Serial.printf("[Rules] cache deserialize failed (replace): %s\n", replaceErr.c_str());
        }
      }
    } else {
      gRulesDoc.clear();
      DeserializationError cacheErr = deserializeJson(gRulesDoc, raw);
      if (cacheErr) {
        Serial.printf("[Rules] cache deserialize failed: %s\n", cacheErr.c_str());
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
  JsonArray tms = gRulesDoc["timingModels"].as<JsonArray>();
  Serial.printf("[Rules] loaded rules=%u maps=%u timingModels=%u defaultPreset=%s parade=%d prefix=%s rssi>=%d cooldown=%lums\n",
                rules.isNull() ? 0u : (unsigned)rules.size(),
                maps.isNull() ? 0u : (unsigned)maps.size(),
                tms.isNull() ? 0u : (unsigned)tms.size(),
                bleDefaultPresetId.c_str(), paradeDetectEnabled ? 1 : 0,
                paradeBeaconPrefix, paradeRssiThreshold, paradeCooldownMs);
}

void loadMbRulesFromJson() {
  bleDefaultPresetId = "";
  const String& src = mbRulesJson.length() > 0 ? mbRulesJson : mbMappingJson;
  if (src.length() == 0) return;
  DynamicJsonDocument doc(BLE_JSON_DOC_SIZE);
  DeserializationError err = deserializeJson(doc, src);
  if (err) {
    Serial.printf("[Rules] JSON parse failed: %s (%u bytes)\n", err.c_str(), (unsigned)src.length());
    return;
  }
  applyMbRulesJson(doc.as<JsonObject>());
}

bool mbRulesJsonUsable(const String& json) {
  if (json.length() == 0) return false;
  DynamicJsonDocument doc(BLE_JSON_DOC_SIZE);
  DeserializationError err = deserializeJson(doc, json);
  if (err) return false;
  JsonArray rules = doc["rules"].as<JsonArray>();
  return !rules.isNull() && rules.size() > 0;
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
