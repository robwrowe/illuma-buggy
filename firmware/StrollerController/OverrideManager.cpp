#include "OverrideManager.h"
#include "Globals.h"
#include "WledClient.h"
#include "PresetStore.h"
#include "MbEffects.h"
#include "BlePeripheral.h"
#include "DisneyPayloadHandlers.h"
#include "MbRuleEngine.h"

void touchOverrideIdleTimer(OverrideSource src) {
  unsigned long now = millis();
  if (src == BLE_MAGIC) mbEventTimestamp = now;
  else if (src == BLE_STARLIGHT) swEventTimestamp = now;
}

int overridePriority(OverrideSource src) {
  switch (src) {
    case ZONE:          return 1;
    case MANUAL:        return 2;
    case SHOW_MODE:     return 3;
    case BLE_STARLIGHT: return 4;
    case BLE_MAGIC:     return 5;
    default:            return 0;
  }
}

bool canTakeOverride(OverrideSource incoming) {
  if (incoming == NONE) return false;
  if (currentOverride == NONE) return true;
  return overridePriority(incoming) >= overridePriority(currentOverride);
}

void setOverride(OverrideSource src) {
  if (currentOverride == SHOW_MODE && (src == BLE_MAGIC || src == BLE_STARLIGHT)) {
    overrideBeforeInterrupt = SHOW_MODE;
  }
  currentOverride = src;
  overrideTimestamp = millis();
  if (src == BLE_MAGIC && pendingMbEffectPayload && pendingMbEffectPayloadLen > 0) {
    rememberMbEffect(pendingMbEffectPayload, pendingMbEffectPayloadLen);
  }
  Serial.printf("[Override] Set to %d\n", (int)src);
}

void saveWledStateForOverride() {
  if (savedWledState.length() > 0) return;

  if (savedRestoreOverride == NONE && savedRestorePresetId.length() == 0) {
    savedRestoreOverride = currentOverride;
    if (savedRestoreOverride == BLE_MAGIC || savedRestoreOverride == BLE_STARLIGHT ||
        savedRestoreOverride == SHOW_MODE) {
      savedRestoreOverride = NONE;
    }
    if ((currentOverride == ZONE || currentOverride == MANUAL) && currentPresetId.length() > 0) {
      savedRestorePresetId = currentPresetId;
    }
  }

  // Do NOT synchronously poll WLED here — this runs on the hot rule-apply /
  // override path under active BLE/ESP-NOW load. A blocking GET (default 5s)
  // stalls loop(), starves the packet queue, and can hang long enough that
  // "[Rule] posting WLED" never appears. Use whatever is already cached
  // (liveWledState from the periodic poll, or the boot baseline).
  if (liveWledState.length() > 0) {
    savedWledState = liveWledState;
    Serial.printf("[Override] Saved snapshot (%u bytes, preset_fallback=%s)\n",
                  (unsigned)savedWledState.length(),
                  savedRestorePresetId.length() > 0 ? savedRestorePresetId.c_str() : "none");
    return;
  }

  if (baselineWledState.length() > 0) {
    savedWledState = baselineWledState;
    Serial.println("[Override] Saved baseline snapshot (no live poll yet)");
  } else {
    Serial.println("[Override] WARNING: no WLED snapshot available to restore");
  }
}

// WLED merges POST /json/state by segment id. Split segments are torn down in a separate

String buildWledRestorePayload(const String& savedJson) {
  DynamicJsonDocument doc(WLED_RESTORE_JSON_CAP);
  if (deserializeJson(doc, savedJson) != DeserializationError::Ok) {
    Serial.println("[Override] Restore JSON parse failed — posting raw snapshot");
    return savedJson;
  }

  doc.remove("transition");

  JsonArray segs = doc["seg"].as<JsonArray>();
  if (!segs.isNull()) {
    for (size_t i = 0; i < segs.size(); i++) {
      JsonObject seg = segs[i];
      if (!seg.containsKey("id")) seg["id"] = (int)i;
    }
  }

  String out;
  serializeJson(doc, out);
  if (out.length() == 0) return savedJson;
  Serial.printf("[Override] Restore payload (%u bytes, %u seg entries)\n",
                (unsigned)out.length(), segs.isNull() ? 0U : (unsigned)segs.size());
  return out;
}

String prepareWledRestorePayload(const String& json) {
  DynamicJsonDocument doc(WLED_RESTORE_JSON_CAP);
  if (deserializeJson(doc, json) != DeserializationError::Ok) {
    return buildWledRestorePayload(json);
  }

  doc.remove("transition");

  JsonArray segs = doc["seg"].as<JsonArray>();
  if (segs.isNull() || segs.size() == 0) {
    DynamicJsonDocument wrapped(WLED_RESTORE_JSON_CAP);
    wrapped["on"] = doc["on"] | true;
    JsonObject seg0 = wrapped.createNestedArray("seg").createNestedObject();
    seg0["id"] = 0;
    seg0["start"] = 0;
    seg0["stop"] = STRIP_LED_COUNT;
    static const char* moveKeys[] = {
      "fx", "pal", "sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3", "col",
      "mi", "of", "grp", "spc", "bm", "rev",
    };
    for (const char* k : moveKeys) {
      if (doc.containsKey(k)) seg0[k] = doc[k];
    }
    String normalized;
    serializeJson(wrapped, normalized);
    return buildWledRestorePayload(normalized);
  }

  for (size_t i = 0; i < segs.size(); i++) {
    JsonObject seg = segs[i];
    if (!seg.containsKey("id")) seg["id"] = (int)i;
  }

  String normalized;
  serializeJson(doc, normalized);
  return buildWledRestorePayload(normalized);
}

String preparePresetApplyPayload(const String& json) {
  String restored = prepareWledRestorePayload(json);
  DynamicJsonDocument doc(WLED_RESTORE_JSON_CAP);
  if (deserializeJson(doc, restored) != DeserializationError::Ok) return restored;

  // GLEDOPTO relay (GPIO 18) cuts output when master power is off. Always force on
  // in the same POST as the effect — a prior ensureWledPowerOn() can fail/timeout
  // under BLE+scan load and leave the strip dark while seg/fx still "apply".
  doc["on"] = true;

  JsonArray segs = doc["seg"].as<JsonArray>();
  if (segs.isNull() || segs.size() == 0) {
    // Brightness is app-managed — never from preset apply.
    doc.remove("bri");
    String out;
    serializeJson(doc, out);
    return out.length() ? out : restored;
  }

  bool activeIds[MB_WLED_MAX_SEG] = {false};
  for (JsonObject seg : segs) {
    int id = seg["id"] | 0;
    int start = seg["start"] | 0;
    int stop = seg["stop"] | 0;
    if (id >= 0 && id < MB_WLED_MAX_SEG && stop > start) activeIds[id] = true;
  }
  for (uint8_t id = 0; id < MB_WLED_MAX_SEG; id++) {
    if (!activeIds[id]) {
      JsonObject d = doc["seg"].createNestedObject();
      d["id"] = id;
      d["stop"] = 0;
    }
  }
  // Brightness is app-managed (solar / indoor / manual slider) — never from preset apply.
  doc.remove("bri");
  String out;
  serializeJson(doc, out);
  return out;
}

bool restoreWledSnapshot(const String& json, unsigned long fadeMs, bool dipToBlackFirst) {
  if (json.length() == 0) return false;
  if (dipToBlackFirst && fadeMs > 0) {
    sendToWLED(injectWledTransition("{\"on\":false}", fadeMs));
    delay(fadeMs + 100);
  }
  disableAllSplitSegments();
  String payload = injectWledTransition(buildWledRestorePayload(json), fadeMs);
  return sendToWLED(payload, 8000, 2);
}

bool restorePresetWithTransitionStyled(const String& id, unsigned long fadeMs, int blendingStyle) {
  String preset = getPreset(id);
  if (preset.length() == 0) return false;
  DynamicJsonDocument doc(12288);
  if (deserializeJson(doc, preset)) return false;
  String wledJson;
  serializeJson(doc["wled"], wledJson);
  if (wledJson.length() == 0) return false;
  currentPresetId = id;
  disableAllSplitSegments();
  String payload = injectWledTransition(
    buildWledRestorePayload(prepareWledRestorePayload(wledJson)),
    fadeMs, blendingStyle);
  return sendToWLED(payload, 8000, 2);
}

bool restorePresetWithTransition(const String& id, unsigned long fadeMs) {
  return restorePresetWithTransitionStyled(id, fadeMs, -1);
}

void applyShowPhaseLook(ShowType type, ShowPhase phase, unsigned long fadeMs) {
  // LIVE is blackout-only: turn lights off once on enter so the rule engine can drive
  // effects without fighting a competing "live look" preset push.
  if (phase == PHASE_BLACK || phase == PHASE_LIVE) {
    sendToWLED(injectWledTransition("{\"on\":false}", fadeMs));
    return;
  }
  String presetId;
  if (type == SHOW_PARADE) {
    presetId = showLookParadePre;  // PRE only; LIVE handled above
  } else if (type == SHOW_FIREWORKS) {
    if (phase == PHASE_PRE) presetId = showLookFireworksPre;
    else presetId = showLookFireworksPost;  // POST; LIVE handled above
  }
  if (presetId == "__BLACK__") {
    sendToWLED(injectWledTransition("{\"on\":false}", fadeMs));
    return;
  }
  if (presetId.length() == 0) return;

  String preset = getPreset(presetId);
  if (preset.length() == 0) return;
  DynamicJsonDocument doc(2048);
  if (deserializeJson(doc, preset)) return;
  String wledJson;
  serializeJson(doc["wled"], wledJson);
  currentPresetId = presetId;
  sendToWLED(injectWledTransition(prepareWledRestorePayload(wledJson), fadeMs));
  if (wledJson.length() > 0) liveWledState = wledJson;
}

const char* showTypeStatusStr() {
  if (showModeType == SHOW_PARADE) return "parade";
  if (showModeType == SHOW_FIREWORKS) return "fireworks";
  return "";
}

const char* showPhaseStatusStr() {
  switch (showModePhase) {
    case PHASE_PRE:   return "pre";
    case PHASE_BLACK: return "black";
    case PHASE_LIVE:  return "live";
    case PHASE_POST:  return "post";
    default:          return "";
  }
}

void pollLiveWledState() {
  if (currentOverride != NONE) return;
  if (WiFi.status() != WL_CONNECTED) return;
  unsigned long now = millis();
  if (now - lastLiveStatePollMs < LIVE_STATE_POLL_MS) return;
  lastLiveStatePollMs = now;
  // Background poll: fail fast so a slow/unreachable WLED cannot stall loop()
  // and starve the ESP-NOW → rule-engine packet queue.
  String state = getFromWLED("/json/state", 500);
  if (state.length() > 0) {
    liveWledState = compactWledStateForSave(state);
    Serial.printf("[WLED] Live state poll (%u bytes)\n", (unsigned)liveWledState.length());
  }
}

void clearOverride() {
  OverrideSource prev = currentOverride;
  unsigned long fadeMs = (prev == BLE_MAGIC || prev == BLE_STARLIGHT) ? bleEffectTransitionMs : 0;

  // Timed rule lifecycle ends with clearOverride — avoid double-reset from serviceMbRuleLifecycle.
  if (mbRulePhase != MB_RULE_IDLE && prev == BLE_MAGIC) {
    // Keep fade duration from the rule when we're finishing COOLDOWN via serviceMbRuleLifecycle
    // (already faded). For external clears, reset phase tracking.
  }
  resetMbRuleLifecycle();

  if (overrideBeforeInterrupt == SHOW_MODE && (prev == BLE_MAGIC || prev == BLE_STARLIGHT)) {
    overrideBeforeInterrupt = NONE;
    currentOverride = SHOW_MODE;
    overrideTimestamp = millis();
    applyShowPhaseLook(showModeType, showModePhase, fadeMs);
    return;
  }

  OverrideSource restoreOverride = savedRestoreOverride;
  String presetId = savedRestorePresetId;
  String snapshot = savedWledState;

  currentOverride = NONE;
  savedWledState = "";
  savedRestorePresetId = "";
  savedRestoreOverride = NONE;

  Serial.println("[Override] Cleared");

  bool dipToBlack = (prev == BLE_MAGIC || prev == BLE_STARLIGHT) && fadeMs > 0;
  bool restored = false;
  if (snapshot.length() > 0) {
    restored = restoreWledSnapshot(prepareWledRestorePayload(snapshot), fadeMs, dipToBlack);
    if (restored) {
      Serial.printf("[Override] Restored snapshot (%u bytes)\n", (unsigned)snapshot.length());
    } else {
      Serial.printf("[Override] Snapshot restore POST failed (%u bytes)\n", (unsigned)snapshot.length());
    }
  }
  if (!restored && presetId.length() > 0) {
    if (dipToBlack) {
      sendToWLED(injectWledTransition("{\"on\":false}", fadeMs));
      delay(fadeMs + 100);
    }
    restored = restorePresetWithTransition(presetId, fadeMs);
    if (restored) {
      Serial.printf("[Override] Restored preset: %s\n", presetId.c_str());
    } else {
      Serial.printf("[Override] Preset restore failed: %s\n", presetId.c_str());
    }
  }
  if (!restored && baselineWledState.length() > 0) {
    restored = restoreWledSnapshot(prepareWledRestorePayload(baselineWledState), fadeMs);
    if (restored) {
      Serial.println("[Override] Restored baseline WLED state");
    } else {
      Serial.println("[Override] Baseline restore POST failed");
    }
  }
  if (!restored) {
    Serial.println("[Override] Restore failed — strip may stay on last MB effect");
  } else {
    if (snapshot.length() > 0) {
      liveWledState = snapshot;
    } else if (baselineWledState.length() > 0) {
      liveWledState = baselineWledState;
    } else {
      liveWledState = "";
      lastLiveStatePollMs = 0;
    }
    if (liveWledState.length() > 0) lastLiveStatePollMs = millis();
  }

  if (restored && (restoreOverride == ZONE || restoreOverride == MANUAL)) {
    setOverride(restoreOverride);
  } else if (restored && presetId.length() > 0) {
    setOverride(restoreOverride == MANUAL ? MANUAL : ZONE);
  }
}

bool zoneWantsPreset(const String& presetId) {
  if (presetId.length() == 0) {
    Serial.println("[Zone] Boundary-only zone (no preset)");
    return false;
  }
  if (currentOverride == BLE_STARLIGHT || currentOverride == BLE_MAGIC) {
    if (!overrideKillOnZone) {
      Serial.println("[Zone] Blocked by active override");
      return false;
    }
    clearOverride();
  } else if (currentOverride == MANUAL || currentOverride == SHOW_MODE) {
    // App only sends zone_trigger when GPS zone logic should run (not during in-scope show).
    clearOverride();
  }
  setOverride(ZONE);
  return applyPreset(presetId);
}

// ─────────────────────────────────────────────
// BLE COMMAND HANDLER
// ─────────────────────────────────────────────

