/**
 * PresetsScreen.tsx
 * List, apply, edit transition, and delete presets.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, TextInput, Alert, ActivityIndicator, Modal, ScrollView,
} from 'react-native';
import IconRefresh from '@tabler/icons-react-native/dist/esm/icons/IconRefresh';
import IconCheck from '@tabler/icons-react-native/dist/esm/icons/IconCheck';
import IconTrash from '@tabler/icons-react-native/dist/esm/icons/IconTrash';
import IconSparkles from '@tabler/icons-react-native/dist/esm/icons/IconSparkles';
import IconCopy from '@tabler/icons-react-native/dist/esm/icons/IconCopy';
import IconPencil from '@tabler/icons-react-native/dist/esm/icons/IconPencil';
import IconX from '@tabler/icons-react-native/dist/esm/icons/IconX';

import { TagFilterBar, TagChipRow, filterTaggedItems } from '../components/TagFields';
import { duplicatePreset } from '../utils/tags';
import { useBLE } from '../hooks/useBLE';
import { useBoardSync } from '../hooks/useBoardSync';
import { useAppStore, Preset, PresetWled } from '../stores/store';
import { bleService } from '../services/BLEService';
import { generateId } from '../utils/utils';
import { applyPresetToBoard, presetWledForBoard } from '../utils/bleBoardSync';
import { formatSyncStatusLabel } from '../utils/boardSyncState';
import { useTheme } from '../utils/theme';
import {
  TRANSITION_STYLES,
  transitionStyleLabel,
  type TransitionStyle,
} from '../utils/transitionStyles';

const MAX_TRANSITION_SEC = 60;

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
  const { presets, deviceStatus, customSegmentLayouts, addOrUpdatePreset, removePreset, saveToStorage } = useAppStore();
  const [syncing, setSyncing]       = useState(false);
  const [search, setSearch]         = useState('');
  const [activeTag, setActiveTag]   = useState<string | null>(null);
  const [editing, setEditing]       = useState<Preset | null>(null);
  const [editStyle, setEditStyle]   = useState<TransitionStyle | null>(null);
  const [editSec, setEditSec]       = useState('');
  const [pickingStyle, setPickingStyle] = useState(false);

  const filteredPresets = useMemo(
    () => filterTaggedItems(presets, search, activeTag),
    [presets, search, activeTag],
  );

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

  const openEdit = (preset: Preset) => {
    setEditing(preset);
    setEditStyle(
      preset.wled.transitionStyle && typeof preset.wled.transitionStyle === 'string'
        ? preset.wled.transitionStyle
        : null,
    );
    const ms = preset.wled.transitionMs;
    setEditSec(Number.isFinite(ms) ? String((ms as number) / 1000) : '');
    setPickingStyle(false);
  };

  const saveEdit = () => {
    if (!editing) return;
    const secTrim = editSec.trim();
    let transitionMs: number | null | undefined;
    if (secTrim === '') {
      transitionMs = undefined;
    } else {
      const sec = Number(secTrim);
      if (!Number.isFinite(sec) || sec < 0) {
        Alert.alert('Invalid duration', `Enter a number from 0–${MAX_TRANSITION_SEC} seconds.`);
        return;
      }
      transitionMs = Math.round(Math.min(MAX_TRANSITION_SEC, sec) * 1000);
    }

    const { transitionMs: _prevMs, transitionStyle: _prevStyle, ...wledBase } = editing.wled;
    const nextWled: PresetWled = {
      ...wledBase,
      transitionStyle: editStyle,
      ...(transitionMs !== undefined ? { transitionMs } : {}),
    };
    const next: Preset = { ...editing, wled: nextWled };

    addOrUpdatePreset(next);
    saveToStorage();
    if (bleService.isSessionReady()) {
      const { customSegmentLayouts: layouts } = useAppStore.getState();
      bleService.sendPresetSave(next.id, next.name, presetWledForBoard(next, layouts));
    }
    setEditing(null);
  };

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
        <TouchableOpacity style={s.iconBtn} onPress={() => openEdit(item)}>
          <IconPencil size={16} color={colors.textSecondary} />
        </TouchableOpacity>
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

      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <View style={s.modalOverlay}>
          <View style={s.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{editing?.name ?? 'Preset'}</Text>
              <TouchableOpacity onPress={() => setEditing(null)} hitSlop={12}>
                <IconX size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={s.modalBody} keyboardShouldPersistTaps="handled">
              <Text style={s.fieldLabel}>Start transition style</Text>
              <Text style={s.fieldHint}>
                Same styles as rule stop-transitions. &quot;Use default&quot; leaves WLED&apos;s current transition alone.
              </Text>
              <TouchableOpacity style={s.selectRow} onPress={() => setPickingStyle(!pickingStyle)}>
                <Text style={s.selectValue}>{transitionStyleLabel(editStyle)}</Text>
                <Text style={s.selectChevron}>{pickingStyle ? '▴' : '▾'}</Text>
              </TouchableOpacity>
              {pickingStyle && (
                <View style={s.styleList}>
                  <TouchableOpacity
                    style={[s.styleOption, editStyle == null && s.styleOptionActive]}
                    onPress={() => { setEditStyle(null); setPickingStyle(false); }}
                  >
                    <Text style={s.styleOptionText}>Use default</Text>
                  </TouchableOpacity>
                  {TRANSITION_STYLES.map((t) => (
                    <TouchableOpacity
                      key={t.value}
                      style={[s.styleOption, editStyle === t.value && s.styleOptionActive]}
                      onPress={() => { setEditStyle(t.value); setPickingStyle(false); }}
                    >
                      <Text style={s.styleOptionText}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={[s.fieldLabel, { marginTop: 16 }]}>Transition duration (seconds)</Text>
              <Text style={s.fieldHint}>
                Independent of style — leave blank for WLED&apos;s current duration. Max {MAX_TRANSITION_SEC}s.
              </Text>
              <TextInput
                style={s.input}
                value={editSec}
                onChangeText={setEditSec}
                placeholder="(default)"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                selectTextOnFocus
              />

              <TouchableOpacity style={s.saveBtn} onPress={saveEdit}>
                <Text style={s.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  modalHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  modalTitle:   { color: c.textPrimary, fontSize: 17, fontWeight: '600', flex: 1, paddingRight: 12 },
  modalBody:    { padding: 16, paddingBottom: 36, gap: 6 },
  fieldLabel:   { color: c.textPrimary, fontSize: 14, fontWeight: '600' },
  fieldHint:    { color: c.textMuted, fontSize: 12, marginBottom: 6, lineHeight: 16 },
  selectRow:    { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surfaceAlt, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, borderWidth: 1, borderColor: c.border },
  selectValue:  { color: c.textPrimary, fontSize: 14, flex: 1 },
  selectChevron:{ color: c.textMuted, fontSize: 14 },
  styleList:    { maxHeight: 220, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.background, marginBottom: 4 },
  styleOption:  { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  styleOptionActive: { backgroundColor: c.primary + '22' },
  styleOptionText: { color: c.textPrimary, fontSize: 14 },
  input:        { backgroundColor: c.surfaceAlt, borderRadius: 10, borderWidth: 1, borderColor: c.border, color: c.textPrimary, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  saveBtn:      { marginTop: 20, backgroundColor: c.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  saveBtnText:  { color: '#fff', fontWeight: '700', fontSize: 15 },
});
