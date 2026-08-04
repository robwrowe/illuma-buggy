import React, { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import IconTrash from '@tabler/icons-react-native/dist/esm/icons/IconTrash';
import IconPlayerPause from '@tabler/icons-react-native/dist/esm/icons/IconPlayerPause';
import IconPlayerPlay from '@tabler/icons-react-native/dist/esm/icons/IconPlayerPlay';
import { commandLog, onCommandLogEntry, type CommandLogEntry } from '../../services/BLEService';
import { useTheme } from '../../utils/theme';

const LEVEL_COLOR: Record<CommandLogEntry['level'], string> = {
  send: 'textMuted',
  ack_ok: 'success',
  ack_fail: 'danger',
  notify: 'primary',
  warn: 'warning',
  error: 'danger',
};

function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export default function LiveLogScreen() {
  const { colors } = useTheme();
  const [entries, setEntries] = useState<CommandLogEntry[]>(() => [...commandLog].reverse());
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    return onCommandLogEntry((entry) => {
      if (pausedRef.current) return;
      setEntries((prev) => [entry, ...prev].slice(0, 500));
    });
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.toolbar}>
        <TouchableOpacity
          style={styles.btn}
          onPress={() => {
            setPaused((p) => {
              if (p) setEntries([...commandLog].reverse());
              return !p;
            });
          }}
        >
          {paused ? <IconPlayerPlay size={16} color={colors.primary} /> : <IconPlayerPause size={16} color={colors.primary} />}
          <Text style={[styles.btnText, { color: colors.primary }]}>{paused ? 'Resume' : 'Pause'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => setEntries([])}>
          <IconTrash size={16} color={colors.danger} />
          <Text style={[styles.btnText, { color: colors.danger }]}>Clear</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={entries}
        keyExtractor={(item, i) => `${item.ts}-${i}`}
        initialNumToRender={40}
        maxToRenderPerBatch={40}
        windowSize={7}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={[styles.ts, { color: colors.textMuted }]}>{formatTs(item.ts)}</Text>
            <Text
              style={[
                styles.summary,
                { color: (colors as Record<string, string>)[LEVEL_COLOR[item.level]] ?? colors.textPrimary },
              ]}
              numberOfLines={2}
            >
              {item.summary}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={{ color: colors.textMuted, padding: 20, textAlign: 'center' }}>
            No BLE activity yet.
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', gap: 12, padding: 10 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6 },
  btnText: { fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 4 },
  ts: { fontSize: 11, fontFamily: 'monospace', width: 90 },
  summary: { fontSize: 12, fontFamily: 'monospace', flex: 1 },
});
