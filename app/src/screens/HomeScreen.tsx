import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Switch,
  Alert,
  TextInput,
  Modal,
} from "react-native";
import Slider from "@react-native-community/slider";
import IconBluetooth from "@tabler/icons-react-native/dist/esm/icons/IconBluetooth";
import IconBluetoothOff from "@tabler/icons-react-native/dist/esm/icons/IconBluetoothOff";
import IconBulb from "@tabler/icons-react-native/dist/esm/icons/IconBulb";
import IconSparkles from "@tabler/icons-react-native/dist/esm/icons/IconSparkles";
import IconBolt from "@tabler/icons-react-native/dist/esm/icons/IconBolt";
import IconWifi from "@tabler/icons-react-native/dist/esm/icons/IconWifi";
import IconWifiOff from "@tabler/icons-react-native/dist/esm/icons/IconWifiOff";
import IconMap from "@tabler/icons-react-native/dist/esm/icons/IconMap";
import IconSettings from "@tabler/icons-react-native/dist/esm/icons/IconSettings";
import IconMoon from "@tabler/icons-react-native/dist/esm/icons/IconMoon";
import IconRefresh from "@tabler/icons-react-native/dist/esm/icons/IconRefresh";
import IconPlus from "@tabler/icons-react-native/dist/esm/icons/IconPlus";
import IconTrash from "@tabler/icons-react-native/dist/esm/icons/IconTrash";

import { useBLE } from "../hooks/useBLE";
import { useBoardSync } from "../hooks/useBoardSync";
import { useAppStore } from "../stores/store";
import { bleService } from "../services/BLEService";
import { fireActiveZonePreset, fadeToBlackQuick } from "../services/parkQuickActions";
import { formatSyncStatusLabel } from "../utils/boardSyncState";
import { requestFullBoardSync } from "../utils/connectBootstrap";
import { useTheme } from "../utils/theme";
import { PresetPickerModal } from "./MbMappingSections";
import { useParkShows, formatShowStatus } from "../hooks/useParkShows";
import { runShowPhase, stopShowMode } from "../services/showControl";

export default function HomeScreen() {
  const { colors } = useTheme();
  const s = styles(colors);
  const { connectionState, isConnected, isSessionReady } = useBLE();
  const boardSync = useBoardSync();

  const {
    deviceStatus,
    presets,
    zones,
    activeZoneIds,
    zonesEnabled,
    setZonesEnabled,
    saveToStorage,
    setOverrideDetail,
    bleCaptureActive,
    bleCaptureLiveCount,
    ftbPresetId,
    setFtbPresetId,
    bleEffectTransitionMs,
    activePark,
    recallState,
    customSegmentLayouts,
    setShowInstanceOverride,
    syncMode,
    parkMode,
    logMarkerSnippets,
    setLogMarkerSnippets,
  } = useAppStore();

  const [brightness, setBrightness] = useState(deviceStatus?.brightness ?? 0);
  const [brightnessText, setBrightnessText] = useState(
    String(deviceStatus?.brightness ?? 0),
  );
  const [editingBrightness, setEditingBrightness] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [ftbPickerOpen, setFtbPickerOpen] = useState(false);
  const [firingZone, setFiringZone] = useState(false);
  const [runningShowPhase, setRunningShowPhase] = useState<string | null>(null);
  const [logMarkerOpen, setLogMarkerOpen] = useState(false);
  const [logMarkerTimestamp, setLogMarkerTimestamp] = useState("");
  const [logMarkerDraft, setLogMarkerDraft] = useState("");
  const [snippetKey, setSnippetKey] = useState("");
  const [snippetValue, setSnippetValue] = useState("");

  const { shows: parkShows, fetchError: parkShowsError } = useParkShows(
    activePark,
    isConnected,
  );

  const runPhase = async (
    show: (typeof parkShows)[0],
    phase: "pre" | "live" | "post",
  ) => {
    if (!isConnected) return;
    if (!isSessionReady) {
      Alert.alert(
        "Board syncing",
        "Wait until Home shows Ready before running show phases.",
      );
      return;
    }
    if (!show.inScope) {
      Alert.alert(
        "Outside show area",
        show.binding.scopeZoneId
          ? "Move into the assigned zone for this show, or change Location under More → Park Shows."
          : "You must be in this park for show automation.",
      );
      return;
    }
    const key = `${show.id}:${phase}`;
    setRunningShowPhase(key);
    try {
      await runShowPhase(
        show.binding,
        phase,
        presets,
        recallState,
        customSegmentLayouts,
        bleEffectTransitionMs,
      );
    } finally {
      setRunningShowPhase(null);
    }
  };

  // Request status after session bootstrap, then every 5s
  useEffect(() => {
    if (!isConnected) return;
    const poll = () => {
      if (bleService.isSessionReady()) bleService.sendStatus();
    };
    const unsubReady = bleService.onSessionReady(poll);
    const interval = setInterval(poll, 5000);
    return () => {
      unsubReady();
      clearInterval(interval);
    };
  }, [isConnected]);

  const applyBrightnessToUi = (bri: number) => {
    setBrightness(bri);
    setBrightnessText(String(bri));
  };

  // Sync slider when board reports brightness changes, unless the user is editing.
  useEffect(() => {
    if (deviceStatus?.brightness === undefined || editingBrightness) return;
    applyBrightnessToUi(deviceStatus.brightness);
  }, [deviceStatus?.brightness, editingBrightness]);

  const commitBrightness = (raw: number) => {
    const next = Math.min(255, Math.max(0, Math.round(raw)));
    applyBrightnessToUi(next);
    bleService.sendBrightness(next);
  };

  // BLE Data event feed.
  useEffect(() => {
    return bleService.onMessage((msg) => {
      if (msg.type === "sw_color") {
        const label = `BLE Data palette ${msg.palette} → R${msg.r} G${msg.g} B${msg.b}`;
        setEvents((prev) => [label, ...prev].slice(0, 12));
      } else if (msg.type === "sw_debug") {
        const label = `BLE Data [${msg.reason}] ${msg.hex} (${msg.len}b)`;
        setEvents((prev) => [label, ...prev].slice(0, 12));
      } else if (msg.type === "sw_event") {
        const name = msg.name ? ` (${msg.name})` : "";
        setEvents((prev) =>
          [`BLE Data: ${String(msg.event)}${name}`, ...prev].slice(0, 12),
        );
      } else if (msg.type === "ble_event" || msg.type === "ble_color") {
        const label =
          msg.type === "ble_color"
            ? `BLE Data color → R${msg.r} G${msg.g} B${msg.b}`
            : `BLE Data: ${String(msg.event)}`;
        setEvents((prev) => [label, ...prev].slice(0, 12));
      } else if (msg.type === "mb_unmatched") {
        setEvents((prev) => [
          `BLE Data unmatched: ${String(msg.hex ?? "")}`,
          ...prev,
        ].slice(0, 12));
      }
    });
  }, []);

  const overrideIndex = deviceStatus?.override ?? 0;
  const activeZones = zones.filter((z) => activeZoneIds.includes(z.id));
  const fireZone = activeZones.find((z) => z.presetId) ?? null;
  const firePreset = fireZone
    ? presets.find((p) => p.id === fireZone.presetId)
    : null;
  const ftbPreset = ftbPresetId
    ? presets.find((p) => p.id === ftbPresetId)
    : null;

  const clearEffect = () => {
    bleService.sendOverrideClear();
    setOverrideDetail(null);
  };

  const openLogMarker = () => {
    setLogMarkerTimestamp(new Date().toISOString());
    setLogMarkerOpen(true);
  };

  const sendLogMarker = () => {
    const text = logMarkerDraft.trim();
    if (!text) return;
    void bleService.sendLogMarker(`[${logMarkerTimestamp}] ${text}`);
    setLogMarkerDraft("");
    setLogMarkerOpen(false);
  };

  const addLogMarkerSnippet = () => {
    const key = snippetKey.trim();
    const value = snippetValue.trim();
    if (!key || !value) return;
    setLogMarkerSnippets([
      ...logMarkerSnippets.filter((snippet) => snippet.key !== key),
      { key, value },
    ]);
    saveToStorage();
    setSnippetKey("");
    setSnippetValue("");
  };

  const handleFireZone = async () => {
    if (!isConnected || firingZone) return;
    if (!isSessionReady) {
      Alert.alert(
        "Board syncing",
        formatSyncStatusLabel(boardSync, connectionState, bleService.hasScanTimedOut()) +
          "\n\nWait until the status shows Ready, then try again. Use Sync Board if it stays stuck.",
      );
      return;
    }
    if (!fireZone?.presetId) {
      Alert.alert("No preset", "This zone has no preset assigned.");
      return;
    }
    setFiringZone(true);
    try {
      const result = await fireActiveZonePreset();
      if (!result.ok) {
        Alert.alert(
          "Fire failed",
          result.message ?? "Could not apply the preset.",
        );
      }
    } finally {
      setFiringZone(false);
    }
  };

  const syncStatusLabel = formatSyncStatusLabel(
    boardSync,
    connectionState,
    bleService.hasScanTimedOut(),
  );
  const commandsBlocked = isConnected && !isSessionReady;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Connection */}
      <View style={s.card}>
        <View style={s.row}>
          {isConnected ? (
            <IconBluetooth size={18} color={colors.success} />
          ) : (
            <IconBluetoothOff size={18} color={colors.danger} />
          )}
          <Text style={s.statusText}>
            {connectionState === "connected"
              ? isSessionReady ? "Connected — commands enabled" : "Connected — syncing board…"
              : connectionState === "scanning" ? "Scanning…"
              : connectionState === "connecting" ? "Connecting…"
              : connectionState === "disconnected" ? "Disconnected" : "Connection error"}
          </Text>
          {!isConnected ? (
            <TouchableOpacity style={s.iconBtn} onPress={() => void bleService.connect()}>
              <IconRefresh size={18} color={colors.primary} />
            </TouchableOpacity>
          ) : (connectionState === "scanning" || connectionState === "connecting" || commandsBlocked) ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : null}
          {isConnected && (
            <TouchableOpacity
              style={s.iconBtn}
              onPress={() => Alert.alert(
                "Sync board config",
                "Push the app configuration to the board now?",
                [{ text: "Cancel", style: "cancel" }, { text: "Sync", onPress: () => requestFullBoardSync() }],
              )}
            >
              <IconRefresh size={18} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>
        {isConnected && <Text style={s.subText}>{syncStatusLabel}</Text>}
        {(commandsBlocked || (isConnected && isSessionReady && boardSync.backgroundBusy)) && (
          <View style={[s.syncBanner, !commandsBlocked && s.syncBannerMuted]}>
            <ActivityIndicator size="small" color={commandsBlocked ? colors.primary : colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={s.syncBannerTitle}>{syncStatusLabel}</Text>
              {boardSync.presetProgress && (
                <Text style={s.syncBannerSub}>Presets {boardSync.presetProgress.current}/{boardSync.presetProgress.total}</Text>
              )}
            </View>
          </View>
        )}
        {isConnected && boardSync.mode !== "none" && (
          <Text style={s.subText}>
            Sync mode: {boardSync.mode === "quick" ? "quick reconnect" : "full"}
            {deviceStatus?.boardPresetCount != null ? ` · ${deviceStatus.boardPresetCount} preset(s) on board` : ""}
            {presets.length > 0 ? ` · ${presets.length} in app` : ""}
          </Text>
        )}
        {isConnected && syncMode === "manual" && <Text style={[s.subText, { color: colors.warning }]}>Manual sync — board is running its own saved config</Text>}
        {isConnected && parkMode && <Text style={[s.subText, { color: colors.warning }]}>Park Mode — minimal BLE (no auto config push)</Text>}
        {deviceStatus && (
          <View style={s.row}>
            {deviceStatus.wifiConnected ? <IconWifi size={13} color={colors.success} /> : <IconWifiOff size={13} color={colors.danger} />}
            <Text style={s.subText}>WLED: {deviceStatus.wifiConnected ? "connected" : "not connected"}</Text>
          </View>
        )}
      </View>

      {/* Quick actions */}
      <View style={s.card}>
          <Text style={s.label}>Quick Actions</Text>
          <View style={s.quickRow}>
            <View style={s.quickBtnWrap}>
              <TouchableOpacity
                style={[s.quickBtn, !isSessionReady && s.quickBtnDisabled]}
                disabled={!isSessionReady}
                onPress={() => {
                  void fadeToBlackQuick().then((r) => {
                    if (!r.ok) Alert.alert("Fade to Black", r.message ?? "Failed");
                  });
                }}
              >
                <IconMoon size={20} color={colors.textPrimary} />
                <Text style={s.quickBtnText}>Fade to Black</Text>
                {ftbPreset && (
                  <Text style={s.quickBtnHint} numberOfLines={1}>
                    {ftbPreset.name}
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={s.quickGear}
                onPress={() => setFtbPickerOpen(true)}
              >
                <IconSettings size={14} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[s.quickBtn, overrideIndex === 0 && s.quickBtnDisabled]}
              disabled={!isSessionReady || overrideIndex === 0}
              onPress={clearEffect}
            >
              <IconRefresh
                size={20}
                color={
                  overrideIndex === 0 ? colors.textMuted : colors.textPrimary
                }
              />
              <Text
                style={[
                  s.quickBtnText,
                  overrideIndex === 0 && s.quickBtnTextDisabled,
                ]}
              >
                Previous State
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                s.quickBtn,
                (!fireZone?.presetId || firingZone || !isSessionReady) &&
                  s.quickBtnDisabled,
              ]}
              disabled={!fireZone?.presetId || firingZone || !isSessionReady}
              activeOpacity={0.6}
              onPress={() => void handleFireZone()}
            >
              {firingZone ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <IconBolt
                  size={20}
                  color={fireZone?.presetId ? colors.primary : colors.textMuted}
                />
              )}
              <Text
                style={[
                  s.quickBtnText,
                  !fireZone?.presetId && s.quickBtnTextDisabled,
                ]}
                numberOfLines={2}
              >
                {fireZone ? `Fire: ${fireZone.name}` : "Fire Zone"}
              </Text>
              {firePreset && (
                <Text style={s.quickBtnHint} numberOfLines={1}>
                  {firePreset.name}
                </Text>
              )}
              {fireZone?.presetId && !firePreset && (
                <Text style={[s.quickBtnHint, { color: colors.danger }]}>
                  Preset not found
                </Text>
              )}
            </TouchableOpacity>
          </View>
      </View>

      <PresetPickerModal
        visible={ftbPickerOpen}
        title="Fade to Black preset"
        presets={presets}
        selectedId={ftbPresetId}
        emptyLabel="Pure black (no preset)"
        onSelect={(id) => {
          setFtbPresetId(id);
          saveToStorage();
          if (bleService.isConnected()) bleService.sendMbRuleConfig(id || '');
        }}
        onClose={() => setFtbPickerOpen(false)}
        colors={colors}
      />

      {/* Brightness */}
      <View style={s.card}>
        <View style={s.row}>
          <IconBulb size={15} color={colors.textSecondary} />
          <Text style={s.label}>Brightness</Text>
          <TextInput
            style={s.brightnessInput}
            keyboardType="number-pad"
            value={brightnessText}
            editable={isSessionReady}
            selectTextOnFocus
            onFocus={() => setEditingBrightness(true)}
            onChangeText={(v) => {
              setBrightnessText(v);
              const n = parseInt(v, 10);
              if (!isNaN(n)) setBrightness(Math.min(255, Math.max(0, n)));
            }}
            onBlur={() => {
              setEditingBrightness(false);
              const n = parseInt(brightnessText, 10);
              if (!isNaN(n)) commitBrightness(n);
              else setBrightnessText(String(brightness));
            }}
            onSubmitEditing={() => {
              setEditingBrightness(false);
              const n = parseInt(brightnessText, 10);
              if (!isNaN(n)) commitBrightness(n);
            }}
          />
        </View>
        <Slider
          minimumValue={0}
          maximumValue={255}
          step={1}
          value={brightness}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.borderFocus}
          thumbTintColor={colors.primary}
          onValueChange={(v) => {
            const n = Math.round(v);
            setBrightness(n);
            setBrightnessText(String(n));
          }}
          onSlidingComplete={commitBrightness}
          disabled={!isSessionReady}
        />
      </View>

      {/* Active zones */}
      <View style={s.card}>
        <View style={s.row}>
          <IconMap size={15} color={colors.textSecondary} />
          <Text style={s.label}>Active Zones</Text>
          <Switch
            value={zonesEnabled}
            onValueChange={(v) => { setZonesEnabled(v); saveToStorage(); }}
            trackColor={{ false: colors.borderFocus, true: colors.primary }}
            thumbColor="#fff"
            disabled={!isConnected}
            style={{ marginLeft: "auto" }}
          />
        </View>
        {activeZones.length === 0 ? (
          <Text style={s.subText}>{zonesEnabled ? "Not in any zone" : "Zone triggers paused"}</Text>
        ) : activeZones.map((z) => {
          const preset = presets.find((p) => p.id === z.presetId);
          return (
            <View key={z.id} style={s.zoneRow}>
              <View style={s.zoneDot} />
              <View style={{ flex: 1 }}>
                <Text style={s.zoneName}>{z.name}</Text>
                {preset && <Text style={s.subText}>{preset.name}</Text>}
              </View>
            </View>
          );
        })}
      </View>

      {/* Park shows */}
      <View style={s.card}>
          <View style={s.row}>
            <IconMap size={15} color={colors.textSecondary} />
            <Text style={s.label}>Shows</Text>
          </View>
          {!activePark?.themeParksApiEntityId || parkShowsError ? (
            <Text style={s.subText}>{parkShowsError}</Text>
          ) : parkShows.length === 0 ? (
            <Text style={s.subText}>No shows to display</Text>
          ) : (
            parkShows.map((show) => {
              const prePostOn = !show.autoPrePostDisabled;
              const liveOn = !show.autoLiveDisabled;
              return (
                <View key={show.id} style={s.showBlock}>
                  <Text style={s.zoneName}>{show.name}</Text>
                  <Text style={s.subText}>{formatShowStatus(show)}</Text>
                  <View style={s.autoRow}>
                    <Text style={s.autoLabel}>Auto pre/post</Text>
                    <Switch
                      value={prePostOn}
                      disabled={!isConnected}
                      onValueChange={(v) => {
                        setShowInstanceOverride(show.id, {
                          autoPrePostDisabled: !v,
                        });
                        saveToStorage();
                      }}
                      trackColor={{
                        false: colors.borderFocus,
                        true: colors.primary,
                      }}
                      thumbColor="#fff"
                    />
                  </View>
                  {show.kind === "fireworks" && (
                    <View style={s.autoRow}>
                      <Text style={s.autoLabel}>Auto live</Text>
                      <Switch
                        value={liveOn}
                      disabled={!isConnected}
                        onValueChange={(v) => {
                          setShowInstanceOverride(show.id, {
                            autoLiveDisabled: !v,
                          });
                          saveToStorage();
                        }}
                        trackColor={{
                          false: colors.borderFocus,
                          true: colors.primary,
                        }}
                        thumbColor="#fff"
                      />
                    </View>
                  )}
                  {show.kind === "parade" && (
                    <Text style={s.autoHint}>
                      Start live manually when you&apos;re on the parade route.
                      Auto pre/post still runs if enabled above.
                    </Text>
                  )}
                  <View style={[s.showControls, !isConnected && s.quickBtnDisabled]}>
                      <View style={s.showBtnRow}>
                        {(["pre", "live", "post"] as const).map((phase) => (
                          <TouchableOpacity
                            key={phase}
                            style={s.showMiniBtn}
                            disabled={
                              !isSessionReady || runningShowPhase === `${show.id}:${phase}`
                            }
                            onPress={() => runPhase(show, phase)}
                          >
                            {runningShowPhase === `${show.id}:${phase}` ? (
                              <ActivityIndicator
                                size="small"
                                color={colors.primary}
                              />
                            ) : (
                              <Text style={s.showMiniBtnText}>
                                {phase === "live"
                                  ? "Start"
                                  : phase === "pre"
                                    ? "Pre"
                                    : "Post"}
                              </Text>
                            )}
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={s.showBtnRow}>
                        <TouchableOpacity
                          style={[s.showMiniBtn, s.showStopBtn]}
                          disabled={!isSessionReady}
                          onPress={() => void stopShowMode()}
                        >
                          <Text
                            style={[
                              s.showMiniBtnText,
                              { color: colors.danger },
                            ]}
                          >
                            Stop
                          </Text>
                        </TouchableOpacity>
                      </View>
                  </View>
                </View>
              );
            })
          )}
      </View>

      {/* Capture state and BLE Data */}
      <View style={s.card}>
        <View style={s.row}>
          <IconSparkles size={15} color={colors.textSecondary} />
          <Text style={[s.label, { flex: 1 }]}>Capture & BLE Data</Text>
          <TouchableOpacity style={s.iconBtn} onPress={openLogMarker} disabled={!isConnected}>
            <IconPlus size={18} color={isConnected ? colors.primary : colors.textMuted} />
          </TouchableOpacity>
        </View>
        <Text style={s.subText}>{bleCaptureActive ? `Recording BLE Data · ${bleCaptureLiveCount} packets` : "BLE capture is not recording"}</Text>
        {events.length === 0 ? <Text style={s.subText}>No BLE Data events yet</Text> : events.map((e, i) => (
          <View key={i} style={s.row}>
            <IconBolt size={11} color={colors.primary} />
            <Text style={[s.subText, { marginLeft: 4, flex: 1 }]} numberOfLines={2}>{e}</Text>
          </View>
        ))}
      </View>

      <Modal visible={logMarkerOpen} transparent animationType="slide" onRequestClose={() => setLogMarkerOpen(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Log marker</Text>
            <Text style={s.subText}>{logMarkerTimestamp}</Text>
            <TextInput style={s.markerInput} value={logMarkerDraft} onChangeText={setLogMarkerDraft} placeholder="Describe this moment" placeholderTextColor={colors.textMuted} autoFocus />
            <View style={s.snippetRow}>
              {logMarkerSnippets.map((snippet) => (
                <View key={snippet.key} style={s.snippetChip}>
                  <TouchableOpacity onPress={() => setLogMarkerDraft((draft) => `${draft}${draft ? " " : ""}${snippet.value}`)}><Text style={s.snippetText}>{snippet.key}</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => { setLogMarkerSnippets(logMarkerSnippets.filter((item) => item.key !== snippet.key)); saveToStorage(); }}><IconTrash size={13} color={colors.danger} /></TouchableOpacity>
                </View>
              ))}
            </View>
            <View style={s.snippetEditor}>
              <TextInput style={s.markerInput} value={snippetKey} onChangeText={setSnippetKey} placeholder="Snippet label" placeholderTextColor={colors.textMuted} />
              <TextInput style={s.markerInput} value={snippetValue} onChangeText={setSnippetValue} placeholder="Snippet text" placeholderTextColor={colors.textMuted} />
              <TouchableOpacity style={s.iconBtn} onPress={addLogMarkerSnippet}><IconPlus size={18} color={colors.primary} /></TouchableOpacity>
            </View>
            <View style={s.modalActions}>
              <TouchableOpacity style={s.modalButton} onPress={() => setLogMarkerOpen(false)}><Text style={s.subText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[s.modalButton, !logMarkerDraft.trim() && s.quickBtnDisabled]} disabled={!logMarkerDraft.trim()} onPress={sendLogMarker}><Text style={s.syncBtnText}>Send</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = (
  c: ReturnType<typeof import("../utils/theme").useTheme>["colors"],
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    content: { padding: 16, gap: 12 },
    captureBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: c.danger + "18",
      borderRadius: 10,
      padding: 12,
      borderWidth: 1,
      borderColor: c.danger + "55",
    },
    captureBannerText: {
      color: c.textPrimary,
      fontSize: 13,
      fontWeight: "600",
      flex: 1,
    },
    syncBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: c.primary + "18",
      borderColor: c.primary + "44",
      borderWidth: 1,
      borderRadius: 10,
      padding: 12,
    },
    syncBannerMuted: {
      backgroundColor: c.surface,
      borderColor: c.border,
    },
    syncBannerTitle: {
      color: c.textPrimary,
      fontSize: 13,
      fontWeight: "600",
      flex: 1,
    },
    syncBannerSub: { color: c.textMuted, fontSize: 12, marginTop: 2 },
    syncBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      alignSelf: "flex-start",
      marginTop: 8,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: c.primary + "14",
    },
    syncBtnText: { color: c.primary, fontSize: 13, fontWeight: "600" },
    liveFetchBtn: {
      marginLeft: "auto",
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 8,
      backgroundColor: c.primary + "14",
    },
    liveFetchBtnText: { color: c.primary, fontSize: 12, fontWeight: "600" },
    card: {
      backgroundColor: c.surface,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: c.border,
      gap: 8,
    },
    iconBtn: {
      padding: 6,
      borderRadius: 8,
      backgroundColor: c.primary + "14",
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "#00000088",
    },
    modalCard: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      padding: 20,
      gap: 12,
    },
    modalTitle: { color: c.textPrimary, fontSize: 18, fontWeight: "700" },
    markerInput: {
      flex: 1,
      minHeight: 40,
      backgroundColor: c.background,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.borderFocus,
      color: c.textPrimary,
      paddingHorizontal: 10,
      fontSize: 14,
    },
    snippetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    snippetChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 9,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: c.primary + "14",
    },
    snippetText: { color: c.primary, fontSize: 12, fontWeight: "600" },
    snippetEditor: { flexDirection: "row", alignItems: "center", gap: 8 },
    modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
    modalButton: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: c.surfaceAlt },
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    label: {
      color: c.textSecondary,
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    brightnessInput: {
      marginLeft: "auto",
      width: 72,
      textAlign: "right",
      backgroundColor: c.background,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.borderFocus,
      color: c.textPrimary,
      paddingVertical: 6,
      paddingHorizontal: 8,
      fontSize: 14,
      fontWeight: "600",
    },
    statusText: {
      color: c.textPrimary,
      fontSize: 14,
      fontWeight: "500",
      flex: 1,
    },
    subText: { color: c.textMuted, fontSize: 12 },
    badge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 20,
      borderWidth: 1,
    },
    badgeText: { fontSize: 13, fontWeight: "600" },
    effectText: { color: c.textPrimary, fontSize: 15, fontWeight: "500" },
    clearBtn: {
      marginLeft: "auto",
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: c.danger + "18",
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.danger + "44",
    },
    clearBtnText: { fontSize: 12, fontWeight: "600" },
    zoneRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 2,
    },
    zoneDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.success,
    },
    zoneName: { color: c.textPrimary, fontSize: 13, fontWeight: "500" },
    setRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    setChip: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
    },
    setChipActive: { borderColor: c.primary, backgroundColor: c.primaryDim },
    setChipText: { color: c.textMuted, fontSize: 13, fontWeight: "500" },
    paradeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    paradeBtn: {
      flex: 1,
      minWidth: 90,
      paddingVertical: 10,
      paddingHorizontal: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
    },
    paradeBtnActive: { borderColor: c.primary, backgroundColor: c.primaryDim },
    paradeBtnEnd: { borderColor: c.danger + "66" },
    paradeBtnText: {
      color: c.textPrimary,
      fontSize: 12,
      fontWeight: "600",
      textAlign: "center",
    },
    quickRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    quickBtnWrap: { flex: 1, minWidth: 100, position: "relative" },
    quickBtn: {
      flex: 1,
      minWidth: 100,
      paddingVertical: 12,
      paddingHorizontal: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      gap: 4,
    },
    quickBtnDisabled: { opacity: 0.45 },
    quickBtnText: {
      color: c.textPrimary,
      fontSize: 11,
      fontWeight: "600",
      textAlign: "center",
    },
    quickBtnTextDisabled: { color: c.textMuted },
    quickBtnHint: { color: c.textMuted, fontSize: 10, textAlign: "center" },
    quickGear: { position: "absolute", top: 4, right: 4, padding: 4 },
    showRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    showBlock: {
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: c.border,
      gap: 6,
    },
    showControls: { gap: 4, marginTop: 4 },
    autoRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      paddingRight: 4,
    },
    autoLabel: { fontSize: 12, color: c.textMuted, flex: 1 },
    autoHint: { fontSize: 11, color: c.textMuted, fontStyle: "italic" },
    showBtnRow: { flexDirection: "row", gap: 4 },
    showMiniBtn: {
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
      minWidth: 44,
      alignItems: "center",
    },
    showStopBtn: { borderColor: c.danger + "66" },
    showMiniBtnText: { fontSize: 10, fontWeight: "600", color: c.textPrimary },
  });
