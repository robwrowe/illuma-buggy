/**
 * PresetsScreen.tsx
 * List and apply presets (A–Z). Authoring lives in the web tool.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, Alert, ActivityIndicator,
} from 'react-native';
import IconRefresh from '@tabler/icons-react-native/dist/esm/icons/IconRefresh';
import IconCheck from '@tabler/icons-react-native/dist/esm/icons/IconCheck';
import IconSparkles from '@tabler/icons-react-native/dist/esm/icons/IconSparkles';

import { TagFilterBar, TagChipRow, filterTaggedItems } from '../components/TagFields';
import { useBLE } from '../hooks/useBLE';
import { useBoardSync } from '../hooks/useBoardSync';
import { useAppStore, Preset, PresetWled } from '../stores/store';
import { bleService } from '../services/BLEService';
import { applyPresetRouted } from '../utils/bleBoardSync';
import { asSharedSegmentMaps } from '../utils/segmentLayouts';
import { formatSyncStatusLabel } from '../utils/boardSyncState';
import { useTheme } from '../utils/theme';
import { transitionStyleLabel } from '../utils/transitionStyles';

function transitionMeta(wled: PresetWled): string | null {
  const style = wled.transitionStyle;
  const ms = wled.transitionMs;
  if ((style == null || style === undefined) && (ms == null || ms === undefined)) return null;
  const parts: string[] = [];
  if (style != null) parts.push(transitionStyleLabel(style));
  if (Number.isFinite(ms)) parts.push(`${((ms as number) / 1000).toFixed(ms! % 1000 === 0 ? 0 : 1)}s`);
  return parts.length ? `Transition · ${parts.join(' · ')}` : null;
}

export default function PresetsScreen() {
  const { colors } = useTheme();
  const s = styles(colors);
  const { isConnected, isSessionReady, connectionState } = useBLE();
  const boardSync = useBoardSync();
  const { presets, deviceStatus, customSegmentLayouts } = useAppStore();
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const filteredPresets = useMemo(() => {
    const list = filterTaggedItems(presets, search, activeTag);
    return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [presets, search, activeTag]);

  const refreshFromBoard = () => {
    if (!isConnected) return;
    setSyncing(true);
    bleService.sendPresetList();
  };

  useEffect(() => {
    const unsub = bleService.onMessage((msg) => {
      if (msg.type === 'preset_list_raw') setSyncing(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!syncing) return;
    const timer = setTimeout(() => setSyncing(false), 10000);
    return () => clearTimeout(timer);
  }, [syncing]);

  const applyPreset = async (preset: Preset) => {
    if (!isConnected) {
      Alert.alert('Not connected', 'Connect to IllumaBuggy first.');
      return;
    }
    if (!bleService.isSessionReady()) {
      Alert.alert(
        'Board syncing',
        formatSyncStatusLabel(
          boardSync,
          isConnected ? 'connected' : connectionState,
          bleService.hasScanTimedOut(),
        ) +
          '\n\nWait until Home shows Ready, or tap Sync board config.',
      );
      return;
    }
    const { recallState, customSegmentLayouts: layouts, mbMapping, presetApplyMode } = useAppStore.getState();
    const ok = await applyPresetRouted(
      preset,
      recallState,
      asSharedSegmentMaps(mbMapping?.segmentMaps),
      layouts,
      presetApplyMode,
    );
    if (!ok) {
      Alert.alert(
        'Apply failed',
        'Could not apply preset on the board. Wait for sync to finish after connect, then try again. If it keeps failing, check the board serial log for [Preset] or [WLED] errors.',
      );
    }
  };

  const renderPreset = ({ item }: { item: Preset }) => {
    const isActive = deviceStatus?.currentPreset === item.id;
    const trMeta = transitionMeta(item.wled);
    return (
      <View style={[s.presetCard, isActive && { borderColor: colors.primary }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.presetName}>{item.name}</Text>
          <TagChipRow tags={item.tags} colors={colors} />
          <View style={s.presetMeta}>
            {item.wled.fxName && <Text style={s.metaTag}>{item.wled.fxName}</Text>}
            {item.wled.palName && <Text style={s.metaTag}>{item.wled.palName}</Text>}
            {item.segmentLayoutId && (
              <Text style={s.metaTag}>
                {customSegmentLayouts.find(l => l.id === item.segmentLayoutId)?.name ?? 'Layout'}
              </Text>
            )}
            {trMeta && <Text style={s.metaTag}>{trMeta}</Text>}
            {isActive && (
              <View style={s.activePill}>
                <IconCheck size={10} color={colors.primary} />
                <Text style={s.activeLabel}>Active</Text>
              </View>
            )}
          </View>
        </View>
        <TouchableOpacity style={s.applyBtn} onPress={() => applyPreset(item)} disabled={!isSessionReady}>
          <Text style={[s.applyBtnText, !isSessionReady && { opacity: 0.45 }]}>Apply</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={s.container}>
      {isConnected && !isSessionReady && (
        <View style={s.syncBar}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={s.syncBarText}>
            {formatSyncStatusLabel(boardSync, 'connected', bleService.hasScanTimedOut())}
          </Text>
        </View>
      )}

      {presets.length === 0 ? (
        <View style={s.centered}>
          <IconSparkles size={40} color={colors.textMuted} />
          <Text style={s.emptyText}>No presets yet</Text>
          <Text style={s.hint}>Presets are authored in the web tool and synced to the board.</Text>
          <TouchableOpacity style={s.headerBtn} onPress={refreshFromBoard} disabled={!isConnected || syncing}>
            {syncing
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <IconRefresh size={16} color={colors.primary} />}
            <Text style={s.headerBtnText}>{syncing ? 'Syncing…' : 'Sync from board'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <TagFilterBar
            items={presets}
            search={search}
            onSearchChange={setSearch}
            activeTag={activeTag}
            onActiveTagChange={setActiveTag}
            colors={colors}
            trailing={
              <TouchableOpacity
                style={s.syncIconBtn}
                onPress={refreshFromBoard}
                disabled={!isConnected || syncing}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {syncing
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <IconRefresh size={20} color={isConnected ? colors.primary : colors.textMuted} />}
              </TouchableOpacity>
            }
          />
          {filteredPresets.length === 0 ? (
            <View style={s.centered}>
              <Text style={s.emptyText}>No matches</Text>
              <Text style={s.hint}>Try a different search or tag filter.</Text>
            </View>
          ) : (
            <FlatList
              data={filteredPresets}
              keyExtractor={item => item.id}
              renderItem={renderPreset}
              contentContainerStyle={s.list}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = (c: ReturnType<typeof import('../utils/theme').useTheme>['colors']) => StyleSheet.create({
  container:    { flex: 1, backgroundColor: c.background },
  syncBar:      { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: c.primary + '14', borderBottomWidth: 1, borderBottomColor: c.border },
  syncBarText:  { color: c.textPrimary, fontSize: 13, flex: 1 },
  list:         { padding: 16, gap: 10 },
  centered:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  presetCard:   { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border, gap: 8 },
  presetName:   { color: c.textPrimary, fontSize: 15, fontWeight: '500' },
  presetMeta:   { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  metaTag:      { color: c.textMuted, fontSize: 11, backgroundColor: c.surfaceAlt, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  activePill:   { flexDirection: 'row', alignItems: 'center', gap: 3 },
  activeLabel:  { color: c.primary, fontSize: 11 },
  applyBtn:     { backgroundColor: c.primary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  applyBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  headerBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.surfaceAlt, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  headerBtnText: { color: c.primary, fontWeight: '500' },
  syncIconBtn:  { padding: 8, borderRadius: 8, backgroundColor: c.surfaceAlt },
  hint:         { color: c.textMuted, fontSize: 12, textAlign: 'center' },
  emptyText:    { color: c.textPrimary, fontSize: 16, fontWeight: '500' },
});
