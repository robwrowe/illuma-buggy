/**
 * PresetsScreen.tsx
 * List, apply, view/edit, and delete presets.
 */

import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, TextInput, Alert, ActivityIndicator,
  Modal, ScrollView, Switch,
} from 'react-native';
import Slider from '@react-native-community/slider';
import IconPlus from '@tabler/icons-react-native/dist/esm/icons/IconPlus';
import IconRefresh from '@tabler/icons-react-native/dist/esm/icons/IconRefresh';
import IconCheck from '@tabler/icons-react-native/dist/esm/icons/IconCheck';
import IconTrash from '@tabler/icons-react-native/dist/esm/icons/IconTrash';
import IconPencil from '@tabler/icons-react-native/dist/esm/icons/IconPencil';
import IconX from '@tabler/icons-react-native/dist/esm/icons/IconX';
import IconSparkles from '@tabler/icons-react-native/dist/esm/icons/IconSparkles';

import { useBLE } from '../hooks/useBLE';
import { useAppStore, Preset } from '../stores/store';
import { bleService } from '../services/BLEService';
import { generateId } from '../utils/utils';
import { useTheme } from '../utils/theme';

export default function PresetsScreen() {
  const { colors } = useTheme();
  const s = styles(colors);
  const { isConnected } = useBLE();
  const { presets, wledEffects, wledPalettes, deviceStatus, addOrUpdatePreset, removePreset, saveToStorage } = useAppStore();
  const [loading, setLoading]       = useState(false);
  const [editingPreset, setEditingPreset] = useState<Preset | null>(null);
  const [showEdit, setShowEdit]     = useState(false);

  // Listen for preset_list_raw (assembled in App.tsx → store) and preset_list (legacy)
  useEffect(() => {
    if (!isConnected) { setLoading(false); return; }
    setLoading(true);
    // Loading done when store is updated — watch presets length change
    const timer = setTimeout(() => setLoading(false), 8000); // timeout fallback
    const unsub = bleService.onMessage((msg) => {
      if (msg.type === 'preset_list_raw' || msg.type === 'preset_list') {
        setLoading(false);
        clearTimeout(timer);
      }
    });
    bleService.sendPresetList();
    return () => { unsub(); clearTimeout(timer); };
  }, [isConnected]);

  const applyPreset = (preset: Preset) => {
    // Build recall payload and send as wled_raw
    const { recallState } = useAppStore.getState();
    const { buildRecallPayload } = require('../stores/store');
    const payload = buildRecallPayload(preset, recallState);
    bleService.sendWledRaw(payload);
    bleService.sendPresetApply(preset.id);
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

  const openEdit = (preset: Preset) => {
    setEditingPreset({ ...preset, wled: { ...preset.wled } });
    setShowEdit(true);
  };

  const saveEdit = () => {
    if (!editingPreset) return;
    bleService.sendPresetSave(editingPreset.id, editingPreset.name, editingPreset.wled);
    addOrUpdatePreset(editingPreset);
    saveToStorage();
    setShowEdit(false);
    setEditingPreset(null);
  };

  const renderPreset = ({ item }: { item: Preset }) => {
    const isActive = deviceStatus?.currentPreset === item.id;
    return (
      <View style={[s.presetCard, isActive && { borderColor: colors.primary }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.presetName}>{item.name}</Text>
          <View style={s.presetMeta}>
            {item.wled.fxName && <Text style={s.metaTag}>{item.wled.fxName}</Text>}
            {item.wled.palName && <Text style={s.metaTag}>{item.wled.palName}</Text>}
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
        <TouchableOpacity style={s.applyBtn} onPress={() => applyPreset(item)} disabled={!isConnected}>
          <Text style={s.applyBtnText}>Apply</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.iconBtn} onPress={() => deletePreset(item)}>
          <IconTrash size={16} color={colors.danger} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity style={s.headerBtn} onPress={() => { setLoading(true); bleService.sendPresetList(); }} disabled={!isConnected}>
          <IconRefresh size={16} color={colors.primary} />
          <Text style={s.headerBtnText}>Sync</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator color={colors.primary} />
          <Text style={s.hint}>Loading presets…</Text>
        </View>
      ) : presets.length === 0 ? (
        <View style={s.centered}>
          <IconSparkles size={40} color={colors.textMuted} />
          <Text style={s.emptyText}>No presets yet</Text>
          <Text style={s.hint}>Use the Library tab to browse effects and save them as presets.</Text>
        </View>
      ) : (
        <FlatList
          data={presets}
          keyExtractor={item => item.id}
          renderItem={renderPreset}
          contentContainerStyle={s.list}
        />
      )}

      {/* Edit preset modal */}
      <Modal visible={showEdit} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modal}>
            {editingPreset && (
              <EditPresetPanel
                preset={editingPreset}
                effects={wledEffects}
                palettes={wledPalettes}
                colors={colors}
                onChange={setEditingPreset}
                onSave={saveEdit}
                onCancel={() => { setShowEdit(false); setEditingPreset(null); }}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────
// Edit Panel
// ─────────────────────────────────────────────

function EditPresetPanel({ preset, effects, palettes, colors, onChange, onSave, onCancel }: {
  preset: Preset;
  effects: ReturnType<typeof useAppStore>['wledEffects'] extends (infer T)[] ? T[] : never[];
  palettes: ReturnType<typeof useAppStore>['wledPalettes'] extends (infer T)[] ? T[] : never[];
  colors: ReturnType<typeof import('../utils/theme').useTheme>['colors'];
  onChange: (p: Preset) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useState<'effect' | 'palette' | 'memory'>('effect');
  const s = editStyles(colors);

  const update = (key: string, val: unknown) =>
    onChange({ ...preset, wled: { ...preset.wled, [key]: val } });
  const updateMemory = (key: string, val: boolean) =>
    onChange({ ...preset, memory: { ...preset.memory, [key]: val } });

  return (
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.titleRow}>
        <TextInput
          style={s.nameInput}
          value={preset.name}
          onChangeText={name => onChange({ ...preset, name })}
          placeholder="Preset name"
          placeholderTextColor={colors.textMuted}
        />
        <TouchableOpacity onPress={onCancel}><IconX size={20} color={colors.textMuted} /></TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View style={s.tabs}>
        {(['effect', 'palette', 'memory'] as const).map(t => (
          <TouchableOpacity key={t} style={[s.tab, tab === t && { borderBottomColor: colors.primary }]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && { color: colors.primary }]}>{t.charAt(0).toUpperCase() + t.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Effect tab */}
      {tab === 'effect' && (
        <View style={s.section}>
          <Text style={s.label}>Effect</Text>
          <ScrollView style={s.picker} nestedScrollEnabled>
            {effects.map(e => (
              <TouchableOpacity
                key={e.id}
                style={[s.pickerItem, preset.wled.fx === e.id && { backgroundColor: colors.primaryDim }]}
                onPress={() => { update('fx', e.id); onChange({ ...preset, wled: { ...preset.wled, fx: e.id, fxName: e.name } }); }}
              >
                <Text style={[s.pickerText, preset.wled.fx === e.id && { color: colors.primary }]}>{e.name}</Text>
                {preset.wled.fx === e.id && <IconCheck size={12} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={[s.label, { marginTop: 12 }]}>Speed</Text>
          <Slider minimumValue={0} maximumValue={255} step={1} value={preset.wled.sx ?? 128}
            minimumTrackTintColor={colors.primary} maximumTrackTintColor={colors.borderFocus} thumbTintColor={colors.primary}
            onValueChange={v => update('sx', Math.round(v))} />
          <Text style={[s.label, { marginTop: 8 }]}>Intensity</Text>
          <Slider minimumValue={0} maximumValue={255} step={1} value={preset.wled.ix ?? 128}
            minimumTrackTintColor={colors.primary} maximumTrackTintColor={colors.borderFocus} thumbTintColor={colors.primary}
            onValueChange={v => update('ix', Math.round(v))} />
        </View>
      )}

      {/* Palette tab */}
      {tab === 'palette' && (
        <View style={s.section}>
          <Text style={s.label}>Color Palette</Text>
          <ScrollView style={s.picker} nestedScrollEnabled>
            {palettes.map(p => (
              <TouchableOpacity
                key={p.id}
                style={[s.pickerItem, preset.wled.pal === p.id && { backgroundColor: colors.primaryDim }]}
                onPress={() => onChange({ ...preset, wled: { ...preset.wled, pal: p.id, palName: p.name } })}
              >
                <Text style={[s.pickerText, preset.wled.pal === p.id && { color: colors.primary }]}>{p.name}</Text>
                {preset.wled.pal === p.id && <IconCheck size={12} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Memory tab */}
      {tab === 'memory' && (
        <View style={s.section}>
          <Text style={s.hint}>Which properties to recall when "Memory" mode is active globally.</Text>
          {(Object.keys(preset.memory) as (keyof typeof preset.memory)[]).map(key => (
            <View key={key} style={s.memRow}>
              <Text style={s.pickerText}>{key.charAt(0).toUpperCase() + key.slice(1)}</Text>
              <Switch value={preset.memory[key]} onValueChange={v => updateMemory(key, v)}
                trackColor={{ false: colors.borderFocus, true: colors.primary }} />
            </View>
          ))}
        </View>
      )}

      <View style={s.btns}>
        <TouchableOpacity style={s.cancelBtn} onPress={onCancel}>
          <Text style={s.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.saveBtn} onPress={onSave}>
          <Text style={s.saveBtnText}>Save</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = (c: ReturnType<typeof import('../utils/theme').useTheme>['colors']) => StyleSheet.create({
  container:    { flex: 1, backgroundColor: c.background },
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

const editStyles = (c: ReturnType<typeof import('../utils/theme').useTheme>['colors']) => StyleSheet.create({
  content:    { padding: 20, gap: 12 },
  titleRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nameInput:  { flex: 1, backgroundColor: c.background, borderRadius: 8, borderWidth: 1, borderColor: c.borderFocus, color: c.textPrimary, padding: 10, fontSize: 16, fontWeight: '500' },
  tabs:       { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border },
  tab:        { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText:    { color: c.textMuted, fontWeight: '600', fontSize: 13 },
  section:    { gap: 8 },
  label:      { color: c.textSecondary, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  picker:     { maxHeight: 220, backgroundColor: c.background, borderRadius: 8, borderWidth: 1, borderColor: c.border },
  pickerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  pickerText: { color: c.textPrimary, fontSize: 13 },
  memRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  hint:       { color: c.textMuted, fontSize: 12 },
  btns:       { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn:  { flex: 1, padding: 12, borderRadius: 8, backgroundColor: c.surfaceAlt, alignItems: 'center' },
  cancelBtnText: { color: c.textMuted, fontWeight: '600' },
  saveBtn:    { flex: 1, padding: 12, borderRadius: 8, backgroundColor: c.primary, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '600' },
});
