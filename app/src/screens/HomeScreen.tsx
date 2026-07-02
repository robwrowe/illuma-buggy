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
} from "react-native";
import Slider from "@react-native-community/slider";
import IconBluetooth from "@tabler/icons-react-native/dist/esm/icons/IconBluetooth";
import IconBluetoothOff from "@tabler/icons-react-native/dist/esm/icons/IconBluetoothOff";
import IconBulb from "@tabler/icons-react-native/dist/esm/icons/IconBulb";
import IconSparkles from "@tabler/icons-react-native/dist/esm/icons/IconSparkles";
import IconBolt from "@tabler/icons-react-native/dist/esm/icons/IconBolt";
import IconX from "@tabler/icons-react-native/dist/esm/icons/IconX";
import IconWifi from "@tabler/icons-react-native/dist/esm/icons/IconWifi";
import IconWifiOff from "@tabler/icons-react-native/dist/esm/icons/IconWifiOff";
import IconMap from "@tabler/icons-react-native/dist/esm/icons/IconMap";

import IconSettings from "@tabler/icons-react-native/dist/esm/icons/IconSettings";
import IconMoon from "@tabler/icons-react-native/dist/esm/icons/IconMoon";
import IconRefresh from "@tabler/icons-react-native/dist/esm/icons/IconRefresh";

import { useBLE } from "../hooks/useBLE";
import { useBoardSync } from "../hooks/useBoardSync";
import { useAppStore } from "../stores/store";
import { bleService } from "../services/BLEService";
import { applyPresetToBoard } from "../utils/bleBoardSync";
import { formatSyncStatusLabel } from "../utils/boardSyncState";
import { requestFullBoardSync } from "../utils/connectBootstrap";
import { useTheme } from "../utils/theme";
import { useNavigation } from "@react-navigation/native";
import { PresetPickerModal } from "./MbMappingSections";
import { useParkShows, formatShowStatus } from "../hooks/useParkShows";
import { runShowPhase, stopShowMode } from "../services/showControl";

const OVERRIDE_LABELS = [
  "—",
  "Zone",
  "Manual",
  "Show Mode",
  "MagicBand+",
  "Starlight Wand",
];
const OVERRIDE_COLORS = (
  c: ReturnType<typeof import("../utils/theme").useTheme>["colors"],
) => [c.textMuted, c.success, c.warning, "#f472b6", c.primary, "#c084fc"];

export default function HomeScreen() {
  const { colors } = useTheme();
  const s = styles(colors);
  const navigation = useNavigation();
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
    overrideDetail,
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
  } = useAppStore();

  const [brightness, setBrightness] = useState(deviceStatus?.brightness ?? 128);
  const [events, setEvents] = useState<string[]>([]);
  const [ftbPickerOpen, setFtbPickerOpen] = useState(false);
  const [firingZone, setFiringZone] = useState(false);
  const [runningShowPhase, setRunningShowPhase] = useState<string | null>(null);

  const { shows: parkShows, fetchError: parkShowsError } = useParkShows(
    activePark,
    isConnected,
  );

  const runPhase = async (
    show: (typeof parkShows)[0],
    phase: "pre" | "live" | "post",
  ) => {
    if (!isConnected) return;
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

  // Sync slider with device
  useEffect(() => {
    if (deviceStatus?.brightness !== undefined)
      setBrightness(deviceStatus.brightness);
  }, [deviceStatus?.brightness]);

  // BLE effect event feed (Starlight Wand + MagicBand+)
  useEffect(() => {
    return bleService.onMessage((msg) => {
      if (msg.type === "sw_color") {
        const label = `Wand palette ${msg.palette} → R${msg.r} G${msg.g} B${msg.b}`;
        setEvents((prev) => [label, ...prev].slice(0, 12));
      } else if (msg.type === "sw_debug") {
        const label = `Wand [${msg.reason}] ${msg.hex} (${msg.len}b)`;
        setEvents((prev) => [label, ...prev].slice(0, 12));
      } else if (msg.type === "sw_event") {
        const name = msg.name ? ` (${msg.name})` : "";
        setEvents((prev) =>
          [`Wand: ${String(msg.event)}${name}`, ...prev].slice(0, 12),
        );
      } else if (msg.type === "ble_event" || msg.type === "ble_color") {
        const label =
          msg.type === "ble_color"
            ? `MB+ color → R${msg.r} G${msg.g} B${msg.b}`
            : `MB+: ${String(msg.event)}`;
        setEvents((prev) => [label, ...prev].slice(0, 12));
      }
    });
  }, []);

  const overrideIndex = deviceStatus?.override ?? 0;
  const overrideColor =
    OVERRIDE_COLORS(colors)[overrideIndex] ?? colors.textMuted;
  const currentPreset = presets.find(
    (p) => p.id === deviceStatus?.currentPreset,
  );
  const activeZones = zones.filter((z) => activeZoneIds.includes(z.id));
  const overrideActive = overrideIndex > 0;
  const fireZone = activeZones.find((z) => z.presetId) ?? null;
  const firePreset = fireZone
    ? presets.find((p) => p.id === fireZone.presetId)
    : null;
  const ftbPreset = ftbPresetId
    ? presets.find((p) => p.id === ftbPresetId)
    : null;

  const effectDescription = (() => {
    if (!deviceStatus) return null;
    if (overrideDetail) return overrideDetail;
    if (currentPreset) return currentPreset.name;
    if (activeZones.length > 0) {
      const z = activeZones[0];
      const p = presets.find((pr) => pr.id === z.presetId);
      if (p) return `${z.name} → ${p.name}`;
      if (z.presetId) return `${z.name} (preset missing)`;
      return z.name;
    }
    if (overrideIndex === 0) return "Idle — no active override";
    if (overrideIndex === 1) return "Zone preset";
    if (overrideIndex === 2) return "Manual preset";
    if (overrideIndex === 3)
      return deviceStatus.showType
        ? `Show: ${deviceStatus.showType}${deviceStatus.showPhase ? ` (${deviceStatus.showPhase})` : ""}`
        : "Show mode";
    if (overrideIndex === 4) return "MagicBand+ effect";
    if (overrideIndex === 5) return "Starlight Wand effect";
    return "Active override";
  })();

  const clearEffect = () => {
    bleService.sendOverrideClear();
    setOverrideDetail(null);
  };

  const handleFireZone = async () => {
    if (!isConnected || firingZone) return;
    if (!isSessionReady) {
      Alert.alert(
        "Board syncing",
        formatSyncStatusLabel(boardSync, connectionState) +
          "\n\nWait until the status shows Ready, then try again. Use Sync Board if it stays stuck.",
      );
      return;
    }
    if (!fireZone?.presetId) {
      Alert.alert("No preset", "This zone has no preset assigned.");
      return;
    }
    const preset = presets.find((p) => p.id === fireZone.presetId);
    if (!preset) {
      Alert.alert(
        "Preset missing",
        `Zone "${fireZone.name}" references a preset that is not in your library.`,
      );
      return;
    }
    setFiringZone(true);
    try {
      const s = useAppStore.getState();
      // zone_trigger is blocked while wand/MB/show override is active — clear first
      if ((deviceStatus?.override ?? 0) > 0) {
        await bleService.sendOverrideClear();
        await new Promise((r) => setTimeout(r, 250));
      }
      const ok = await applyPresetToBoard(
        preset,
        s.recallState,
        s.customSegmentLayouts,
      );
      if (!ok) {
        Alert.alert(
          "Fire failed",
          "Could not apply the preset. The board may still be syncing presets in the background — wait a few seconds and try again.",
        );
      }
    } finally {
      setFiringZone(false);
    }
  };

  const syncStatusLabel = formatSyncStatusLabel(boardSync, connectionState);
  const commandsBlocked = isConnected && !isSessionReady;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {commandsBlocked && (
        <View style={s.syncBanner}>
          <ActivityIndicator size="small" color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={s.syncBannerTitle}>{syncStatusLabel}</Text>
            {boardSync.presetProgress && (
              <Text style={s.syncBannerSub}>
                Presets {boardSync.presetProgress.current}/
                {boardSync.presetProgress.total}
              </Text>
            )}
          </View>
        </View>
      )}

      {isConnected && isSessionReady && boardSync.backgroundBusy && (
        <View style={[s.syncBanner, s.syncBannerMuted]}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={s.syncBannerTitle}>{syncStatusLabel}</Text>
        </View>
      )}

      {bleCaptureActive && (
        <TouchableOpacity
          style={s.captureBanner}
          onPress={() => navigation.navigate("Capture" as never)}
        >
          <IconBolt size={16} color={colors.danger} />
          <Text style={s.captureBannerText}>
            Recording BLE · {bleCaptureLiveCount} packets — tap to view
          </Text>
        </TouchableOpacity>
      )}

      {/* Quick actions */}
      {isConnected && isSessionReady && (
        <View style={s.card}>
          <Text style={s.label}>Quick Actions</Text>
          <View style={s.quickRow}>
            <View style={s.quickBtnWrap}>
              <TouchableOpacity
                style={s.quickBtn}
                onPress={() => {
                  bleService.sendFadeToBlack(
                    ftbPresetId || undefined,
                    bleEffectTransitionMs || 800,
                  );
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
              disabled={overrideIndex === 0}
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
                (!fireZone?.presetId || firingZone || !isSessionReady) && s.quickBtnDisabled,
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
      )}

      <PresetPickerModal
        visible={ftbPickerOpen}
        title="Fade to Black preset"
        presets={presets}
        selectedId={ftbPresetId}
        emptyLabel="Pure black (no preset)"
        onSelect={(id) => {
          setFtbPresetId(id);
          saveToStorage();
        }}
        onClose={() => setFtbPickerOpen(false)}
        colors={colors}
      />

      {/* Park shows */}
      {activePark?.themeParksApiEntityId && (
        <View style={s.card}>
          <View style={s.row}>
            <IconMap size={15} color={colors.textSecondary} />
            <Text style={s.label}>{activePark.name} — Shows</Text>
          </View>
          {parkShowsError ? (
            <Text style={s.subText}>{parkShowsError}</Text>
          ) : parkShows.length === 0 ? (
            <Text style={s.subText}>
              No assigned shows in window — configure under Settings → Park Shows
            </Text>
          ) : (
            parkShows.map((show) => (
              <View key={show.id} style={s.showRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.zoneName}>{show.name}</Text>
                  <Text style={s.subText}>{formatShowStatus(show)}</Text>
                  <View style={s.autoRow}>
                    <Text style={s.autoLabel}>Auto pre/post</Text>
                    <Switch
                      value={!show.autoStartDisabled}
                      onValueChange={(v) => {
                        setShowInstanceOverride(show.id, { autoStartDisabled: !v });
                        saveToStorage();
                      }}
                      trackColor={{ false: colors.borderFocus, true: colors.primary }}
                      thumbColor="#fff"
                      disabled={show.binding.autoStartDisabled}
                    />
                  </View>
                </View>
                {isConnected && (
                  <View style={s.showControls}>
                    <View style={s.showBtnRow}>
                      {(["pre", "live", "post"] as const).map((phase) => (
                        <TouchableOpacity
                          key={phase}
                          style={s.showMiniBtn}
                          disabled={runningShowPhase === `${show.id}:${phase}`}
                          onPress={() => runPhase(show, phase)}
                        >
                          {runningShowPhase === `${show.id}:${phase}` ? (
                            <ActivityIndicator size="small" color={colors.primary} />
                          ) : (
                            <Text style={s.showMiniBtnText}>
                              {phase === "live" ? "Start" : phase === "pre" ? "Pre" : "Post"}
                            </Text>
                          )}
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={s.showBtnRow}>
                      <TouchableOpacity
                        style={[s.showMiniBtn, s.showStopBtn]}
                        onPress={() => void stopShowMode()}
                      >
                        <Text style={[s.showMiniBtnText, { color: colors.danger }]}>
                          Stop
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            ))
          )}
        </View>
      )}

      {/* Connection & sync */}
      <View style={s.card}>
        <View style={s.row}>
          {isConnected ? (
            <IconBluetooth size={18} color={colors.success} />
          ) : (
            <IconBluetoothOff size={18} color={colors.danger} />
          )}
          <Text style={s.statusText}>
            {connectionState === "connected"
              ? isSessionReady
                ? "Connected — commands enabled"
                : "Connected — syncing board…"
              : connectionState === "scanning"
                ? "Scanning…"
                : connectionState === "connecting"
                  ? "Connecting…"
                  : connectionState === "disconnected"
                    ? "Disconnected — will retry"
                    : "Connection error — retrying"}
          </Text>
          {(connectionState === "scanning" ||
            connectionState === "connecting" ||
            commandsBlocked) && (
            <ActivityIndicator
              size="small"
              color={colors.primary}
              style={{ marginLeft: "auto" }}
            />
          )}
        </View>
        {isConnected && (
          <Text style={s.subText}>{syncStatusLabel}</Text>
        )}
        {isConnected && boardSync.mode !== "none" && (
          <Text style={s.subText}>
            Sync mode: {boardSync.mode === "quick" ? "quick reconnect" : "full"}
            {deviceStatus?.boardPresetCount != null
              ? ` · ${deviceStatus.boardPresetCount} preset(s) on board`
              : ""}
            {presets.length > 0 ? ` · ${presets.length} in app` : ""}
          </Text>
        )}
        {isConnected && (
          <TouchableOpacity
            style={s.syncBtn}
            onPress={() => requestFullBoardSync()}
          >
            <IconRefresh size={14} color={colors.primary} />
            <Text style={s.syncBtnText}>Sync board config</Text>
          </TouchableOpacity>
        )}
        {deviceStatus && (
          <View style={s.row}>
            {deviceStatus.wifiConnected ? (
              <IconWifi size={13} color={colors.success} />
            ) : (
              <IconWifiOff size={13} color={colors.danger} />
            )}
            <Text style={s.subText}>
              WLED: {deviceStatus.wifiConnected ? "connected" : "not connected"}
              {!deviceStatus.wifiConnected && isSessionReady
                ? " — preset apply will fail until WiFi is up"
                : ""}
            </Text>
          </View>
        )}
      </View>

      {/* Current Mode */}
      <View style={s.card}>
        <Text style={s.label}>Current Effect</Text>
        {deviceStatus ? (
          <>
            <View style={s.row}>
              <View
                style={[
                  s.badge,
                  {
                    backgroundColor: overrideColor + "22",
                    borderColor: overrideColor,
                  },
                ]}
              >
                <Text style={[s.badgeText, { color: overrideColor }]}>
                  {OVERRIDE_LABELS[overrideIndex]}
                </Text>
              </View>
              {overrideActive && (
                <TouchableOpacity style={s.clearBtn} onPress={clearEffect}>
                  <IconX size={14} color={colors.danger} />
                  <Text style={[s.clearBtnText, { color: colors.danger }]}>
                    Clear Effect
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={s.effectText}>
              {effectDescription ?? (isConnected ? "Waiting for status…" : "Not connected")}
            </Text>
            {currentPreset && overrideIndex <= 2 && (
              <Text style={s.subText}>Preset: {currentPreset.name}</Text>
            )}
          </>
        ) : (
          <Text style={s.subText}>
            {isConnected ? "Waiting for status…" : "Not connected"}
          </Text>
        )}
      </View>

      {/* Active Zones */}
      <View style={s.card}>
        <View style={s.row}>
          <IconMap size={15} color={colors.textSecondary} />
          <Text style={s.label}>Active Zones</Text>
          <Switch
            value={zonesEnabled}
            onValueChange={(v) => {
              setZonesEnabled(v);
              saveToStorage();
            }}
            trackColor={{ false: colors.borderFocus, true: colors.primary }}
            thumbColor="#fff"
            style={{ marginLeft: "auto" }}
          />
        </View>
        {activeZones.length === 0 ? (
          <Text style={s.subText}>
            {zonesEnabled ? "Not in any zone" : "Zone triggers paused"}
          </Text>
        ) : (
          activeZones.map((z) => {
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
          })
        )}
      </View>

      {/* Brightness */}
      <View style={s.card}>
        <View style={s.row}>
          <IconBulb size={15} color={colors.textSecondary} />
          <Text style={s.label}>Brightness</Text>
          <Text
            style={[s.label, { marginLeft: "auto", color: colors.textPrimary }]}
          >
            {brightness}
          </Text>
        </View>
        <Slider
          minimumValue={0}
          maximumValue={255}
          step={1}
          value={brightness}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.borderFocus}
          thumbTintColor={colors.primary}
          onValueChange={setBrightness}
          onSlidingComplete={(v) => bleService.sendBrightness(Math.round(v))}
          disabled={!isSessionReady}
        />
      </View>

      {/* BLE effect events — always visible when connected */}
      {isConnected && (
        <View style={s.card}>
          <View style={s.row}>
            <IconSparkles size={15} color={colors.textSecondary} />
            <Text style={s.label}>BLE Effect Events</Text>
          </View>
          {events.length === 0 ? (
            <Text style={s.subText}>
              Wave the wand — raw packets appear here as [packet] hex dumps
            </Text>
          ) : (
            events.map((e, i) => (
              <View
                key={i}
                style={[s.row, { opacity: Math.max(0.3, 1 - i * 0.08) }]}
              >
                <IconBolt size={11} color={colors.primary} />
                <Text
                  style={[s.subText, { marginLeft: 4, flex: 1 }]}
                  numberOfLines={2}
                >
                  {e}
                </Text>
              </View>
            ))
          )}
        </View>
      )}
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
    syncBannerTitle: { color: c.textPrimary, fontSize: 13, fontWeight: "600", flex: 1 },
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
    card: {
      backgroundColor: c.surface,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: c.border,
      gap: 8,
    },
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    label: {
      color: c.textSecondary,
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.8,
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
    showControls: { gap: 4, alignItems: "flex-end" },
    autoRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 6,
    },
    autoLabel: { fontSize: 11, color: c.textMuted },
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
