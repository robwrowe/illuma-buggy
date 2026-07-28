#include "PresetStore.h"
#include "Globals.h"
#include "WledClient.h"
#include "OverrideManager.h"
#include "MbRuleEngine.h"
#include "Config.h"

void savePreset(const String& id, const String& name, const String& wledJson,
                const String& segmentMapId) {
  prefs.begin("presets", false);
  String key = "p_" + id;
  String val = "{\"id\":\"" + id + "\",\"name\":\"" + name + "\"";
  if (segmentMapId.length() > 0) {
    val += ",\"segmentMapId\":\"" + segmentMapId + "\"";
  }
  val += ",\"wled\":" + wledJson + "}";
  prefs.putString(key.c_str(), val);
  String index = prefs.getString("index", "");
  if (index.indexOf(id) == -1) {
    if (index.length() > 0) index += ",";
    index += id;
    prefs.putString("index", index);
  }
  prefs.end();
  if (id == currentPresetId) currentPresetName = name;
}

String getPreset(const String& id) {
  prefs.begin("presets", true);
  String val = prefs.getString(("p_" + id).c_str(), "");
  prefs.end();
  return val;
}

String getPresetName(const String& id) {
  if (id.length() == 0) return "";
  String raw = getPreset(id);
  if (raw.length() == 0) return id;

  // First top-level "name":"…" (preset name comes before the large "wled" object).
  int from = 0;
  while (from < (int)raw.length()) {
    int key = raw.indexOf("\"name\"", from);
    if (key < 0) break;
    int colon = raw.indexOf(':', key + 6);
    if (colon < 0) break;
    int i = colon + 1;
    while (i < (int)raw.length() && (raw.charAt(i) == ' ' || raw.charAt(i) == '\t')) i++;
    if (i >= (int)raw.length() || raw.charAt(i) != '"') {
      from = key + 6;
      continue;
    }
    i++;
    int end = i;
    while (end < (int)raw.length()) {
      char c = raw.charAt(end);
      if (c == '\\') { end += 2; continue; }
      if (c == '"') break;
      end++;
    }
    if (end > i) {
      String name = raw.substring(i, end);
      if (name.length() > 0) return name;
    }
    from = key + 6;
  }
  return id;
}

void setCurrentPreset(const String& id) {
  currentPresetId = id;
  if (id.length() == 0) {
    currentPresetName = "";
    return;
  }
  currentPresetName = getPresetName(id);
}

String getAllPresets() {
  prefs.begin("presets", true);
  String index = prefs.getString("index", "");
  prefs.end();
  if (index.length() == 0) return "[]";
  String result = "[";
  int start = 0;
  bool first = true;
  while (start < (int)index.length()) {
    int comma = index.indexOf(',', start);
    String id = (comma == -1) ? index.substring(start) : index.substring(start, comma);
    String preset = getPreset(id);
    if (preset.length() > 0) {
      if (!first) result += ",";
      result += preset;
      first = false;
    }
    if (comma == -1) break;
    start = comma + 1;
  }
  return result + "]";
}

int countBoardPresets() {
  prefs.begin("presets", true);
  String index = prefs.getString("index", "");
  prefs.end();
  if (index.length() == 0) return 0;
  int count = 1;
  for (unsigned i = 0; i < index.length(); i++) {
    if (index.charAt(i) == ',') count++;
  }
  return count;
}

void deletePreset(const String& id) {
  prefs.begin("presets", false);
  prefs.remove(("p_" + id).c_str());
  String index = prefs.getString("index", "");
  String newIndex = "";
  int start = 0;
  while (start < (int)index.length()) {
    int comma = index.indexOf(',', start);
    String entry = (comma == -1) ? index.substring(start) : index.substring(start, comma);
    if (entry != id) {
      if (newIndex.length() > 0) newIndex += ",";
      newIndex += entry;
    }
    if (comma == -1) break;
    start = comma + 1;
  }
  prefs.putString("index", newIndex);
  prefs.end();
  if (id == currentPresetId) setCurrentPreset("");
}

// ─────────────────────────────────────────────
// WLED API
// ─────────────────────────────────────────────

bool applyPreset(const String& id) {
  String preset = getPreset(id);
  if (preset.length() == 0) {
    Serial.printf("[Preset] Not found: %s\n", id.c_str());
    return false;
  }
  DynamicJsonDocument doc(12288);
  if (deserializeJson(doc, preset)) {
    Serial.printf("[Preset] JSON parse failed for %s (%u bytes)\n", id.c_str(), (unsigned)preset.length());
    return false;
  }
  DynamicJsonDocument wledDoc(WLED_RESTORE_JSON_CAP);
  if (deserializeJson(wledDoc, doc["wled"]) != DeserializationError::Ok) return false;

  // Inherit device-global ledmap from the linked segment map (same lookup as rules).
  const char* mapId = doc["segmentMapId"] | "";
  if (mapId[0]) {
    JsonObject segMap = findSegmentMapById(mapId);
    if (!segMap.isNull()) {
      int ledmapId = segMap["ledmap"] | 0;
      if (ledmapId > 0) wledDoc["ledmap"] = ledmapId;
    }
  }

  String wledJson;
  serializeJson(wledDoc, wledJson);
  if (wledJson.length() == 0) return false;
  String payload = preparePresetApplyPayload(wledJson);
  // Single atomic POST — separate disable pass causes black flash between zone presets.
  bool ok = sendToWLEDForBleSolid(payload);
  if (ok) {
    setCurrentPreset(id);
    // Preset JSON is partial — don't overwrite full polled state used for MB restore.
    liveWledState = "";
    lastLiveStatePollMs = 0;
  }
  return ok;
}

bool setBrightness(int bri) {
  currentBrightness = bri;
  return sendToWLED("{\"bri\":" + String(bri) + "}");
}
