#include "WledClient.h"
#include "Globals.h"

bool sendToWLED(const String& jsonBody, int timeoutMs, int retries) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WLED] WiFi not connected");
    return false;
  }
  HTTPClient http;
  http.begin("http://" + wledIp + ":" + String(wledPort) + "/json/state");
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(timeoutMs);
  int code = -1;
  for (int attempt = 0; attempt <= retries; attempt++) {
    code = http.POST(jsonBody);
    if (code == 200) {
      http.end();
      return true;
    }
    if (attempt < retries) delay(80);
  }
  Serial.printf("[WLED] POST failed: HTTP %d (%u bytes)\n", code, (unsigned)jsonBody.length());
  if (jsonBody.length() < 120) {
    Serial.printf("[WLED]   body: %s\n", jsonBody.c_str());
  }
  http.end();
  return false;
}

String injectWledTransition(const String& jsonBody, unsigned long transitionMs) {
  if (transitionMs == 0 || jsonBody.length() < 2 || jsonBody.charAt(0) != '{') return jsonBody;
  unsigned tenths = transitionMs / 100;
  if (tenths == 0) tenths = 1;
  if (tenths > 655) tenths = 655;
  return "{\"transition\":" + String(tenths) + "," + jsonBody.substring(1);
}

bool sendToWLEDForBleEffect(const String& jsonBody) {
  return sendToWLED(injectWledTransition(jsonBody, bleEffectTransitionMs));
}

bool sendToWLEDForBleSolid(const String& jsonBody) {
  return sendToWLED(injectWledTransition(jsonBody, 0));
}

String getFromWLED(const String& path) {
  if (WiFi.status() != WL_CONNECTED) return "";
  HTTPClient http;
  http.begin("http://" + wledIp + ":" + String(wledPort) + path);
  http.setTimeout(5000);
  int code = http.GET();
  String body = "";
  if (code == 200) {
    body = http.getString();
  } else {
    Serial.printf("[WLED] GET %s failed: %d\n", path.c_str(), code);
  }
  http.end();
  return body;
}

String compactWledStateForSave(const String& full) {
  DynamicJsonDocument in(WLED_RESTORE_JSON_CAP);
  if (deserializeJson(in, full) != DeserializationError::Ok) return full;

  DynamicJsonDocument out(WLED_RESTORE_JSON_CAP);
  out["on"] = in["on"] | true;
  if (in.containsKey("bri")) out["bri"] = in["bri"];
  if (in.containsKey("nl")) out["nl"] = in["nl"];
  if (in.containsKey("fp")) out["fp"] = in["fp"];

  JsonArray inSegs = in["seg"].as<JsonArray>();
  if (!inSegs.isNull() && inSegs.size() > 0) {
    JsonArray outSegs = out.createNestedArray("seg");
    static const char* segKeys[] = {
      "id", "start", "stop", "len", "grp", "spc", "of", "on", "bri",
      "fx", "pal", "sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3",
      "col", "mi", "rev", "sel", "bm",
    };
    for (JsonObject segIn : inSegs) {
      int stop = segIn["stop"] | 0;
      if (stop <= 0) continue;
      JsonObject segOut = outSegs.createNestedObject();
      for (const char* k : segKeys) {
        if (segIn.containsKey(k)) segOut[k] = segIn[k];
      }
      if (!segOut.containsKey("id")) segOut["id"] = outSegs.size() - 1;
    }
  } else {
    static const char* rootKeys[] = {
      "fx", "pal", "sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3", "col",
      "mi", "of", "grp", "spc", "bm", "rev",
    };
    for (const char* k : rootKeys) {
      if (in.containsKey(k)) out[k] = in[k];
    }
  }

  String compact;
  serializeJson(out, compact);
  return compact.length() > 0 ? compact : full;
}

void snapshotWledBaseline() {
  String state = getFromWLED("/json/state");
  if (state.length() == 0) {
    Serial.println("[WLED] Baseline snapshot failed (GET /json/state)");
    return;
  }

  baselineWledState = compactWledStateForSave(state);
  liveWledState = baselineWledState;

  DynamicJsonDocument doc(12288);
  DeserializationError err = deserializeJson(doc, state);
  if (!err) {
    if (doc.containsKey("bri")) {
      currentBrightness = doc["bri"].as<int>();
    }
  }

  prefs.begin("config", false);
  prefs.putString("wledBase", baselineWledState);
  prefs.end();

  Serial.printf("[WLED] Baseline snapshot (%u bytes, bri=%d)\n",
                (unsigned)baselineWledState.length(), currentBrightness);
}

void loadWledBaselineFromNvs() {
  prefs.begin("config", true);
  String loaded = prefs.getString("wledBase", "");
  prefs.end();
  if (loaded.length() == 0) return;

  baselineWledState = loaded;
  DynamicJsonDocument doc(12288);
  if (!deserializeJson(doc, loaded)) {
    if (doc.containsKey("bri")) {
      currentBrightness = doc["bri"].as<int>();
    }
  }
  Serial.printf("[WLED] Loaded baseline from NVS (%u bytes, bri=%d)\n",
                (unsigned)baselineWledState.length(), currentBrightness);
}

void ensureWledPowerOn() {
  DynamicJsonDocument doc(12288);
  if (baselineWledState.length() > 0 &&
      deserializeJson(doc, baselineWledState) == DeserializationError::Ok) {
    if (!doc["on"].as<bool>()) {
      sendToWLED("{\"on\":true}");
      Serial.println("[WLED] Master power was off — sent on:true (relay)");
    }
    return;
  }
  sendToWLED("{\"on\":true}");
}

// ─────────────────────────────────────────────
// WLED EFFECTS — full-strip MagicBand chase / wand solid
// Only PATCH segment 0 — never send stop:0 on other segments (destroys WLED layout)
// ─────────────────────────────────────────────

String buildSeg0JsonBody(const String& seg0Inner) {
  return "\"seg\":[{\"id\":0," + seg0Inner + "}]";
}

