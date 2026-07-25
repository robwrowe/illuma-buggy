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
}

String getPreset(const String& id) {
  prefs.begin("presets", true);
  String val = prefs.getString(("p_" + id).c_str(), "");
  prefs.end();
  return val;
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
  currentPresetId = id;
  String payload = preparePresetApplyPayload(wledJson);
  // Single atomic POST — separate disable pass causes black flash between zone presets.
  bool ok = sendToWLEDForBleSolid(payload);
  if (ok) {
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
