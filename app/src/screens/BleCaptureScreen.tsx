import React, { useEffect, useState } from 'react';
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

import { useBLE } from '../hooks/useBLE';
import { useAppStore } from '../stores/store';
import { bleService } from '../services/BLEService';
import { useTheme } from '../utils/theme';
import {
  CAPTURE_DURATION_OPTIONS, describeBlePacket, formatCaptureExport,
  BleCaptureSession,
} from '../utils/bleCapture';

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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

export default function BleCaptureScreen() {
  const { colors } = useTheme();
  const s = styles(colors);
  const { isConnected } = useBLE();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const {
    bleCaptureActive, bleCaptureDurationSec, bleCaptureStartedAt, bleCaptureEndsAt,
    bleCaptureLiveCount, bleCaptureBuffer, bleCaptureSessions, bleCaptureDraftName,
    setBleCaptureDurationSec, setBleCaptureDraftName,
    startBleCapture, stopBleCapture,
    deleteBleCaptureSession,
  } = useAppStore();

  useEffect(() => {
    if (!bleCaptureActive || !bleCaptureStartedAt) return;
    const tick = () => setElapsedMs(Date.now() - bleCaptureStartedAt);
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
      bleService.sendBleCaptureConfig(false);
    }, remaining);
    return () => clearTimeout(timer);
  }, [bleCaptureActive, bleCaptureEndsAt]);

  const handleStart = async () => {
    if (!isConnected) {
      Alert.alert('Not connected', 'Connect to IllumaBuggy first.');
      return;
    }
    startBleCapture();
    const ok = await bleService.sendBleCaptureConfig(
      true,
      bleCaptureDurationSec > 0 ? bleCaptureDurationSec * 1000 : 0,
    );
    if (!ok) {
      stopBleCapture('error');
      Alert.alert('Capture failed', 'Could not start recording on the board.');
    }
  };

  const handleStop = async () => {
    await bleService.sendBleCaptureConfig(false);
    stopBleCapture('manual');
  };

  const remainingMs = bleCaptureEndsAt ? Math.max(0, bleCaptureEndsAt - Date.now()) : null;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.intro}>
        Record unique Disney BLE packets during a parade or fireworks show. Only new packet
        signatures are saved (repeated pings are deduplicated on the board).
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

        <Text style={s.label}>Session name</Text>
        <TextInput
          style={s.input}
          value={bleCaptureDraftName}
          onChangeText={setBleCaptureDraftName}
          editable={!bleCaptureActive}
          placeholder="Parade capture"
          placeholderTextColor={colors.textMuted}
        />

        <Text style={s.label}>Duration</Text>
        <View style={s.chipRow}>
          {CAPTURE_DURATION_OPTIONS.map(({ label, sec }) => (
            <TouchableOpacity
              key={sec}
              style={[s.chip, bleCaptureDurationSec === sec && s.chipActive]}
              onPress={() => !bleCaptureActive && setBleCaptureDurationSec(sec)}
              disabled={bleCaptureActive}
            >
              <Text style={[s.chipText, bleCaptureDurationSec === sec && s.chipTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {bleCaptureActive && (
          <View style={s.statsRow}>
            <Text style={s.stat}>{bleCaptureLiveCount} packets</Text>
            <Text style={s.stat}>{formatElapsed(elapsedMs)} elapsed</Text>
            {remainingMs !== null && (
              <Text style={s.stat}>{formatElapsed(remainingMs)} left</Text>
            )}
          </View>
        )}

        {!isConnected && (
          <Text style={s.warn}>Connect to IllumaBuggy to record.</Text>
        )}

        {bleCaptureActive ? (
          <TouchableOpacity style={s.stopBtn} onPress={handleStop}>
            <IconX size={18} color="#fff" />
            <Text style={s.stopBtnText}>Stop recording</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[s.startBtn, !isConnected && s.btnDisabled]}
            onPress={handleStart}
            disabled={!isConnected}
          >
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
              <Text style={s.packetTag}>{p.tag}</Text>
              <Text style={s.packetHint} numberOfLines={1}>
                {describeBlePacket(p.tag, p.hex)}
              </Text>
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
                {open && session.packets.map((p, i) => (
                  <View key={`${p.boardTs}-${i}`} style={s.packetRow}>
                    <Text style={s.packetTag}>{p.tag}</Text>
                    <Text style={s.packetHint}>{describeBlePacket(p.tag, p.hex)}</Text>
                    <Text style={s.packetMeta}>rssi {p.rssi} · +{(p.receivedAt - session.startedAt) / 1000}s</Text>
                    <Text style={s.packetHex}>{p.hex}</Text>
                  </View>
                ))}
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
    statsRow:  { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
    stat:      { color: c.textPrimary, fontSize: 13, fontWeight: '600' },
    warn:      { color: c.warning, fontSize: 12 },
    startBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.primary, paddingVertical: 12, borderRadius: 10, marginTop: 4 },
    startBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    stopBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.danger, paddingVertical: 12, borderRadius: 10, marginTop: 4 },
    stopBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    btnDisabled: { opacity: 0.45 },
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
    packetRow:    { backgroundColor: c.background, borderRadius: 8, padding: 8, marginTop: 4, gap: 2 },
    packetTag:    { color: c.primary, fontSize: 11, fontWeight: '700' },
    packetHint:   { color: c.textPrimary, fontSize: 13, fontWeight: '500' },
    packetMeta:   { color: c.textMuted, fontSize: 10 },
    packetHex:    { color: c.textMuted, fontSize: 10, fontFamily: 'monospace' },
  });
