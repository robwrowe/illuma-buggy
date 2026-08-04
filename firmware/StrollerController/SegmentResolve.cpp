#include "SegmentResolve.h"
#include "Config.h"
#include "MbRuleEngine.h"
#include "PresetStore.h"
#include <math.h>
#include <string.h>

void parseHexColor(const char* hex, uint8_t& r, uint8_t& g, uint8_t& b) {
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

bool resolveColorRefHex(JsonObject ref, JsonArray colorLibrary, String& outHex) {
  outHex = "";
  if (ref.isNull()) return false;
  const char* mode = ref["mode"] | "stored";
  if (strcmp(mode, "custom") == 0) {
    outHex = ref["value"] | "";
    return outHex.length() > 0;
  }
  if (strcmp(mode, "swatch") == 0) {
    const char* swatchId = ref["swatchId"] | "";
    if (!swatchId[0] || colorLibrary.isNull()) return false;
    for (JsonObject entry : colorLibrary) {
      if (strcmp(entry["id"] | "", swatchId) == 0) {
        outHex = entry["hex"] | "";
        return outHex.length() > 0;
      }
    }
  }
  return false;
}

/** Materialize global.colorRefs → global.col so seed/overrides see RGB triples. */
static void materializeGlobalColorRefs(JsonObject global, JsonArray colorLibrary) {
  if (global.isNull()) return;
  JsonArray refs = global["colorRefs"].as<JsonArray>();
  if (refs.isNull() || refs.size() == 0) return;
  JsonArray col = global.createNestedArray("col");
  for (JsonVariant v : refs) {
    if (!v.is<JsonObject>()) {
      JsonArray rgb = col.createNestedArray();
      rgb.add(0); rgb.add(0); rgb.add(0);
      continue;
    }
    String hex;
    uint8_t r = 0, g = 0, b = 0;
    if (resolveColorRefHex(v.as<JsonObject>(), colorLibrary, hex)) {
      parseHexColor(hex.c_str(), r, g, b);
    }
    JsonArray rgb = col.createNestedArray();
    rgb.add(r); rgb.add(g); rgb.add(b);
  }
}

uint8_t blendModeToBm(const char* blend) {
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

JsonObject ensureWledSegByLocalId(JsonObject wled, JsonObject segDef) {
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

void applyPresetVariables(JsonObject segObj, JsonObject presetVariables) {
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

void setSegColorSlot(JsonObject segObj, int colorSlot, uint8_t r, uint8_t g, uint8_t b) {
  if (colorSlot < 0) colorSlot = 0;
  if (colorSlot > 2) colorSlot = 2;
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

void setSegNumericField(JsonObject segObj, const char* field, float value) {
  if (!field || !field[0]) return;
  int iv = (int)lroundf(value);
  if (iv < 0) iv = 0;
  if (iv > 255 && strcmp(field, "fx") != 0 && strcmp(field, "pal") != 0 &&
      strcmp(field, "transition") != 0) {
    iv = 255;
  }
  segObj[field] = iv;
}

static void copyGlobalColOntoSeg(JsonObject seg, JsonObject globalLook) {
  JsonArray gcol = globalLook["col"].as<JsonArray>();
  if (gcol.isNull()) return;
  for (int i = 0; i < 3 && i < (int)gcol.size(); i++) {
    JsonArray rgb = gcol[i].as<JsonArray>();
    if (rgb.isNull() || rgb.size() < 3) continue;
    setSegColorSlot(seg, i, (uint8_t)(rgb[0] | 0), (uint8_t)(rgb[1] | 0), (uint8_t)(rgb[2] | 0));
  }
}

void seedWledFromSegmentMap(JsonObject wled, JsonObject segMap,
                            JsonObject globalLook, bool hasGlobalLook) {
  wled["on"] = true;
  JsonArray segs = wled.createNestedArray("seg");
  JsonArray defs = segMap["segments"].as<JsonArray>();
  if (defs.isNull()) return;
  int fallbackFx = hasGlobalLook ? (globalLook["fx"] | 0) : 0;
  if (fallbackFx < 0) fallbackFx = 0;
  for (JsonVariant v : defs) {
    if (!v.is<JsonObject>()) continue;
    JsonObject def = v.as<JsonObject>();
    if (!(def["enabled"] | true)) continue;
    int start = def["start"] | 0;
    int stop = def["stop"] | STRIP_LED_COUNT;
    if (stop <= start) continue;
    JsonObject seg = segs.createNestedObject();
    seg["id"] = def["wledSegId"] | 0;
    seg["start"] = start;
    seg["stop"] = stop;
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
    else if (hasGlobalLook && globalLook.containsKey("sx")) seg["sx"] = globalLook["sx"];
    if (def.containsKey("ix")) seg["ix"] = def["ix"];
    else if (hasGlobalLook && globalLook.containsKey("ix")) seg["ix"] = globalLook["ix"];
    // Preset global also carries c1-c3 / o1-o3; rule.effect typically does not.
    if (def.containsKey("c1")) seg["c1"] = def["c1"];
    else if (hasGlobalLook && globalLook.containsKey("c1")) seg["c1"] = globalLook["c1"];
    if (def.containsKey("c2")) seg["c2"] = def["c2"];
    else if (hasGlobalLook && globalLook.containsKey("c2")) seg["c2"] = globalLook["c2"];
    if (def.containsKey("c3")) seg["c3"] = def["c3"];
    else if (hasGlobalLook && globalLook.containsKey("c3")) seg["c3"] = globalLook["c3"];
    if (def.containsKey("o1")) seg["o1"] = def["o1"];
    else if (hasGlobalLook && globalLook.containsKey("o1")) seg["o1"] = globalLook["o1"];
    if (def.containsKey("o2")) seg["o2"] = def["o2"];
    else if (hasGlobalLook && globalLook.containsKey("o2")) seg["o2"] = globalLook["o2"];
    if (def.containsKey("o3")) seg["o3"] = def["o3"];
    else if (hasGlobalLook && globalLook.containsKey("o3")) seg["o3"] = globalLook["o3"];
    int pal = def["pal"] | -1;
    bool palSet = false;
    if (pal >= 0) {
      seg["pal"] = pal;
      palSet = true;
    } else if (hasGlobalLook) {
      int rpal = globalLook["pal"] | -1;
      if (rpal >= 0) { seg["pal"] = rpal; palSet = true; }
    }

    JsonArray colors = def["colors"].as<JsonArray>();
    bool colorsApplied = false;
    if (!colors.isNull()) {
      for (int i = 0; i < 3 && i < (int)colors.size(); i++) {
        const char* hex = colors[i] | "";
        if (!hex || !hex[0]) continue;
        uint8_t r, g, b;
        parseHexColor(hex, r, g, b);
        setSegColorSlot(seg, i, r, g, b);
        colorsApplied = true;
      }
      if (colorsApplied && !palSet) seg["pal"] = WLED_PAL_COLORS_ONLY;
    } else if (hasGlobalLook && globalLook.containsKey("col")) {
      copyGlobalColOntoSeg(seg, globalLook);
    }

    // Per-segment "borrow this preset's look" on a map def — unrelated to top-level
    // preset apply; keep accepting both "global" and legacy "wled".
    const char* presetId = def["presetId"] | "";
    if (presetId && presetId[0]) {
      String preset = getPreset(presetId);
      if (preset.length() > 0) {
        DynamicJsonDocument pdoc(8192);
        if (!deserializeJson(pdoc, preset)) {
          JsonObject pw;
          if (pdoc.containsKey("global")) pw = pdoc["global"].as<JsonObject>();
          else if (pdoc.containsKey("wled")) pw = pdoc["wled"].as<JsonObject>();
          if (!pw.isNull()) {
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
    }
    applyPresetVariables(seg, def["presetVariables"].as<JsonObject>());
  }
}

void applySegmentOverridesOntoWled(JsonObject wled, JsonObject segMap,
                                   JsonObject globalLook, bool hasGlobalLook,
                                   JsonObject segmentOverrides,
                                   JsonArray colorLibrary) {
  if (segmentOverrides.isNull() || segMap.isNull()) return;
  JsonArray defs = segMap["segments"].as<JsonArray>();
  if (defs.isNull()) return;
  int fallbackFx = hasGlobalLook ? (globalLook["fx"] | 0) : 0;
  if (fallbackFx < 0) fallbackFx = 0;

  auto isDefaultSentinel = [](JsonVariant v) -> bool {
    if (!v.is<const char*>()) return false;
    const char* s = v.as<const char*>();
    return s && strcmp(s, "d") == 0;
  };

  for (JsonVariant v : defs) {
    if (!v.is<JsonObject>()) continue;
    JsonObject def = v.as<JsonObject>();
    const char* localId = def["id"] | "";
    if (!localId[0] || !segmentOverrides.containsKey(localId)) continue;
    JsonObject ov = segmentOverrides[localId].as<JsonObject>();
    if (ov.isNull()) continue;
    JsonObject seg = ensureWledSegByLocalId(wled, def);

    auto applyFx = [&]() {
      if (!ov.containsKey("fx")) return;
      JsonVariant fxv = ov["fx"];
      if (fxv.is<JsonObject>()) {
        const char* mode = fxv["mode"] | "stored";
        if (strcmp(mode, "custom") == 0) {
          int fx = fxv["value"] | 0;
          seg["fx"] = fx >= 0 ? fx : 0;
        } else if (strcmp(mode, "default") == 0) {
          seg["fx"] = fallbackFx;
        }
      } else if (isDefaultSentinel(fxv)) {
        seg["fx"] = fallbackFx;
      } else {
        int fx = fxv.as<int>();
        seg["fx"] = fx >= 0 ? fx : 0;
      }
    };
    bool palSet = seg.containsKey("pal");
    auto applyPal = [&]() {
      if (!ov.containsKey("pal")) return;
      JsonVariant pv = ov["pal"];
      if (pv.is<JsonObject>()) {
        const char* mode = pv["mode"] | "stored";
        if (strcmp(mode, "custom") == 0) {
          int pal = pv["value"] | -1;
          if (pal >= 0) { seg["pal"] = pal; palSet = true; }
        } else if (strcmp(mode, "default") == 0 && hasGlobalLook) {
          int rpal = globalLook["pal"] | -1;
          if (rpal >= 0) { seg["pal"] = rpal; palSet = true; }
        }
      } else if (isDefaultSentinel(pv)) {
        if (hasGlobalLook) {
          int rpal = globalLook["pal"] | -1;
          if (rpal >= 0) { seg["pal"] = rpal; palSet = true; }
        }
      } else {
        int pal = pv.as<int>();
        if (pal >= 0) { seg["pal"] = pal; palSet = true; }
      }
    };
    auto applySx = [&]() {
      if (!ov.containsKey("sx")) return;
      JsonVariant sv = ov["sx"];
      if (sv.is<JsonObject>()) {
        const char* mode = sv["mode"] | "stored";
        if (strcmp(mode, "custom") == 0) seg["sx"] = sv["value"] | 128;
        else if (strcmp(mode, "default") == 0) {
          if (hasGlobalLook && globalLook.containsKey("sx")) seg["sx"] = globalLook["sx"];
          else seg["sx"] = 128;
        }
      } else if (isDefaultSentinel(sv)) {
        if (hasGlobalLook && globalLook.containsKey("sx")) seg["sx"] = globalLook["sx"];
        else seg["sx"] = 128;
      } else {
        seg["sx"] = sv.as<int>();
      }
    };
    auto applyIx = [&]() {
      if (!ov.containsKey("ix")) return;
      JsonVariant iv = ov["ix"];
      if (iv.is<JsonObject>()) {
        const char* mode = iv["mode"] | "stored";
        if (strcmp(mode, "custom") == 0) seg["ix"] = iv["value"] | 128;
        else if (strcmp(mode, "default") == 0) {
          if (hasGlobalLook && globalLook.containsKey("ix")) seg["ix"] = globalLook["ix"];
          else seg["ix"] = 128;
        }
      } else if (isDefaultSentinel(iv)) {
        if (hasGlobalLook && globalLook.containsKey("ix")) seg["ix"] = globalLook["ix"];
        else seg["ix"] = 128;
      } else {
        seg["ix"] = iv.as<int>();
      }
    };
    auto applyBlend = [&]() {
      if (!ov.containsKey("blend")) return;
      JsonVariant bv = ov["blend"];
      if (bv.is<JsonObject>()) {
        const char* mode = bv["mode"] | "stored";
        if (strcmp(mode, "custom") == 0) {
          if (bv["value"].is<int>()) seg["bm"] = bv["value"] | 0;
          else seg["bm"] = blendModeToBm(bv["value"] | "top");
        } else if (strcmp(mode, "default") == 0) {
          seg["bm"] = 0;
        }
      } else if (isDefaultSentinel(bv)) {
        seg["bm"] = 0;
      } else if (bv.is<int>()) {
        seg["bm"] = bv.as<int>();
      } else {
        seg["bm"] = blendModeToBm(bv.as<const char*>() ? bv.as<const char*>() : "top");
      }
    };
    auto applyIntCustom = [&](const char* key, int defVal, int maxVal) {
      if (!ov.containsKey(key)) return;
      JsonVariant vv = ov[key];
      int n = defVal;
      if (vv.is<JsonObject>()) {
        const char* mode = vv["mode"] | "stored";
        if (strcmp(mode, "custom") == 0) {
          // Don't use `|` — 0 is a valid custom value and would fall through to defVal.
          n = vv["value"].isNull() ? defVal : vv["value"].as<int>();
        } else if (strcmp(mode, "default") == 0) {
          n = defVal;
        } else {
          return; // stored
        }
      } else if (isDefaultSentinel(vv)) {
        n = defVal;
      } else if (vv.is<int>() || vv.is<float>()) {
        n = vv.as<int>();
      } else {
        return;
      }
      if (n < 0) n = 0;
      if (n > maxVal) n = maxVal;
      seg[key] = n;
    };
    auto applyBoolCustom = [&](const char* key, bool defVal) {
      if (!ov.containsKey(key)) return;
      JsonVariant vv = ov[key];
      bool b = defVal;
      if (vv.is<JsonObject>()) {
        const char* mode = vv["mode"] | "stored";
        if (strcmp(mode, "custom") == 0) {
          // Don't use `|` — false is a valid custom value.
          if (vv["value"].is<bool>()) b = vv["value"].as<bool>();
          else if (vv["value"].is<int>()) b = vv["value"].as<int>() != 0;
          else if (vv["value"].isNull()) b = defVal;
          else b = defVal;
        } else if (strcmp(mode, "default") == 0) {
          b = defVal;
        } else {
          return; // stored
        }
      } else if (isDefaultSentinel(vv)) {
        b = defVal;
      } else if (vv.is<bool>()) {
        b = vv.as<bool>();
      } else if (vv.is<int>()) {
        b = vv.as<int>() != 0;
      } else {
        return;
      }
      seg[key] = b;
    };

    applyFx();
    applyPal();
    applySx();
    applyIx();
    applyBlend();
    {
      int defC1 = 128, defC2 = 128, defC3 = 16;
      bool defO1 = false, defO2 = false, defO3 = false;
      if (hasGlobalLook) {
        if (globalLook.containsKey("c1")) defC1 = globalLook["c1"].as<int>();
        if (globalLook.containsKey("c2")) defC2 = globalLook["c2"].as<int>();
        if (globalLook.containsKey("c3")) defC3 = globalLook["c3"].as<int>();
        if (globalLook.containsKey("o1")) defO1 = globalLook["o1"].as<bool>();
        if (globalLook.containsKey("o2")) defO2 = globalLook["o2"].as<bool>();
        if (globalLook.containsKey("o3")) defO3 = globalLook["o3"].as<bool>();
      }
      applyIntCustom("c1", defC1, 255);
      applyIntCustom("c2", defC2, 255);
      applyIntCustom("c3", defC3, 31);
      applyBoolCustom("o1", defO1);
      applyBoolCustom("o2", defO2);
      applyBoolCustom("o3", defO3);
    }

    JsonArray ovColors = ov["colors"].as<JsonArray>();
    if (!ovColors.isNull()) {
      for (size_t idx = 0; idx < ovColors.size(); idx++) {
        if (!ovColors[idx].is<JsonObject>()) continue;
        JsonObject cOv = ovColors[idx].as<JsonObject>();
        int slot;
        String hexStr;
        const char* hex = nullptr;
        if (cOv.containsKey("v")) {
          // Compact wire: { i, v }
          slot = cOv.containsKey("i") ? (cOv["i"] | 0) : (int)idx;
          hex = cOv["v"] | "";
        } else {
          // Verbose editor: [{mode,value|swatchId}, ...] by array index
          const char* cmode = cOv["mode"] | "stored";
          if (strcmp(cmode, "custom") == 0 || strcmp(cmode, "swatch") == 0) {
            slot = (int)idx;
            if (resolveColorRefHex(cOv, colorLibrary, hexStr)) {
              hex = hexStr.c_str();
            } else if (strcmp(cmode, "custom") == 0) {
              hex = cOv["value"] | "";
            }
          } else if (strcmp(cmode, "default") == 0 && hasGlobalLook && globalLook.containsKey("col")) {
            JsonArray gcol = globalLook["col"].as<JsonArray>();
            if (!gcol.isNull() && (int)idx < (int)gcol.size()) {
              JsonArray rgb = gcol[idx].as<JsonArray>();
              if (!rgb.isNull() && rgb.size() >= 3) {
                setSegColorSlot(seg, (int)idx,
                                (uint8_t)(rgb[0] | 0), (uint8_t)(rgb[1] | 0), (uint8_t)(rgb[2] | 0));
              }
            }
            continue;
          } else {
            continue;
          }
        }
        if (!hex || !hex[0]) continue;
        uint8_t r, g, b;
        parseHexColor(hex, r, g, b);
        setSegColorSlot(seg, slot, r, g, b);
      }
      if (!palSet) seg["pal"] = WLED_PAL_COLORS_ONLY;
    }
  }
}

bool buildWledFromPresetDoc(JsonDocument& presetDoc, JsonDocument& outWledDoc) {
  JsonObject global = presetDoc["global"].as<JsonObject>();
  if (global.isNull()) global = presetDoc["wled"].as<JsonObject>();  // legacy fallback
  const char* mapId = presetDoc["segmentMapId"] | "";
  JsonVariant presetLedmap = presetDoc["ledmap"];
  JsonArray colorLibrary = presetDoc["colorLibrary"].as<JsonArray>();

  // Resolve colorRefs → col before seeding so segment defaults see RGB.
  if (!global.isNull()) materializeGlobalColorRefs(global, colorLibrary);

  JsonObject segMap;
  bool haveSegMap = false;
  if (strcmp(mapId, "__custom__") == 0) {
    segMap = presetDoc["customSegmentMap"].as<JsonObject>();
    haveSegMap = !segMap.isNull();
  } else if (mapId[0]) {
    segMap = findSegmentMapById(mapId);
    haveSegMap = !segMap.isNull();
  }

  if (haveSegMap) {
    JsonObject wled = outWledDoc.to<JsonObject>();
    seedWledFromSegmentMap(wled, segMap, global, !global.isNull());
    JsonObject segmentOverrides = presetDoc["segmentOverrides"].as<JsonObject>();
    if (!segmentOverrides.isNull()) {
      applySegmentOverridesOntoWled(
        wled, segMap, global, !global.isNull(), segmentOverrides, colorLibrary);
    }
    wled["ledmap"] = presetLedmap.is<int>()
      ? presetLedmap.as<int>()
      : (int)(segMap["ledmap"] | 0);
    return true;
  }

  // Map id set but not resolvable (missing shared/custom map), or map-less.
  if (mapId[0] && !haveSegMap) {
    if (global.isNull()) return false;
    if (deserializeJson(outWledDoc, global) != DeserializationError::Ok) return false;
    outWledDoc["ledmap"] = presetLedmap.is<int>() ? presetLedmap.as<int>() : 0;
    return true;
  }

  // Map-less: global / legacy wled is the flat capture path (§3.3).
  if (global.isNull()) return false;
  if (deserializeJson(outWledDoc, global) != DeserializationError::Ok) return false;
  outWledDoc["ledmap"] = presetLedmap.is<int>() ? presetLedmap.as<int>() : 0;
  return true;
}
