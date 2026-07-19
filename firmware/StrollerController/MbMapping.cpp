#include "MbMapping.h"
#include "Globals.h"
#include "ColorPalette.h"
#include "PresetStore.h"

void loadMbMappingDefaults() {
  memcpy(mbWledColors, MB_DEFAULT_COLORS, sizeof(mbWledColors));
  mbLayoutCount = 1;
  mbActiveLayoutIdx = 0;
  strncpy(mbLayouts[0].name, "Default", sizeof(mbLayouts[0].name) - 1);
  mbLayouts[0].name[sizeof(mbLayouts[0].name) - 1] = '\0';
  const uint16_t defs[][2] = {
    {0,100},{35,65},{0,35},{0,25},{25,50},{50,75},{75,100},{48,52},
    {0,20},{20,40},{40,60},{60,80},{80,100},
    {80,87},{87,94},{94,100}
  };
  for (int i = 0; i < MB_SEG_KEY_COUNT; i++) {
    mbLayouts[0].segMaps[i].count = 1;
    mbLayouts[0].segMaps[i].refs[0] = { (uint8_t)(i == 2 ? 2 : i), defs[i][0], defs[i][1] };
    if (i == 2) {
      mbLayouts[0].segMaps[i].count = 2;
      mbLayouts[0].segMaps[i].refs[0] = { 2, 0, 35 };
      mbLayouts[0].segMaps[i].refs[1] = { 3, 65, 100 };
    }
  }
  for (int i = 0; i < 8; i++) { mbAnimMap[i].presetId = ""; mbAnimMap[i].wledPayload = ""; mbAnimMap[i].colorSlotCount = 0; }
  for (int i = 0; i < SW_ANIM_COUNT; i++) { swAnimMap[i].presetId = ""; swAnimMap[i].wledPayload = ""; swAnimMap[i].colorSlotCount = 0; }
  for (int i = 0; i < 5; i++) { mbPatMap[i].presetId = ""; mbPatMap[i].wledPayload = ""; mbPatMap[i].colorSlotCount = 0; }
  loadMbRandomPoolDefaults();
}

void loadMbMappingFromJson() {
  bleDefaultPresetId = "";
  if (mbMappingJson.length() == 0) return;

  DynamicJsonDocument doc(12288);
  if (deserializeJson(doc, mbMappingJson)) return;
  applyMbMappingJson(doc.as<JsonObject>());
}

void applyMbMappingJson(JsonObject doc) {
  bleDefaultPresetId = doc["defaultPresetId"] | "";

  if (doc.containsKey("colors")) {
    JsonObject colors = doc["colors"];
    for (JsonPair kv : colors) {
      int idx = atoi(kv.key().c_str());
      if (idx < 0 || idx > 31) continue;
      JsonArray rgb = kv.value().as<JsonArray>();
      if (rgb.isNull() || rgb.size() < 3) continue;
      mbWledColors[idx][0] = (uint8_t)rgb[0].as<int>();
      mbWledColors[idx][1] = (uint8_t)rgb[1].as<int>();
      mbWledColors[idx][2] = (uint8_t)rgb[2].as<int>();
    }
  }
  if (doc.containsKey("segments")) {
    JsonObject segs = doc["segments"];
    if (mbLayoutCount == 0) {
      mbLayoutCount = 1;
      strncpy(mbLayouts[0].name, "Default", sizeof(mbLayouts[0].name) - 1);
      mbLayouts[0].name[sizeof(mbLayouts[0].name) - 1] = '\0';
    }
    for (int i = 0; i < MB_SEG_KEY_COUNT; i++) {
      if (!segs.containsKey(MB_SEG_KEYS[i])) continue;
      parseSegMapArray(segs[MB_SEG_KEYS[i]].as<JsonArray>(), mbLayouts[0].segMaps[i]);
    }
  }
  if (doc.containsKey("animations")) {
    JsonObject anims = doc["animations"];
    for (int i = 0; i < 8; i++) {
      if (anims.containsKey(MB_ANIM_KEYS[i])) parseEffectMap(anims[MB_ANIM_KEYS[i]], mbAnimMap[i]);
    }
  }
  if (doc.containsKey("swAnimations")) {
    JsonObject swAnims = doc["swAnimations"];
    for (int i = 0; i < SW_ANIM_COUNT; i++) {
      if (swAnims.containsKey(SW_ANIM_KEYS[i])) parseEffectMap(swAnims[SW_ANIM_KEYS[i]], swAnimMap[i]);
    }
  } else if (doc.containsKey("animations")) {
    JsonObject anims = doc["animations"];
    if (anims.containsKey("wand")) parseEffectMap(anims["wand"], swAnimMap[9]);
  }
  if (doc.containsKey("patterns")) {
    JsonObject pats = doc["patterns"];
    for (int i = 0; i < 5; i++) {
      if (pats.containsKey(MB_PAT_KEYS[i])) parseEffectMap(pats[MB_PAT_KEYS[i]], mbPatMap[i]);
    }
  }
  loadMbRandomPoolDefaults();
  if (doc.containsKey("randomPool")) {
    JsonObject rp = doc["randomPool"];
    if (rp.containsKey("palettes")) {
      mbRandomPoolCount = 0;
      for (JsonVariant v : rp["palettes"].as<JsonArray>()) {
        uint8_t idx = (uint8_t)(v.as<int>() & 0x1F);
        if (!mbPaletteEligibleForRandom(idx)) continue;
        if (mbRandomPoolCount >= MB_MAX_RANDOM_POOL) break;
        mbRandomPool[mbRandomPoolCount++] = idx;
      }
    }
    if (rp.containsKey("custom")) {
      mbRandomCustomCount = 0;
      for (JsonVariant v : rp["custom"].as<JsonArray>()) {
        if (!v.is<JsonObject>() || mbRandomCustomCount >= MB_MAX_RANDOM_CUSTOM) break;
        JsonArray rgb = v["rgb"].as<JsonArray>();
        if (rgb.isNull() || rgb.size() < 3) continue;
        mbRandomCustom[mbRandomCustomCount][0] = (uint8_t)rgb[0].as<int>();
        mbRandomCustom[mbRandomCustomCount][1] = (uint8_t)rgb[1].as<int>();
        mbRandomCustom[mbRandomCustomCount][2] = (uint8_t)rgb[2].as<int>();
        mbRandomCustomCount++;
      }
    }
  }
}

void parseEffectMap(JsonObject obj, MbEffectMap& out) {
  out.presetId = obj["presetId"] | "";
  out.wledPayload = "";
  if (obj.containsKey("wled")) {
    serializeJson(obj["wled"], out.wledPayload);
  }
  out.colorSlotCount = 0;
  if (obj.containsKey("colorSlots")) {
    for (JsonVariant v : obj["colorSlots"].as<JsonArray>()) {
      if (out.colorSlotCount >= MB_MAX_COLOR_SLOTS) break;
      out.colorSlots[out.colorSlotCount++] = (uint8_t)(v.as<int>() & 0x1F);
    }
  }
}

void parseSegMapArray(JsonArray arr, MbSegMap& out) {
  out.count = 0;
  for (JsonVariant v : arr) {
    if (!v.is<JsonObject>() || out.count >= MB_MAX_SEG_REFS) continue;
    JsonObject r = v;
    uint16_t start = (uint16_t)r["start"].as<int>();
    uint16_t stop  = (uint16_t)r["stop"].as<int>();
    if (stop <= start || stop > STRIP_LED_COUNT) continue;
    WledSegRef ref;
    ref.id    = (uint8_t)r["id"].as<int>();
    ref.start = start;
    ref.stop  = stop;
    ref.grp   = r.containsKey("grp") ? (uint8_t)r["grp"].as<int>() : 1;
    ref.spc   = r.containsKey("spc") ? (uint8_t)r["spc"].as<int>() : 0;
    ref.of    = r.containsKey("of")  ? (int16_t)r["of"].as<int>() : 0;
    ref.rev   = r["rev"] | false;
    ref.mi    = r["mi"]  | false;
    ref.fx    = r.containsKey("fx")  ? r["fx"].as<int>() : -1;
    ref.sx    = r.containsKey("sx")  ? (uint8_t)r["sx"].as<int>() : 128;
    ref.ix    = r.containsKey("ix")  ? (uint8_t)r["ix"].as<int>() : 128;
    ref.pal   = r.containsKey("pal") ? r["pal"].as<int>() : -1;
    out.refs[out.count++] = ref;
  }
}

void loadMbLayoutsFromJson() {
  if (mbLayoutsJson.length() == 0) return;
  DynamicJsonDocument doc(16384);
  if (deserializeJson(doc, mbLayoutsJson)) return;
  JsonArray layoutsArr = doc.as<JsonArray>();
  if (layoutsArr.isNull()) return;
  mbLayoutCount = 0;
  for (JsonObject lo : layoutsArr) {
    if (mbLayoutCount >= MB_MAX_LAYOUTS) break;
    MbSegmentLayout& layout = mbLayouts[mbLayoutCount];
    strncpy(layout.name, lo["name"] | "Layout", sizeof(layout.name) - 1);
    layout.name[sizeof(layout.name) - 1] = '\0';
    JsonObject segs = lo["segments"];
    for (int i = 0; i < MB_SEG_KEY_COUNT; i++) {
      layout.segMaps[i].count = 0;
      if (segs.containsKey(MB_SEG_KEYS[i])) {
        parseSegMapArray(segs[MB_SEG_KEYS[i]].as<JsonArray>(), layout.segMaps[i]);
      }
    }
    mbLayoutCount++;
  }
  if (mbLayoutCount == 0) return;
  if (mbActiveLayoutIdx >= mbLayoutCount) mbActiveLayoutIdx = 0;
}

String resolveEffectPresetId(const MbEffectMap& map) {
  if (map.presetId.length() > 0) return map.presetId;
  return bleDefaultPresetId;
}

int mbSegKeyIndex(const char* key) {
  for (int i = 0; i < MB_SEG_KEY_COUNT; i++) if (strcmp(key, MB_SEG_KEYS[i]) == 0) return i;
  return -1;
}

bool loadEffectMapWled(const MbEffectMap& map, DynamicJsonDocument& wled) {
  if (map.wledPayload.length() > 0) {
    if (deserializeJson(wled, map.wledPayload)) return false;
    Serial.printf("[BLE] Using embedded wled (%u bytes, preset=%s)\n",
                  (unsigned)map.wledPayload.length(),
                  map.presetId.length() ? map.presetId.c_str() : "(inline)");
    return true;
  }
  String presetId = resolveEffectPresetId(map);
  if (presetId.length() == 0) return false;
  String preset = getPreset(presetId);
  if (preset.length() == 0) {
    Serial.printf("[BLE] Preset not found on board: %s\n", presetId.c_str());
    return false;
  }
  DynamicJsonDocument doc(12288);
  if (deserializeJson(doc, preset)) return false;
  if (deserializeJson(wled, doc["wled"])) return false;
  return true;
}

MbSegMap& activeMbSegMap(int keyIdx) {
  if (mbLayoutCount == 0) {
    mbLayoutCount = 1;
    strncpy(mbLayouts[0].name, "Default", sizeof(mbLayouts[0].name) - 1);
  }
  uint8_t idx = mbActiveLayoutIdx < mbLayoutCount ? mbActiveLayoutIdx : 0;
  return mbLayouts[idx].segMaps[keyIdx];
}

