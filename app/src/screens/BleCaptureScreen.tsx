import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert,
} from 'react-native';
import IconBolt from '@tabler/icons-react-native/dist/esm/icons/IconBolt';
import IconDownload from '@tabler/icons-react-native/dist/esm/icons/IconDownload';
import IconTrash from '@tabler/icons-react-native/dist/esm/icons/IconTrash';
import IconX from '@tabler/icons-react-native/dist/esm/icons/IconX';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { useAppStore } from '../stores/store';
import { useTheme } from '../utils/theme';
import {
  CAPTURE_DURATION_MANUAL, CAPTURE_DURATION_PRESETS, MAX_PACKETS_PER_SESSION,
  describeBlePacket, formatCaptureExport, isCaptureDurationPreset,
  BleCaptureSession,
} from '../utils/bleCapture';
import { analyzeBeaconTracks, type BeaconTrack } from '../utils/beaconTrackAnalysis';
import { getBestAvailableFixSync } from '../utils/locationRuntimeBridge';
import {
  getPhoneBleScanHealth,
  getPhoneBleScanStatus,
  startPhoneBleScan,
} from '../utils/phoneBleScan';
import { getGattActivitySince } from '../services/BLEService';

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function deviceIdSuffix(deviceId?: string): string {
  if (!deviceId) return '';
  return deviceId.length > 8 ? deviceId.slice(-8) : deviceId;
}

function gpsShort(lat?: number, lng?: number): string {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function packetMetaParts(p: {
  rssi: number;
  deviceId?: string;
  lat?: number;
  lng?: number;
  gpsUpdatedAt?: number;
  receivedAt?: number;
}): string {
  const parts = [`rssi ${p.rssi}`];
  if (p.deviceId) parts.push(`…${deviceIdSuffix(p.deviceId)}`);
  const gps = gpsShort(p.lat, p.lng);
  if (gps) {
    const ageMs = p.gpsUpdatedAt != null && p.receivedAt != null
      ? Math.max(0, p.receivedAt - p.gpsUpdatedAt)
      : null;
    parts.push(`${gps}${ageMs != null ? ` (gps ${Math.round(ageMs / 1000)}s old)` : ''}`);
  } else {
    parts.push('no gps');
  }
  return parts.join(' · ');
}

const TRACK_SORT: Record<BeaconTrack['classification'], number> = {
  moving_independent: 0,
  moving_correlated: 1,
  fixed: 2,
  insufficient_gps: 3,
};

const TRACK_LABEL: Record<BeaconTrack['classification'], string> = {
  moving_independent: 'moving · independent',
  moving_correlated: 'moving · with you',
  fixed: 'likely fixed',
  insufficient_gps: 'insufficient',
};

async function shareSession(session: BleCaptureSession) {
  const body = formatCaptureExport(session);
  const path = `${FileSystem.cacheDirectory}ble-capture-${session.id}.txt`;
  await FileSystem.writeAsStringAsync(path, body);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType: 'text/plain', dialogTitle: session.name });
  } else {
    Alert.alert('Export', body.slice(0, 2000) + (body.length > 2000 ? '\n…' : ''));
  }
}

const SESSION_LABEL_SUGGESTIONS = ['Parade', 'Fireworks', 'Show'];

export default function BleCaptureScreen() {
  const { colors } = useTheme();
  const s = styles(colors);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tracksExpandedId, setTracksExpandedId] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [healthNow, setHealthNow] = useState(Date.now());
  const [customMinutes, setCustomMinutes] = useState('');
  const scanUnsubRef = useRef<(() => void) | null>(null);

  const {
    bleCaptureActive, bleCaptureDurationSec, bleCaptureStartedAt, bleCaptureEndsAt,
    bleCaptureSegment, bleCaptureLiveCount, bleCaptureBuffer, bleCaptureSessions, bleCaptureDraftName,
    showSettings, userLocation,
    setBleCaptureDurationSec, setBleCaptureDraftName,
    startBleCapture, stopBleCapture, appendBleCapturePacket,
    deleteBleCaptureSession,
    updateBleCapturePacketNote,
  } = useAppStore();

  useEffect(() => {
    if (!bleCaptureActive || !bleCaptureStartedAt) return;
    const tick = () => {
      const now = Date.now();
      setElapsedMs(now - bleCaptureStartedAt);
      setHealthNow(now);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [bleCaptureActive, bleCaptureStartedAt]);

  useEffect(() => {
    if (!bleCaptureActive || !bleCaptureEndsAt) return;
    const remaining = bleCaptureEndsAt - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => {
      stopBleCapture('timeout');
      if (scanUnsubRef.current) {
        scanUnsubRef.current();
        scanUnsubRef.current = null;
      }
    }, remaining);
    return () => clearTimeout(timer);
  }, [bleCaptureActive, bleCaptureEndsAt]);

  useEffect(() => () => {
    if (scanUnsubRef.current) {
      scanUnsubRef.current();
      scanUnsubRef.current = null;
    }
  }, []);

  const handleStart = () => {
    if (bleCaptureActive) return;
    if (
      bleCaptureDurationSec > 0
      && !isCaptureDurationPreset(bleCaptureDurationSec)
      && bleCaptureDurationSec < 60
    ) {
      Alert.alert('Duration', 'Enter at least 1 minute for a custom auto-stop duration.');
      return;
    }
    startBleCapture();
    scanUnsubRef.current = startPhoneBleScan((pkt) => {
      appendBleCapturePacket({
        boardTs: Date.now(),
        tag: pkt.tag,
        rssi: pkt.rssi,
        hex: pkt.hex,
        len: pkt.len,
        deviceId: pkt.deviceId,
      });
    });
  };

  const handleStop = () => {
    stopBleCapture('manual');
    if (scanUnsubRef.current) {
      scanUnsubRef.current();
      scanUnsubRef.current = null;
    }
  };

  const remainingMs = bleCaptureEndsAt ? Math.max(0, bleCaptureEndsAt - Date.now()) : null;
  const usingCustomDuration = bleCaptureDurationSec > 0 && !isCaptureDurationPreset(bleCaptureDurationSec);
  const gpsFix = bleCaptureActive ? getBestAvailableFixSync(userLocation, healthNow) : null;
  const gpsAgeSec = gpsFix ? Math.max(0, Math.round((healthNow - gpsFix.updatedAt) / 1000)) : null;
  const scanStatus = getPhoneBleScanStatus();
  const scanAgeSec = scanStatus.lastPacketAt != null
    ? Math.max(0, Math.round((healthNow - scanStatus.lastPacketAt) / 1000))
    : null;
  const scanHealth = getPhoneBleScanHealth();
  const callbackAgeSec = scanHealth.lastCallbackAt != null
    ? Math.max(0, Math.round((healthNow - scanHealth.lastCallbackAt) / 1000))
    : null;
  const gattActivity = getGattActivitySince(bleCaptureStartedAt ?? healthNow);
  const lastGattActivity = gattActivity[gattActivity.length - 1] ?? null;
  const gattAgeSec = lastGattActivity
    ? Math.max(0, Math.round((healthNow - lastGattActivity.end) / 1000))
    : null;
  const freshnessColor = (ageSec: number | null) => {
    if (ageSec == null || ageSec >= 120) return colors.danger;
    if (ageSec >= 30) return colors.warning;
    return colors.success;
  };

  const applyCustomMinutes = (raw: string) => {
    setCustomMinutes(raw);
    const n = parseInt(raw, 10);
    if (!raw.trim() || Number.isNaN(n) || n <= 0) return;
    setBleCaptureDurationSec(n * 60);
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.intro}>
        Record Disney BLE packets during a parade or fireworks show, straight off your phone's
        Bluetooth radio. The board is not part of the capture path, but an active board connection
        still shares the phone's Bluetooth radio.
      </Text>

      {/* Recorder */}
      <View style={s.card}>
        <View style={s.row}>
          <IconBolt size={16} color={bleCaptureActive ? colors.danger : colors.textSecondary} />
          <Text style={s.cardTitle}>Record</Text>
          {bleCaptureActive && (
            <View style={s.recBadge}>
              <Text style={s.recBadgeText}>REC</Text>
            </View>
          )}
        </View>
        {bleCaptureActive && (
          <View style={s.healthRow}>
            <Text style={[s.healthText, { color: freshnessColor(gpsAgeSec) }]}>
              GPS · {gpsAgeSec == null ? 'no fresh fix' : `${gpsAgeSec}s since fix`}
            </Text>
            <Text style={[
              s.healthText,
              {
                color: !scanStatus.active
                  ? colors.danger
                  : freshnessColor(scanAgeSec),
              },
            ]}>
              BLE · {!scanStatus.active
                ? 'scan stopped'
                : scanAgeSec == null
                  ? 'active · waiting for packet'
                  : `${scanAgeSec}s since packet`}
            </Text>
            <Text style={[s.healthText, { color: freshnessColor(callbackAgeSec) }]}>
              Radio · {scanHealth.callbacksLast10s}/10s · {scanHealth.totalCallbackCount} total
              {callbackAgeSec == null ? ' · no callbacks' : ` · last ${callbackAgeSec}s`}
            </Text>
            <Text style={[
              s.healthText,
              { color: gattAgeSec != null && gattAgeSec < 5 ? colors.warning : colors.textMuted },
            ]}>
              GATT · {gattActivity.length} events
              {lastGattActivity
                ? ` · last ${lastGattActivity.kind} ${gattAgeSec}s ago`
                : ' · quiet'}
            </Text>
          </View>
        )}

        {bleCaptureActive && showSettings.autoCaptureEnabled && (
          <Text style={s.sub}>
            A capture may have been auto-started for a nearby show — stopping here ends that
            session too.
          </Text>
        )}

        <Text style={s.label}>Session name</Text>
        <TextInput
          style={s.input}
          value={bleCaptureDraftName}
          onChangeText={setBleCaptureDraftName}
          editable={!bleCaptureActive}
          placeholder="Parade capture"
          placeholderTextColor={colors.textMuted}
        />
        <View style={s.chipRow}>
          {SESSION_LABEL_SUGGESTIONS.map(label => (
            <TouchableOpacity
              key={label}
              style={s.chip}
              onPress={() => !bleCaptureActive && setBleCaptureDraftName(label)}
              disabled={bleCaptureActive}
            >
              <Text style={s.chipText}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.label}>Duration</Text>
        <View style={s.chipRow}>
          <TouchableOpacity
            style={[s.chip, bleCaptureDurationSec === CAPTURE_DURATION_MANUAL && s.chipActive]}
            onPress={() => {
              if (bleCaptureActive) return;
              setCustomMinutes('');
              setBleCaptureDurationSec(CAPTURE_DURATION_MANUAL);
            }}
            disabled={bleCaptureActive}
          >
            <Text style={[s.chipText, bleCaptureDurationSec === CAPTURE_DURATION_MANUAL && s.chipTextActive]}>
              Manual stop
            </Text>
          </TouchableOpacity>
          {CAPTURE_DURATION_PRESETS.map(({ label, sec }) => (
            <TouchableOpacity
              key={sec}
              style={[s.chip, bleCaptureDurationSec === sec && s.chipActive]}
              onPress={() => {
                if (bleCaptureActive) return;
                setCustomMinutes('');
                setBleCaptureDurationSec(sec);
              }}
              disabled={bleCaptureActive}
            >
              <Text style={[s.chipText, bleCaptureDurationSec === sec && s.chipTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={s.customDurationRow}>
          <Text style={s.customDurationLabel}>Custom</Text>
          <TextInput
            style={[s.input, s.customDurationInput, usingCustomDuration && s.inputActive]}
            value={
              customMinutes
              || (usingCustomDuration ? String(Math.round(bleCaptureDurationSec / 60)) : '')
            }
            onChangeText={applyCustomMinutes}
            editable={!bleCaptureActive}
            placeholder="min"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            maxLength={4}
          />
          <Text style={s.customDurationSuffix}>min auto-stop</Text>
        </View>
        <Text style={s.sub}>
          Files roll over automatically at {MAX_PACKETS_PER_SESSION.toLocaleString()} packets
          (recording continues in a new part).
        </Text>

        {bleCaptureActive && (
          <View style={s.statsRow}>
            <Text style={s.stat}>
              {bleCaptureSegment > 1 ? `Part ${bleCaptureSegment} · ` : ''}
              {bleCaptureLiveCount} packets
            </Text>
            <Text style={s.stat}>{formatElapsed(elapsedMs)} elapsed</Text>
            {remainingMs !== null && (
              <Text style={s.stat}>{formatElapsed(remainingMs)} left</Text>
            )}
          </View>
        )}

        {bleCaptureActive ? (
          <TouchableOpacity style={s.stopBtn} onPress={handleStop}>
            <IconX size={18} color="#fff" />
            <Text style={s.stopBtnText}>Stop recording</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.startBtn} onPress={handleStart}>
            <IconBolt size={18} color="#fff" />
            <Text style={s.startBtnText}>Start recording</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Live preview */}
      {bleCaptureActive && bleCaptureBuffer.length > 0 && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Live (last {Math.min(15, bleCaptureBuffer.length)})</Text>
          {bleCaptureBuffer.slice(-15).reverse().map((p, i) => (
            <View key={`${p.boardTs}-${i}`} style={s.packetRow}>
              <Text style={s.packetTag}>{p.quality ? `UNK/${p.quality}` : p.tag}</Text>
              <Text style={s.packetHint} numberOfLines={1}>
                {p.func ? `${p.func} · ` : ''}{describeBlePacket(p.tag, p.hex)}
              </Text>
              <Text style={s.packetMeta}>{packetMetaParts(p)}</Text>
              <Text style={s.packetHex} numberOfLines={1}>{p.hex}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Saved sessions */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Saved sessions ({bleCaptureSessions.length})</Text>
        {bleCaptureSessions.length === 0 ? (
          <Text style={s.sub}>No recordings yet.</Text>
        ) : (
          bleCaptureSessions.map(session => {
            const open = expandedId === session.id;
            const trackOpen = tracksExpandedId === session.id;
            const trackCount = new Set(
              session.packets.map(packet => packet.deviceId).filter(Boolean),
            ).size;
            const tracks = open && trackOpen
              ? analyzeBeaconTracks(session).sort(
                (a, b) => TRACK_SORT[a.classification] - TRACK_SORT[b.classification],
              )
              : [];
            return (
              <View key={session.id} style={s.sessionBlock}>
                <TouchableOpacity
                  onPress={() => setExpandedId(open ? null : session.id)}
                  style={s.sessionHead}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.sessionName}>{session.name}</Text>
                    <Text style={s.sub}>
                      {session.packets.length} packets · {formatElapsed(session.durationSec * 1000)} ·{' '}
                      {new Date(session.startedAt).toLocaleString()}
                    </Text>
                  </View>
                  <Text style={s.expand}>{open ? '▼' : '▶'}</Text>
                </TouchableOpacity>
                <View style={s.sessionActions}>
                  <TouchableOpacity onPress={() => shareSession(session)} style={s.actionBtn}>
                    <IconDownload size={14} color={colors.primary} />
                    <Text style={s.actionText}>Export</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => Alert.alert(
                      'Delete session?',
                      session.name,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => deleteBleCaptureSession(session.id) },
                      ],
                    )}
                    style={s.actionBtn}
                  >
                    <IconTrash size={14} color={colors.danger} />
                  </TouchableOpacity>
                </View>
                {open && (
                  <>
                    <TouchableOpacity
                      style={s.trackHeader}
                      onPress={() => setTracksExpandedId(trackOpen ? null : session.id)}
                    >
                      <Text style={s.trackHeaderText}>Beacon tracks ({trackCount})</Text>
                      <Text style={s.expand}>{trackOpen ? '▼' : '▶'}</Text>
                    </TouchableOpacity>
                    {trackOpen && (
                      <>
                        <Text style={s.trackCaveat}>
                          Movement is inferred from phone GPS and RSSI. Phone-only capture cannot
                          measure a beacon's actual position, so ambiguous tracks stay insufficient.
                        </Text>
                        {tracks.map(track => (
                          <View key={track.deviceId} style={s.trackRow}>
                            <View style={s.trackTopRow}>
                              <Text style={s.trackDevice}>…{deviceIdSuffix(track.deviceId)}</Text>
                              <View style={[
                                s.trackBadge,
                                track.classification === 'moving_independent'
                                  ? { borderColor: colors.warning }
                                  : undefined,
                              ]}>
                                <Text style={s.trackBadgeText}>
                                  {TRACK_LABEL[track.classification]}
                                </Text>
                              </View>
                            </View>
                            <Text style={s.packetMeta}>
                              {track.tag} · {track.packetCount} packets · {track.freshGpsFixCount} fresh
                              GPS · receiver span {track.userDisplacementM == null
                                ? '—'
                                : `${Math.round(track.userDisplacementM)}m`} · RSSI {track.rssiTrend}
                            </Text>
                          </View>
                        ))}
                        {tracks.length === 0 && (
                          <Text style={s.sub}>No packets with device IDs in this session.</Text>
                        )}
                      </>
                    )}
                    {session.packets.map((p, i) => (
                      <View key={`${p.boardTs}-${i}`} style={s.packetRow}>
                        <Text style={s.packetTag}>{p.quality ? `UNK/${p.quality}` : p.tag}</Text>
                        <Text style={s.packetHint}>
                          {p.func ? `${p.func} · ` : ''}{describeBlePacket(p.tag, p.hex)}
                        </Text>
                        <Text style={s.packetMeta}>
                          {packetMetaParts(p)}
                          {' · '}+{(p.receivedAt - session.startedAt) / 1000}s
                        </Text>
                        <Text style={s.packetHex}>{p.hex}</Text>
                        {(p.quality || p.note !== undefined) && (
                          <TextInput
                            style={[s.input, { marginTop: 4 }]}
                            placeholder="Note…"
                            placeholderTextColor={colors.textMuted}
                            value={p.note ?? ''}
                            onChangeText={v => updateBleCapturePacketNote(p.boardTs, p.hex, v)}
                          />
                        )}
                      </View>
                    ))}
                  </>
                )}
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = (c: ReturnType<typeof import('../utils/theme').useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    content:   { padding: 16, gap: 12, paddingBottom: 32 },
    intro:     { color: c.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 4 },
    card:      { backgroundColor: c.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: c.border, gap: 10 },
    row:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
    cardTitle: { color: c.textPrimary, fontSize: 14, fontWeight: '700', flex: 1 },
    label:     { color: c.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
    input:     { backgroundColor: c.background, borderRadius: 8, borderWidth: 1, borderColor: c.borderFocus, color: c.textPrimary, padding: 10, fontSize: 14 },
    chipRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceAlt },
    chipActive:{ borderColor: c.primary, backgroundColor: c.primaryDim },
    chipText:  { color: c.textMuted, fontSize: 12, fontWeight: '500' },
    chipTextActive: { color: c.primary },
    customDurationRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    customDurationLabel: { color: c.textSecondary, fontSize: 12, fontWeight: '600' },
    customDurationInput: { flex: 0, width: 72, paddingVertical: 8, textAlign: 'center' },
    inputActive: { borderColor: c.primary },
    customDurationSuffix: { color: c.textMuted, fontSize: 12, flex: 1 },
    statsRow:  { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
    stat:      { color: c.textPrimary, fontSize: 13, fontWeight: '600' },
    healthRow: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
    healthText:{ fontSize: 11, fontWeight: '700' },
    startBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.primary, paddingVertical: 12, borderRadius: 10, marginTop: 4 },
    startBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    stopBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.danger, paddingVertical: 12, borderRadius: 10, marginTop: 4 },
    stopBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    recBadge:  { backgroundColor: c.danger, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
    recBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
    sub:       { color: c.textMuted, fontSize: 12 },
    sessionBlock: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10, marginTop: 6, gap: 6 },
    sessionHead:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sessionName:  { color: c.textPrimary, fontSize: 14, fontWeight: '600' },
    sessionActions: { flexDirection: 'row', gap: 12, marginBottom: 4 },
    actionBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
    actionText:   { color: c.primary, fontSize: 12, fontWeight: '600' },
    expand:       { color: c.textMuted, fontSize: 12 },
    trackHeader:  { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, marginTop: 2 },
    trackHeaderText: { color: c.textPrimary, fontSize: 13, fontWeight: '700', flex: 1 },
    trackCaveat:  { color: c.textMuted, fontSize: 10, lineHeight: 14 },
    trackRow:     { backgroundColor: c.surfaceAlt, borderRadius: 8, padding: 8, gap: 4 },
    trackTopRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
    trackDevice:  { color: c.textPrimary, fontSize: 12, fontWeight: '700', flex: 1 },
    trackBadge:   { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
    trackBadgeText: { color: c.textSecondary, fontSize: 9, fontWeight: '700' },
    packetRow:    { backgroundColor: c.background, borderRadius: 8, padding: 8, marginTop: 4, gap: 2 },
    packetTag:    { color: c.primary, fontSize: 11, fontWeight: '700' },
    packetHint:   { color: c.textPrimary, fontSize: 13, fontWeight: '500' },
    packetMeta:   { color: c.textMuted, fontSize: 10 },
    packetHex:    { color: c.textMuted, fontSize: 10, fontFamily: 'monospace' },
  });
