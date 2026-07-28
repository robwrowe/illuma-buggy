#include "BleCommandHandler.h"
#include "Globals.h"
#include "BlePeripheral.h"
#include "PresetStore.h"
#include "WledClient.h"
#include "OverrideManager.h"
#include "MbMapping.h"
#include "MbRuleEngine.h"
#include "ColorPalette.h"
#include "WiFiManager.h"
#include "DebugLog.h"
#include "WandTx.h"
#include "PayloadTransport.h"
#include "Config.h"
#include "NvsLargeString.h"
#include "DisneyBleScan.h"
#include "MbRulesStore.h"
#include "MbCalibrationStore.h"
#include "RuntimeFields.h"
#include "SdRuleLogger.h"
#include <WiFi.h>
#include "JsonPsram.h"

void handleBLECommand(const String& msg) {
  // Large set_mb_rules bodies parse on PSRAM so we do not pin ~128KB of internal SRAM.
#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc(&jsonPsramAllocator());
#else
  size_t cap = msg.length() + 512;
  if (cap < 4096) cap = 4096;
  if (cap > BLE_JSON_DOC_SIZE) cap = BLE_JSON_DOC_SIZE;
  PsramJsonDocument doc(cap);
#endif
  DeserializationError err = deserializeJson(doc, msg, DeserializationOption::NestingLimit(32));
  if (err) {
    Serial.printf("[BLE] JSON parse error: %s\n", err.c_str());
    return;
  }

  String type = doc["type"].as<String>();

  if (type == "ble_cmd_chunk") {
    processBleCmdChunk(doc["seq"].as<int>(), doc["last"].as<bool>(), doc["data"].as<String>());
    return;
  }

  // ── Preset management ──
  if (type == "preset_save") {
    String id = doc["id"].as<String>();
    String name = doc["name"].as<String>();
    String wled; serializeJson(doc["wled"], wled);
    String segmentMapId = doc["segmentMapId"] | "";
    savePreset(id, name, wled, segmentMapId);
    bleNotify("{\"type\":\"ack\",\"action\":\"preset_save\",\"id\":\"" + id + "\"}");
  }
  else if (type == "preset_apply") {
    String id = doc["id"].as<String>();
    if (!canTakeOverride(MANUAL)) {
      Serial.println("[Preset] Blocked by higher-priority override");
      bleNotify("{\"type\":\"ack\",\"action\":\"preset_apply\",\"id\":\"" + id + "\",\"ok\":false}");
      return;
    }
    bool ok = applyPreset(id);
    if (ok) setOverride(MANUAL);
    else Serial.printf("[Preset] Apply failed for %s\n", id.c_str());
    bleNotify("{\"type\":\"ack\",\"action\":\"preset_apply\",\"id\":\"" + id + "\",\"ok\":" + (ok ? "true" : "false") + "}");
  }
  else if (type == "preset_delete") {
    String id = doc["id"].as<String>();
    deletePreset(id);
    bleNotify("{\"type\":\"ack\",\"action\":\"preset_delete\",\"id\":\"" + id + "\"}");
  }
  else if (type == "preset_list") {
    PendingCmd cmd; strncpy(cmd.type, "preset_list", 31); xQueueSend(cmdQueue, &cmd, 0);
  }

  // ── WLED proxy GETs — queued to main loop (HTTPClient can't run on BLE stack) ──
  else if (type == "wled_get_effects") {
    PendingCmd cmd; strncpy(cmd.type, "wled_get_effects", 31); xQueueSend(cmdQueue, &cmd, 0);
  }
  else if (type == "wled_get_palettes") {
    PendingCmd cmd; strncpy(cmd.type, "wled_get_palettes", 31); xQueueSend(cmdQueue, &cmd, 0);
  }
  else if (type == "wled_get_fxdata") {
    PendingCmd cmd; strncpy(cmd.type, "wled_get_fxdata", 31); xQueueSend(cmdQueue, &cmd, 0);
  }
  else if (type == "wled_get_state") {
    PendingCmd cmd; strncpy(cmd.type, "wled_get_state", 31); xQueueSend(cmdQueue, &cmd, 0);
  }

  // ── Zone / override ──
  else if (type == "zone_trigger") {
    String id = doc["preset_id"].as<String>();
    bool applied = zoneWantsPreset(id);
    bleNotify("{\"type\":\"ack\",\"action\":\"zone_trigger\",\"applied\":" + String(applied ? "true" : "false") + "}");
  }
  else if (type == "override_clear") {
    clearOverride();
    bleNotify("{\"type\":\"ack\",\"action\":\"override_clear\"}");
  }
  else if (type == "fade_to_black") {
    if (!canTakeOverride(MANUAL)) {
      bleNotify("{\"type\":\"ack\",\"action\":\"fade_to_black\",\"ok\":false,\"reason\":\"blocked\"}");
      return;
    }
    saveWledStateForOverride();
    setOverride(MANUAL);
    unsigned long fadeMs = doc["fade_ms"] | 800;
    String targetPresetId = doc["preset_id"] | "";
    bool ok;
    if (targetPresetId.length() > 0) {
      ok = restorePresetWithTransition(targetPresetId, fadeMs);
    } else {
      ok = sendToWLED(injectWledTransition("{\"on\":false}", fadeMs));
    }
    bleNotify("{\"type\":\"ack\",\"action\":\"fade_to_black\",\"ok\":" + String(ok ? "true" : "false") + "}");
  }
  else if (type == "override_mode") {
    overrideKillOnZone = doc["kill_on_zone"].as<bool>();
    prefs.begin("config", false);
    prefs.putBool("killOnZone", overrideKillOnZone);
    prefs.end();
    bleNotify("{\"type\":\"ack\",\"action\":\"override_mode\",\"kill_on_zone\":" + String(overrideKillOnZone ? "true" : "false") + "}");
  }

  else if (type == "mb_rule_config") {
    if (doc.containsKey("ftbPresetId")) {
      mbFadeToBlackPresetId = doc["ftbPresetId"] | "";
      prefs.begin("config", false);
      prefs.putString("mbFtbPreset", mbFadeToBlackPresetId);
      prefs.end();
    }
    bleNotify("{\"type\":\"ack\",\"action\":\"mb_rule_config\"}");
  }

  else if (type == "show_mode_config") {
    if (doc.containsKey("parade")) {
      JsonObject p = doc["parade"];
      showLookParadePre  = p["pre"]  | "";
      showLookParadeLive = p["live"] | "";
    }
    if (doc.containsKey("fireworks")) {
      JsonObject f = doc["fireworks"];
      showLookFireworksPre  = f["pre"]  | "";
      showLookFireworksLive = f["live"] | "__BLACK__";
      showLookFireworksPost = f["post"] | "";
    }
    prefs.begin("config", false);
    prefs.putString("showParaPre", showLookParadePre);
    prefs.putString("showParaLive", showLookParadeLive);
    prefs.putString("showFwPre", showLookFireworksPre);
    prefs.putString("showFwLive", showLookFireworksLive);
    prefs.putString("showFwPost", showLookFireworksPost);
    prefs.end();
    bleNotify("{\"type\":\"ack\",\"action\":\"show_mode_config\"}");
  }

  else if (type == "show_mode_enter") {
    String showStr = doc["show"] | "";
    String phaseStr = doc["phase"] | "";
    ShowType st = (showStr == "parade") ? SHOW_PARADE : (showStr == "fireworks") ? SHOW_FIREWORKS : SHOW_NONE;
    ShowPhase sp = (phaseStr == "pre") ? PHASE_PRE : (phaseStr == "black") ? PHASE_BLACK
                 : (phaseStr == "live") ? PHASE_LIVE : (phaseStr == "post") ? PHASE_POST : PHASE_NONE;
    if (st == SHOW_NONE || sp == PHASE_NONE) {
      bleNotify("{\"type\":\"ack\",\"action\":\"show_mode_enter\",\"ok\":false}");
    } else if (st == SHOW_PARADE && sp == PHASE_POST) {
      showModeType = SHOW_NONE;
      showModePhase = PHASE_NONE;
      overrideBeforeInterrupt = NONE;
      clearOverride();
      bleNotify("{\"type\":\"ack\",\"action\":\"show_mode_enter\",\"show\":\"parade\",\"phase\":\"post\",\"exited\":true}");
    } else {
      if (currentOverride != SHOW_MODE) saveWledStateForOverride();
      showModeType = st;
      showModePhase = sp;
      setOverride(SHOW_MODE);
      applyShowPhaseLook(st, sp, bleEffectTransitionMs);
      bleNotify("{\"type\":\"ack\",\"action\":\"show_mode_enter\",\"show\":\"" + showStr + "\",\"phase\":\"" + phaseStr + "\"}");
    }
  }

  else if (type == "show_mode_exit") {
    showModeType = SHOW_NONE;
    showModePhase = PHASE_NONE;
    overrideBeforeInterrupt = NONE;
    clearOverride();
    bleNotify("{\"type\":\"ack\",\"action\":\"show_mode_exit\"}");
  }

  // ── Brightness ──
  else if (type == "brightness") {
    int bri = constrain(doc["value"].as<int>(), 0, 255);
    setBrightness(bri);
    bleNotify("{\"type\":\"ack\",\"action\":\"brightness\",\"value\":" + String(bri) + "}");
  }

  // ── Raw WLED passthrough ──
  else if (type == "wled_raw") {
    String wled; serializeJson(doc["wled"], wled);
    String presetId = doc["preset_id"] | "";
    Serial.printf("[BLE] wled_raw preset=%s bytes=%u\n",
                  presetId.length() ? presetId.c_str() : "(preview)",
                  (unsigned)wled.length());
    if (presetId.length() > 0) {
      if (!canTakeOverride(MANUAL)) {
        Serial.println("[BLE] wled_raw blocked by override priority");
        bleNotify("{\"type\":\"ack\",\"action\":\"wled_raw\",\"ok\":false,\"reason\":\"blocked\"}");
        return;
      }
      setOverride(MANUAL);
      currentPresetId = presetId;
    }
    ensureWledPowerOn();
    // preparePresetApplyPayload folds inactive seg ids into one POST — no separate disable pass.
    DynamicJsonDocument wdoc(2048);
    bool hasSeg = !deserializeJson(wdoc, wled) && wdoc.containsKey("seg");
    if (hasSeg) {
      wled = preparePresetApplyPayload(wled);
    }
    // Preset / segment applies snap instantly — crossfade shows black/yellow mid-transition.
    bool ok = (hasSeg || presetId.length() > 0)
      ? sendToWLEDForBleSolid(wled)
      : sendToWLEDForBleEffect(wled);
    Serial.printf("[BLE] wled_raw -> WLED %s\n", ok ? "OK" : "FAIL");
    if (ok) {
      liveWledState = compactWledStateForSave(wled);
      lastLiveStatePollMs = millis();
    }
    bleNotify("{\"type\":\"ack\",\"action\":\"wled_raw\",\"ok\":" + String(ok ? "true" : "false") + "}");
  }

  // ── BLE scan log (Serial monitor) ──
  else if (type == "scan_log_config") {
    if (doc.containsKey("enabled")) bleScanLogEnabled = doc["enabled"].as<bool>();
    prefs.begin("config", false);
    prefs.putBool("scanLog", bleScanLogEnabled);
    prefs.end();
    bleNotify("{\"type\":\"ack\",\"action\":\"scan_log_config\","
              "\"enabled\":" + String(bleScanLogEnabled ? "true" : "false") + "}");
    Serial.printf("[Scan] logging %s\n", bleScanLogEnabled ? "enabled" : "disabled");
  }

  // ── App log marker (Serial + optional SD rule log) ──
  else if (type == "log_marker") {
    String msg = doc["msg"] | doc["message"] | "";
    if (msg.length() > 120) msg = msg.substring(0, 120);
    // Keep printable ASCII so Serial / JSONL stay greppable mid-show.
    for (size_t i = 0; i < msg.length(); i++) {
      char c = msg[i];
      if (c < 0x20 || c > 0x7E) msg.setCharAt(i, '?');
      if (c == '"' || c == '\\') msg.setCharAt(i, '\'');
    }
    Serial.printf("[Marker] %s\n", msg.c_str());
    {
      char detail[160];
      snprintf(detail, sizeof(detail), "\"msg\":\"%s\"", msg.c_str());
      sdRuleLoggerWrite("marker", detail);
    }
    bleNotify("{\"type\":\"ack\",\"action\":\"log_marker\",\"ok\":true}");
  }

  // ── Pull recent rule-engine log (RAM ring; also mirrored to SD when mounted) ──
  else if (type == "get_rule_log") {
    int limit = doc["limit"] | 50;
    if (limit < 1) limit = 1;
    if (limit > 96) limit = 96;
    String filter;
    if (doc["events"].is<JsonArray>()) {
      bool first = true;
      for (JsonVariant v : doc["events"].as<JsonArray>()) {
        if (!first) filter += ",";
        first = false;
        filter += v.as<const char*>();
      }
    } else {
      filter = doc["events"] | "";
    }
    String body;
    size_t n = sdRuleLoggerBuildTailJson(body, (size_t)limit, filter.c_str());
    String path = sdRuleLoggerPath();
    // Escape path for JSON (paths are ASCII `/rules_N.jsonl`).
    bleNotify(
      "{\"type\":\"rule_log_meta\",\"ok\":true"
      ",\"sd\":" + String(sdRuleLoggerReady() ? "true" : "false") +
      ",\"path\":\"" + path + "\""
      ",\"ring\":" + String((unsigned)sdRuleLoggerRingCount()) +
      ",\"count\":" + String((unsigned)n) +
      ",\"limit\":" + String(limit) +
      "}"
    );
    bleNotifyChunked("rule_log", body);
  }

  // ── App packet capture (parade / show recording) ──
  else if (type == "ble_capture_config") {
    if (doc.containsKey("active")) bleCaptureToApp = doc["active"].as<bool>();
    if (doc.containsKey("label")) {
      strncpy(captureLabel, doc["label"] | "", sizeof(captureLabel) - 1);
      captureLabel[sizeof(captureLabel) - 1] = '\0';
    }
    bleCaptureUntilMs = 0;
    if (bleCaptureToApp && doc.containsKey("duration_ms")) {
      unsigned long dur = (unsigned long)doc["duration_ms"].as<long>();
      if (dur > 0) bleCaptureUntilMs = millis() + dur;
    }
    if (!bleCaptureToApp) {
      bleCaptureUntilMs = 0;
      bleNotify("{\"type\":\"ble_capture\",\"event\":\"stopped\",\"reason\":\"manual\"}");
    } else {
      bleCaptureLastNotifyMs = 0;
      bleCaptureNotifyCount = 0;
      bleNotify("{\"type\":\"ble_capture\",\"event\":\"started\"}");
    }
    bleNotify("{\"type\":\"ack\",\"action\":\"ble_capture_config\","
              "\"active\":" + String(bleCaptureToApp ? "true" : "false") + "}");
    Serial.printf("[Capture] app recording %s\n", bleCaptureToApp ? "ON" : "OFF");
  }

  // ── Unmatched rule-engine packet log (always-on, independent of capture) ──
  else if (type == "mb_unmatched_log_config") {
    if (doc.containsKey("active")) mbUnmatchedLogEnabled = doc["active"].as<bool>();
    prefs.begin("config", false);
    prefs.putBool("mbUnmatched", mbUnmatchedLogEnabled);
    prefs.end();
    bleNotify("{\"type\":\"ack\",\"action\":\"mb_unmatched_log_config\","
              "\"active\":" + String(mbUnmatchedLogEnabled ? "true" : "false") + "}");
    Serial.printf("[Rules] unmatched log %s\n", mbUnmatchedLogEnabled ? "ON" : "OFF");
  }

  else if (type == "parade_manual_start") {
    manualParadeStart();
    bleNotify("{\"type\":\"ack\",\"action\":\"parade_manual_start\"}");
  }
  else if (type == "parade_manual_stop") {
    manualParadeStop();
    bleNotify("{\"type\":\"ack\",\"action\":\"parade_manual_stop\"}");
  }

  // ── MB / SW effect fade ──
  else if (type == "ble_effect_config") {
    if (doc.containsKey("transition_ms")) {
      bleEffectTransitionMs = (unsigned long)doc["transition_ms"].as<long>();
    }
    prefs.begin("config", false);
    prefs.putULong("bleTransMs", bleEffectTransitionMs);
    prefs.end();
    bleNotify("{\"type\":\"ack\",\"action\":\"ble_effect_config\","
              "\"transition_ms\":" + String(bleEffectTransitionMs) + "}");
  }

  // ── WLED WiFi / HTTP target ──
  else if (type == "wled_net_config") {
    if (doc.containsKey("ssid")) wledSsid = doc["ssid"].as<String>();
    if (doc.containsKey("pass")) wledPass = doc["pass"].as<String>();
    if (doc.containsKey("ip"))   wledIp   = doc["ip"].as<String>();
    if (doc.containsKey("port")) wledPort = doc["port"].as<int>();
    prefs.begin("config", false);
    prefs.putString("wledSsid", wledSsid);
    prefs.putString("wledPass", wledPass);
    prefs.putString("wledIp", wledIp);
    prefs.putInt("wledPort", wledPort);
    prefs.end();
    String ack = "{\"type\":\"ack\",\"action\":\"wled_net_config\","
                 "\"ssid\":\"" + wledSsid + "\",\"ip\":\"" + wledIp + "\","
                 "\"port\":" + String(wledPort) + "}";
    bleNotify(ack);

    wifiConnectInProgress = false;
    connectToWLED(true);
  }

  // ── Starlight Wand config ──
  else if (type == "sw_config") {
    if (doc.containsKey("enabled"))    starlightEnabled   = doc["enabled"].as<bool>();
    if (doc.containsKey("timeout_ms")) starlightTimeoutMs = (unsigned long)doc["timeout_ms"].as<long>();
    prefs.begin("config", false);
    prefs.putBool("swEn", starlightEnabled);
    prefs.putULong("swTimeout", starlightTimeoutMs);
    prefs.end();
    String ack = "{\"type\":\"ack\",\"action\":\"sw_config\","
                 "\"enabled\":" + String(starlightEnabled ? "true" : "false") + ","
                 "\"timeout_ms\":" + String(starlightTimeoutMs) + "}";
    bleNotify(ack);
  }

  // ── MagicBand config ──
  else if (type == "mb_config") {
    if (doc.containsKey("enabled"))    magicBandEnabled   = doc["enabled"].as<bool>();
    if (doc.containsKey("timeout_ms")) magicBandTimeoutMs = (unsigned long)doc["timeout_ms"].as<long>();
    if (doc.containsKey("defer_to_app")) mbDeferToApp = doc["defer_to_app"].as<bool>();
    prefs.begin("config", false);
    prefs.putBool("mbEn", magicBandEnabled);
    prefs.putULong("mbTimeout", magicBandTimeoutMs);
    prefs.putBool("mbDefer", mbDeferToApp);
    prefs.end();
    String ack = "{\"type\":\"ack\",\"action\":\"mb_config\","
                 "\"enabled\":" + String(magicBandEnabled ? "true" : "false") + ","
                 "\"timeout_ms\":" + String(magicBandTimeoutMs) + ","
                 "\"defer_to_app\":" + String(mbDeferToApp ? "true" : "false") + "}";
    bleNotify(ack);
  }

  else if (type == "rules_pause_config") {
    if (doc.containsKey("paused")) rulesPaused = doc["paused"].as<bool>();
    prefs.begin("config", false);
    prefs.putBool("rulesPaused", rulesPaused);
    prefs.end();
    bleNotify("{\"type\":\"ack\",\"action\":\"rules_pause_config\",\"paused\":" +
              String(rulesPaused ? "true" : "false") + "}");
    Serial.printf("[Rules] %s\n", rulesPaused ? "paused" : "resumed");
  }
  else if (type == "set_mb_rules" || type == "mb_rules_config" || type == "mb_mapping_config") {
    JsonObject mapping = doc.containsKey("mapping") ? doc["mapping"].as<JsonObject>()
                       : doc.as<JsonObject>();
    if (!mapping.isNull()) {
      bool hasRules = mapping.containsKey("rules") || mapping.containsKey("segmentMaps");
      bool persisted = false;
      if (hasRules) {
        serializeJson(mapping, mbRulesJson);
        mbMappingJson = mbRulesJson;
        persisted = mbRulesFsSave(mbRulesJson);
        // Free NVS — rules no longer live there (was overflowing the 20KB partition).
        prefs.begin("config", false);
        nvsRemoveLargeString(prefs, "mbRules");
        nvsRemoveLargeString(prefs, "mbMapping");
        prefs.end();
      } else {
        serializeJson(mapping, mbMappingJson);
        mbRulesJson = mbMappingJson;
        persisted = mbRulesFsSave(mbMappingJson);
        prefs.begin("config", false);
        nvsRemoveLargeString(prefs, "mbRules");
        nvsRemoveLargeString(prefs, "mbMapping");
        prefs.end();
      }
      mbMappingLoadedFromNvs = true;
      bool cacheOk = applyMbRulesJson(mapping);
      Serial.printf("[Rules] updated (rulesOrMaps=%d, %u bytes, fs=%s, cache=%s)\n",
                    hasRules ? 1 : 0,
                    (unsigned)(hasRules ? mbRulesJson.length() : mbMappingJson.length()),
                    persisted ? "ok" : "FAIL",
                    cacheOk ? "ok" : "FAIL");
      if (!persisted) {
        bleNotify("{\"type\":\"ack\",\"action\":\"set_mb_rules\",\"ok\":false,\"reason\":\"fs_persist\"}");
        return;
      }
      bleNotify(String("{\"type\":\"ack\",\"action\":\"set_mb_rules\",\"ok\":true,\"cacheApplied\":") +
                (cacheOk ? "true" : "false") + "}");
      return;
    }
    bleNotify("{\"type\":\"ack\",\"action\":\"set_mb_rules\",\"ok\":true,\"cacheApplied\":true}");
  }

  else if (type == "set_color_calibration") {
    String calJson;
    if (doc.containsKey("calibration") && doc["calibration"].is<JsonObject>()) {
      serializeJson(doc["calibration"], calJson);
    } else if (doc.containsKey("enabled") || doc.containsKey("curves")) {
      // Top-level { enabled, curves } without nesting.
      DynamicJsonDocument calDoc(2048);
      calDoc["enabled"] = doc["enabled"] | false;
      if (doc.containsKey("curves")) {
        calDoc["curves"] = doc["curves"];
      }
      serializeJson(calDoc, calJson);
    } else {
      calJson = "{\"enabled\":false}";
    }
    bool persisted = mbCalibrationFsSave(calJson);
    mbCalibrationApply(calJson);
    Serial.printf("[Cal] BLE update (%u bytes, fs=%s, enabled=%d)\n",
                  (unsigned)calJson.length(),
                  persisted ? "ok" : "FAIL",
                  mbCalibrationEnabled ? 1 : 0);
    if (!persisted) {
      bleNotify("{\"type\":\"ack\",\"action\":\"set_color_calibration\",\"ok\":false,\"reason\":\"fs_persist\"}");
      return;
    }
    bleNotify("{\"type\":\"ack\",\"action\":\"set_color_calibration\",\"ok\":true}");
  }

  else if (type == "mb_layout_set") {
    JsonArray layoutsArr = doc["layouts"];
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
    if (mbLayoutCount == 0) {
      loadMbMappingDefaults();
    } else {
      mbActiveLayoutIdx = constrain((int)(doc["active"] | 0), 0, max(0, (int)mbLayoutCount - 1));
    }
    serializeJson(doc["layouts"], mbLayoutsJson);
    prefs.begin("config", false);
    prefs.putString("mbLayouts", mbLayoutsJson);
    prefs.putUChar("mbActiveLayout", mbActiveLayoutIdx);
    prefs.end();
    bleNotify("{\"type\":\"ack\",\"action\":\"mb_layout_set\",\"active\":" + String(mbActiveLayoutIdx) + "}");
  }

  else if (type == "mb_layout_switch") {
    int idx = doc["index"] | 0;
    if (idx >= 0 && idx < (int)mbLayoutCount) {
      mbActiveLayoutIdx = (uint8_t)idx;
      prefs.begin("config", false);
      prefs.putUChar("mbActiveLayout", mbActiveLayoutIdx);
      prefs.end();
      bleNotify("{\"type\":\"ack\",\"action\":\"mb_layout_switch\",\"active\":" + String(mbActiveLayoutIdx) +
                ",\"name\":\"" + String(mbLayouts[idx].name) + "\"}");
    } else {
      bleNotify("{\"type\":\"ack\",\"action\":\"mb_layout_switch\",\"ok\":false}");
    }
  }

  // ── Dual-board role / scanner pairing ──
  else if (type == "set_board_role") {
    String role = doc["role"] | "standalone";
    BoardRole next = BoardRole::STANDALONE;
    if (role == "logic_board" || role == "dual" || role == "dual_board") {
      next = BoardRole::LOGIC_BOARD;
    }
    boardRole = next;
    prefs.begin("config", false);
    prefs.putUChar("boardRole", (uint8_t)boardRole);
    prefs.end();
    applyBoardRoleRuntime();
    bleNotify(String("{\"type\":\"ack\",\"action\":\"set_board_role\",\"role\":\"") +
              (boardRole == BoardRole::LOGIC_BOARD ? "logic_board" : "standalone") + "\"}");
    Serial.printf("[Config] boardRole=%u applied live\n", (unsigned)boardRole);
  }
  else if (type == "set_scanner_mac") {
    String macStr = doc["mac"] | "";
    uint8_t mac[6];
    if (!transportParseMacString(macStr.c_str(), mac)) {
      bleNotify("{\"type\":\"ack\",\"action\":\"set_scanner_mac\",\"ok\":false}");
    } else {
      transportSetScannerMac(mac);
      bleNotify("{\"type\":\"ack\",\"action\":\"set_scanner_mac\",\"ok\":true,\"mac\":\"" +
                transportMacToString(mac) + "\"}");
    }
  }

  else if (type == "set_field") {
    handleSetFieldCommand(doc["field"] | "", doc["value"]);
  }
  else if (type == "list_fields") {
    handleListFieldsCommand();
  }

  else if (type == "list_rules") {
    JsonArray rules = mbRulesJsonArray();
    String out = "{\"type\":\"rules_summary\",\"rules\":[";
    bool first = true;
    for (JsonVariant v : rules) {
      if (!v.is<JsonObject>()) continue;
      JsonObject r = v.as<JsonObject>();
      if (!first) out += ",";
      first = false;
      out += "{\"id\":\"";
      out += (r["id"] | "");
      out += "\",\"name\":\"";
      out += (r["name"] | "");
      out += "\",\"prio\":";
      out += String((int)(r["priority"] | r["prio"] | 0));
      out += ",\"enabled\":";
      out += (r["enabled"] | true) ? "true" : "false";
      out += "}";
    }
    out += "]}";
    bleNotify(out);
  }

  else if (type == "set_rule_enabled") {
    String ruleId = doc["ruleId"] | "";
    bool enabled = doc["enabled"] | true;
    JsonArray rules = mbRulesJsonArray();
    JsonObject match;
    for (JsonVariant v : rules) {
      if (!v.is<JsonObject>()) continue;
      JsonObject r = v.as<JsonObject>();
      if (ruleId == (r["id"] | "")) { match = r; break; }
    }
    if (match.isNull()) {
      bleNotify("{\"type\":\"ack\",\"action\":\"set_rule_enabled\",\"ruleId\":\"" + ruleId +
                "\",\"ok\":false,\"reason\":\"not_found\"}");
    } else {
      match["enabled"] = enabled;
      if (!enabled && mbActiveRuleId[0] && ruleId == mbActiveRuleId) {
        Serial.printf("[Rule] disabling currently-active rule %s — forcing restore\n", ruleId.c_str());
        forceRuleLifecycleRestore();
      }
      bool persisted = persistMbRulesCache();
      bleNotify("{\"type\":\"ack\",\"action\":\"set_rule_enabled\",\"ruleId\":\"" + ruleId +
                "\",\"ok\":true,\"enabled\":" + String(enabled ? "true" : "false") +
                ",\"persisted\":" + String(persisted ? "true" : "false") + "}");
    }
  }

  else if (type == "list_segments") {
    String mapId = doc["mapId"] | "";
    JsonObject segMap = findSegmentMapById(mapId.c_str());
    if (segMap.isNull()) {
      bleNotify("{\"type\":\"segments_summary\",\"mapId\":\"" + mapId +
                "\",\"ok\":false,\"reason\":\"map_not_found\",\"segments\":[]}");
    } else {
      String out = "{\"type\":\"segments_summary\",\"mapId\":\"" + mapId + "\",\"segments\":[";
      JsonArray segs = segMap["segments"].as<JsonArray>();
      bool first = true;
      for (JsonVariant v : segs) {
        if (!v.is<JsonObject>()) continue;
        JsonObject s = v.as<JsonObject>();
        if (!first) out += ",";
        first = false;
        out += "{\"id\":\"";
        out += (s["id"] | "");
        out += "\",\"start\":";
        out += String((int)(s["start"] | 0));
        out += ",\"stop\":";
        out += String((int)(s["stop"] | 0));
        out += ",\"enabled\":";
        out += (s["enabled"] | true) ? "true" : "false";
        out += "}";
      }
      out += "]}";
      bleNotify(out);
    }
  }

  else if (type == "set_segment_field") {
    String mapId = doc["mapId"] | "";
    String segmentId = doc["segmentId"] | "";
    String field = doc["field"] | "";
    if (field != "enabled" && field != "start" && field != "stop") {
      bleNotify("{\"type\":\"ack\",\"action\":\"set_segment_field\",\"ok\":false,\"reason\":\"not_whitelisted\"}");
    } else {
      JsonObject segMap = findSegmentMapById(mapId.c_str());
      if (segMap.isNull()) {
        bleNotify("{\"type\":\"ack\",\"action\":\"set_segment_field\",\"ok\":false,\"reason\":\"map_not_found\"}");
      } else {
        JsonObject seg = findSegmentInMap(segMap, segmentId.c_str());
        if (seg.isNull()) {
          bleNotify("{\"type\":\"ack\",\"action\":\"set_segment_field\",\"ok\":false,\"reason\":\"segment_not_found\"}");
        } else {
          bool ok = true;
          String reason;
          if (field == "enabled") {
            if (!doc["value"].is<bool>()) { ok = false; reason = "wrong_type"; }
            else seg["enabled"] = doc["value"].as<bool>();
          } else {
            if (!doc["value"].is<int>()) { ok = false; reason = "wrong_type"; }
            else {
              int v = doc["value"].as<int>();
              if (v < 0 || v > STRIP_LED_COUNT) { ok = false; reason = "out_of_range"; }
              else seg[field] = v;
            }
          }
          if (ok) {
            int start = seg["start"] | 0;
            int stop = seg["stop"] | 0;
            bool segmentNowEmpty = (stop <= start);
            bool persisted = persistMbRulesCache();
            bleNotify("{\"type\":\"ack\",\"action\":\"set_segment_field\",\"mapId\":\"" + mapId +
                      "\",\"segmentId\":\"" + segmentId + "\",\"field\":\"" + field +
                      "\",\"ok\":true,\"persisted\":" + String(persisted ? "true" : "false") +
                      ",\"segmentNowEmpty\":" + String(segmentNowEmpty ? "true" : "false") + "}");
          } else {
            bleNotify("{\"type\":\"ack\",\"action\":\"set_segment_field\",\"ok\":false,\"reason\":\"" + reason + "\"}");
          }
        }
      }
    }
  }

  // ── Status ──
  else if (type == "status") {
    if (WiFi.status() == WL_CONNECTED) {
      refreshCurrentBrightnessFromWled(600);
    }
    unsigned long scannerAgeMs = 0;
    bool scannerSeen = (lastScannerPacketMs > 0);
    if (scannerSeen) scannerAgeMs = millis() - lastScannerPacketMs;
    uint8_t myMac[6];
    WiFi.macAddress(myMac);
    bleNotify(
      "{\"type\":\"status\","
      "\"override\":" + String((int)currentOverride) + ","
      "\"kill_on_zone\":" + String(overrideKillOnZone ? "true" : "false") + ","
      "\"brightness\":" + String(currentBrightness) + ","
      "\"preset\":\"" + currentPresetId + "\","
      "\"wifi\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") + ","
      "\"wled_ssid\":\"" + wledSsid + "\","
      "\"wled_ip\":\"" + wledIp + "\","
      "\"wled_port\":" + String(wledPort) + ","
      "\"sw_enabled\":" + String(starlightEnabled ? "true" : "false") + ","
      "\"sw_timeout_ms\":" + String(starlightTimeoutMs) + ","
      "\"mb_enabled\":" + String(magicBandEnabled ? "true" : "false") + ","
      "\"mb_timeout_ms\":" + String(magicBandTimeoutMs) + ","
      "\"ble_transition_ms\":" + String(bleEffectTransitionMs) + ","
      "\"rules_paused\":" + String(rulesPaused ? "true" : "false") + ","
      "\"mb_mapping_loaded\":" + String(mbMappingLoadedFromNvs ? "true" : "false") + ","
      "\"mb_layout_active\":" + String((int)mbActiveLayoutIdx) + ","
      "\"mb_layout_name\":\"" + String(mbLayoutCount > 0 ? mbLayouts[mbActiveLayoutIdx].name : "Default") + "\","
      "\"mb_layout_count\":" + String((int)mbLayoutCount) + ","
      "\"show_type\":\"" + String(showTypeStatusStr()) + "\","
      "\"show_phase\":\"" + String(showPhaseStatusStr()) + "\","
      "\"scan_log\":" + String(bleScanLogEnabled ? "true" : "false") + ","
      "\"sd_rule_log\":" + String(sdRuleLoggerReady() ? "true" : "false") + ","
      "\"sd_rule_log_path\":\"" + String(sdRuleLoggerPath()) + "\","
      "\"sd_rule_log_ring\":" + String((unsigned)sdRuleLoggerRingCount()) + ","
      "\"capture_active\":" + String(bleCaptureToApp ? "true" : "false") + ","
      "\"preset_count\":" + String(countBoardPresets()) + ","
      "\"board_role\":\"" + String(boardRole == BoardRole::LOGIC_BOARD ? "logic_board" : "standalone") + "\","
      "\"scanner_mac\":\"" + String(scannerPeerConfigured ? transportMacToString(scannerPeerMac) : "") + "\","
      "\"logic_mac\":\"" + transportMacToString(myMac) + "\","
      "\"scanner_seen\":" + String(scannerSeen ? "true" : "false") + ","
      "\"scanner_age_ms\":" + String(scannerAgeMs) +
      "}"
    );
  }
  else {
    Serial.printf("[BLE] Unknown type: %s\n", type.c_str());
  }
}

// ─────────────────────────────────────────────
// BLE PERIPHERAL
// ─────────────────────────────────────────────

