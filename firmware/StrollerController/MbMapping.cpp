#include "MbMapping.h"
#include "Globals.h"
#include "ColorPalette.h"

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

int mbSegKeyIndex(const char* key) {
  for (int i = 0; i < MB_SEG_KEY_COUNT; i++) if (strcmp(key, MB_SEG_KEYS[i]) == 0) return i;
  return -1;
}

MbSegMap& activeMbSegMap(int keyIdx) {
  if (mbLayoutCount == 0) {
    mbLayoutCount = 1;
    strncpy(mbLayouts[0].name, "Default", sizeof(mbLayouts[0].name) - 1);
  }
  uint8_t idx = mbActiveLayoutIdx < mbLayoutCount ? mbActiveLayoutIdx : 0;
  return mbLayouts[idx].segMaps[keyIdx];
}
