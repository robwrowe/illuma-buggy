/**
 * PresetsScreen.tsx
 * List, apply, view/edit, and delete presets.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, TextInput, Alert, ActivityIndicator,
} from 'react-native';
import IconPlus from '@tabler/icons-react-native/dist/esm/icons/IconPlus';
import IconRefresh from '@tabler/icons-react-native/dist/esm/icons/IconRefresh';
import IconCheck from '@tabler/icons-react-native/dist/esm/icons/IconCheck';
import IconTrash from '@tabler/icons-react-native/dist/esm/icons/IconTrash';
import IconSparkles from '@tabler/icons-react-native/dist/esm/icons/IconSparkles';
import IconCopy from '@tabler/icons-react-native/dist/esm/icons/IconCopy';

import { TagEditor, TagFilterBar, TagChipRow, filterTaggedItems } from '../components/TagFields';
import { duplicatePreset } from '../utils/tags';
import { useBLE } from '../hooks/useBLE';
import { useBoardSync } from '../hooks/useBoardSync';
import { useAppStore, Preset, summarizeLayout } from '../stores/store';
import { bleService } from '../services/BLEService';
import { generateId } from '../utils/utils';
import { applyPresetToBoard, presetWledForBoard } from '../utils/bleBoardSync';
import { formatSyncStatusLabel } from '../utils/boardSyncState';
import { useTheme } from '../utils/theme';

export default function PresetsScreen() {
  const { colors } = useTheme();
  const s = styles(colors);
  const { isConnected, isSessionReady, connectionState } = useBLE();
  const boardSync = useBoardSync();
  const { presets, deviceStatus, customSegmentLayouts, addOrUpdatePreset, removePreset, saveToStorage } = useAppStore();
  const [syncing, setSyncing]       = useState(false);
  const [search, setSearch]         = useState('');
  const [activeTag, setActiveTag]   = useState<string | null>(null);

  const filteredPresets = useMemo(
    () => filterTaggedItems(presets, search, activeTag),
    [presets, search, activeTag],
  );

  // Background board sync (App.tsx triggers on connect); manual refresh available
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
    const { recallState, customSegmentLayouts } = useAppStore.getState();
    const ok = await applyPresetToBoard(preset, recallState, customSegmentLayouts);
    if (!ok) {
      Alert.alert(
        'Apply failed',
        'Could not apply preset on the board. Wait for sync to finish after connect, then try again. If it keeps failing, check the board serial log for [Preset] or [WLED] errors.',
      );
    }
  };

  const deletePreset = (preset: Preset) => {
    Alert.alert('Delete Preset', `Delete "${preset.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        bleService.sendPresetDelete(preset.id);
        removePreset(preset.id);
        saveToStorage();
      }},
    ]);
  };

  const duplicateItem = (preset: Preset) => {
    const copy = duplicatePreset(preset, generateId());
    addOrUpdatePreset(copy);
    saveToStorage();
    if (bleService.isSessionReady()) {
      const { customSegmentLayouts } = useAppStore.getState();
      bleService.sendPresetSave(copy.id, copy.name, presetWledForBoard(copy, customSegmentLayouts));
    }
  };

  const renderPreset = ({ item }: { item: Preset }) => {
    const isActive = deviceStatus?.currentPreset === item.id;
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
            {isActive && (
              <View style={s.activePill}>
                <IconCheck size={10} color={colors.primary} />
                <Text style={s.activeLabel}>Active</Text>
              </View>
            )}
          </View>
        </View>
        <TouchableOpacity style={s.iconBtn} onPress={() => duplicateItem(item)}>
          <IconCopy size={16} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={s.applyBtn} onPress={() => applyPreset(item)} disabled={!isSessionReady}>
          <Text style={[s.applyBtnText, !isSessionReady && { opacity: 0.45 }]}>Apply</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.iconBtn} onPress={() => deletePreset(item)}>
          <IconTrash size={16} color={colors.danger} />
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
      <View style={s.header}>
        <TouchableOpacity style={s.headerBtn} onPress={refreshFromBoard} disabled={!isConnected || syncing}>
          {syncing
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <IconRefresh size={16} color={colors.primary} />}
          <Text style={s.headerBtnText}>{syncing ? 'Syncing…' : 'Sync'}</Text>
        </TouchableOpacity>
      </View>

      {presets.length === 0 ? (
        <View style={s.centered}>
          <IconSparkles size={40} color={colors.textMuted} />
          <Text style={s.emptyText}>No presets yet</Text>
          <Text style={s.hint}>Use the Library tab to browse effects and save them as presets.</Text>
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
  header:       { flexDirection: 'row', justifyContent: 'flex-end', padding: 16, gap: 8 },
  list:         { padding: 16, gap: 10 },
  centered:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  presetCard:   { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border, gap: 8 },
  presetName:   { color: c.textPrimary, fontSize: 15, fontWeight: '500' },
  presetMeta:   { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  metaTag:      { color: c.textMuted, fontSize: 11, backgroundColor: c.surfaceAlt, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  activePill:   { flexDirection: 'row', alignItems: 'center', gap: 3 },
  activeLabel:  { color: c.primary, fontSize: 11 },
  iconBtn:      { padding: 6 },
  applyBtn:     { backgroundColor: c.primary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  applyBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  headerBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.surfaceAlt, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  headerBtnText: { color: c.primary, fontWeight: '500' },
  hint:         { color: c.textMuted, fontSize: 12, textAlign: 'center' },
  emptyText:    { color: c.textPrimary, fontSize: 16, fontWeight: '500' },
  modalOverlay: { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
  modal:        { backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' },
});
