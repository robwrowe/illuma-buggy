/**
 * LibraryScreen.tsx
 * Browse WLED effects and palettes, preview live, save as presets.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  TextInput, Switch, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import Slider from '@react-native-community/slider';
import IconRefresh from '@tabler/icons-react-native/dist/esm/icons/IconRefresh';
import IconSparkles from '@tabler/icons-react-native/dist/esm/icons/IconSparkles';
import IconPlus from '@tabler/icons-react-native/dist/esm/icons/IconPlus';
import IconCheck from '@tabler/icons-react-native/dist/esm/icons/IconCheck';
import IconX from '@tabler/icons-react-native/dist/esm/icons/IconX';

import { useTheme } from '../utils/theme';
import { useBLE } from '../hooks/useBLE';
import { useAppStore, WledEffect, WledPalette, Preset, PresetMemory, buildRecallPayload, fetchWledSegmentsFromDevice } from '../stores/store';
import { bleService } from '../services/BLEService';
import { generateId } from '../utils/utils';

type Tab = 'effects' | 'palettes';

// Parse fxdata metadata string into slider/checkbox labels
// Format: "<params>;<colors>;<palette>;<flags>;<defaults>"
function parseFxMetadata(meta: string) {
  if (!meta) return { sliders: ['Speed', 'Intensity'], checkboxes: [] as string[] };
  const parts = meta.split(';');
  const paramStr = parts[0] ?? '';
  const params = paramStr.split(',');
  const DEFAULT_LABELS = ['Speed', 'Intensity', 'Custom 1', 'Custom 2', 'Custom 3', 'Opt 1', 'Opt 2', 'Opt 3'];
  const sliders: string[] = [];
  const checkboxes: string[] = [];

  params.forEach((p, i) => {
    if (i >= 8) return;
    const label = p === '!' ? DEFAULT_LABELS[i] : p;
    if (!label) return;
    if (i < 5) sliders.push(label);
    else checkboxes.push(label);
  });

  return { sliders: sliders.length ? sliders : ['Speed', 'Intensity'], checkboxes };
}

// Parse defaults from metadata e.g. "sx=24,pal=50"
function parseFxDefaults(meta: string): Record<string, number> {
  const parts = meta.split(';');
  const defaultStr = parts[4] ?? '';
  const result: Record<string, number> = {};
  defaultStr.split(',').forEach(kv => {
    const [k, v] = kv.split('=');
    if (k && v) result[k.trim()] = parseInt(v.trim(), 10);
  });
  return result;
}

export default function LibraryScreen() {
  const { colors } = useTheme();
  const s = styles(colors);
  const { wledEffects, wledPalettes, wledFxData, addOrUpdatePreset, saveToStorage } = useAppStore();

  const [tab, setTab]               = useState<Tab>('effects');
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState('');
  const [selectedEffect, setSelectedEffect] = useState<WledEffect | null>(null);
  const [selectedPalette, setSelectedPalette] = useState<WledPalette | null>(null);

  // Effect parameters
  const [speed, setSpeed]       = useState(128);
  const [intensity, setIntensity] = useState(128);
  const [c1, setC1] = useState(128);
  const [c2, setC2] = useState(128);
  const [c3, setC3] = useState(16);
  const [o1, setO1] = useState(false);
  const [o2, setO2] = useState(false);
  const [o3, setO3] = useState(false);

  // Preset save form
  const [saving, setSaving]         = useState(false);
  const [presetName, setPresetName] = useState('');
  const [memory, setMemory]         = useState<PresetMemory>({
    effect: true, palette: true, parameters: true, color: false, segments: false
  });

  const { isConnected } = useBLE();

  const fetchAll = useCallback(() => {
    if (!isConnected) return;
    setLoading(true);
    bleService.sendGetFxData();
    setTimeout(() => bleService.sendGetEffects(), 500);
    setTimeout(() => bleService.sendGetPalettes(), 1000);
  }, [isConnected]);

  // Auto-load catalog when connected and cache is empty
  useEffect(() => {
    if (isConnected && wledEffects.length === 0) fetchAll();
  }, [isConnected, wledEffects.length, fetchAll]);

  // Clear loading spinner when background fetch completes (handled in App.tsx → store)
  useEffect(() => {
    const unsub = bleService.onMessage((msg) => {
      if (msg.type === 'wled_effects_done' || msg.type === 'wled_palettes_done') {
        setLoading(false);
      }
      if (msg.type === 'error') {
        console.error('[Library] Firmware error:', msg.msg);
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  // Preview effect live on WLED
  const previewEffect = (effect: WledEffect) => {
    setSelectedEffect(effect);
    const defaults = parseFxDefaults(effect.metadata);
    if (defaults.sx !== undefined) setSpeed(defaults.sx);
    if (defaults.ix !== undefined) setIntensity(defaults.ix);
    bleService.sendWledRaw({
      on: true,
      seg: [{ id: 0, start: 0, stop: 100, fx: effect.id, sx: speed, ix: intensity }],
    });
  };

  const previewPalette = (palette: WledPalette) => {
    setSelectedPalette(palette);
    bleService.sendWledRaw({
      on: true,
      seg: [{ id: 0, start: 0, stop: 100, pal: palette.id }],
    });
  };

  const applyParameters = () => {
    bleService.sendWledRaw({
      on: true,
      seg: [{ id: 0, start: 0, stop: 100, sx: speed, ix: intensity, c1, c2, c3, o1, o2, o3 }],
    });
  };

  const savePreset = async () => {
    if (!presetName.trim()) return;
    const id = generateId();
    let capturedSeg: object[] | undefined;
    if (memory.segments && isConnected) {
      try {
        capturedSeg = await fetchWledSegmentsFromDevice();
      } catch {
        Alert.alert('Segments', 'Could not capture WLED segments — saved without layout.');
      }
    }
    const preset: Preset = {
      id,
      name: presetName.trim(),
      createdAt: Date.now(),
      memory,
      wled: {
        on: true,
        fx:     selectedEffect?.id,
        fxName: selectedEffect?.name,
        pal:    selectedPalette?.id,
        palName: selectedPalette?.name,
        sx: speed,
        ix: intensity,
        c1, c2, c3, o1, o2, o3,
        ...(capturedSeg?.length ? { seg: capturedSeg } : {}),
      },
    };
    bleService.sendPresetSave(id, preset.name, preset.wled);
    addOrUpdatePreset(preset);
    saveToStorage();
    setPresetName('');
    setSaving(false);
    Alert.alert('Saved', `Preset "${preset.name}" saved.`);
  };

  const filteredEffects  = wledEffects.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase())
  );
  const filteredPalettes = wledPalettes.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const meta = selectedEffect ? parseFxMetadata(selectedEffect.metadata) : { sliders: ['Speed', 'Intensity'], checkboxes: [] as string[] };

  const sliderValues  = [speed, intensity, c1, c2, c3];
  const sliderSetters = [setSpeed, setIntensity, setC1, setC2, setC3];
  const checkValues   = [o1, o2, o3];
  const checkSetters  = [setO1, setO2, setO3];

  return (
    <View style={s.container}>

      {/* Tab bar */}
      <View style={s.tabBar}>
        {(['effects', 'palettes'] as Tab[]).map(t => (
          <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={s.refreshBtn} onPress={fetchAll} disabled={!isConnected || loading}>
          {loading
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <IconRefresh size={18} color={colors.primary} />}
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={s.searchRow}>
        <TextInput
          style={s.search}
          value={search}
          onChangeText={setSearch}
          placeholder={`Search ${tab}…`}
          placeholderTextColor={colors.textMuted}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <IconX size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={{ flex: 1, flexDirection: 'row' }}>

        {/* List */}
        <FlatList
          style={s.list}
          data={tab === 'effects' ? filteredEffects : filteredPalettes}
          keyExtractor={item => String(item.id)}
          ListEmptyComponent={
            <View style={s.centered}>
              {loading
                ? <Text style={s.hint}>Refreshing from device…</Text>
                : <Text style={s.hint}>
                    {isConnected
                      ? (wledEffects.length === 0 ? 'Tap ↻ to load from WLED' : 'No results')
                      : 'Connect to IllumaBuggy first'}
                  </Text>}
            </View>
          }
          renderItem={({ item }) => {
            const isSelected = tab === 'effects'
              ? selectedEffect?.id === item.id
              : selectedPalette?.id === item.id;
            return (
              <TouchableOpacity
                style={[s.listItem, isSelected && s.listItemSelected]}
                onPress={() => tab === 'effects'
                  ? previewEffect(item as WledEffect)
                  : previewPalette(item as WledPalette)}
              >
                <Text style={[s.listItemText, isSelected && { color: colors.primary }]} numberOfLines={1}>
                  {item.name}
                </Text>
                {isSelected && <IconCheck size={14} color={colors.primary} />}
              </TouchableOpacity>
            );
          }}
        />

        {/* Parameters panel (effects only) */}
        {tab === 'effects' && selectedEffect && (
          <ScrollView style={s.params} contentContainerStyle={s.paramsContent}>
            <Text style={s.paramTitle}>{selectedEffect.name}</Text>

            {meta.sliders.map((label, i) => (
              <View key={i} style={s.paramRow}>
                <View style={s.paramHeader}>
                  <Text style={s.paramLabel}>{label}</Text>
                  <Text style={s.paramValue}>{sliderValues[i]}</Text>
                </View>
                <Slider
                  minimumValue={0}
                  maximumValue={i === 4 ? 31 : 255}
                  step={1}
                  value={sliderValues[i]}
                  minimumTrackTintColor={colors.primary}
                  maximumTrackTintColor={colors.borderFocus}
                  thumbTintColor={colors.primary}
                  onValueChange={v => sliderSetters[i](Math.round(v))}
                  onSlidingComplete={applyParameters}
                />
              </View>
            ))}

            {meta.checkboxes.map((label, i) => (
              <View key={i} style={s.checkRow}>
                <Text style={s.paramLabel}>{label}</Text>
                <Switch
                  value={checkValues[i]}
                  onValueChange={v => { checkSetters[i](v); applyParameters(); }}
                  trackColor={{ false: colors.borderFocus, true: colors.primary }}
                />
              </View>
            ))}

            {/* Save as preset */}
            {!saving ? (
              <TouchableOpacity style={s.saveBtn} onPress={() => setSaving(true)}>
                <IconPlus size={16} color="#fff" />
                <Text style={s.saveBtnText}>Save as Preset</Text>
              </TouchableOpacity>
            ) : (
              <View style={s.saveForm}>
                <Text style={s.paramLabel}>Preset Name</Text>
                <TextInput
                  style={s.nameInput}
                  value={presetName}
                  onChangeText={setPresetName}
                  placeholder="e.g. Haunted Mansion"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                />
                <Text style={[s.paramLabel, { marginTop: 10 }]}>Remember at recall</Text>
                {(Object.keys(memory) as (keyof PresetMemory)[]).map(key => (
                  <View key={key} style={s.memRow}>
                    <Text style={s.memLabel}>{key.charAt(0).toUpperCase() + key.slice(1)}</Text>
                    <Switch
                      value={memory[key]}
                      onValueChange={v => setMemory(m => ({ ...m, [key]: v }))}
                      trackColor={{ false: colors.borderFocus, true: colors.primary }}
                    />
                  </View>
                ))}
                <View style={s.saveFormBtns}>
                  <TouchableOpacity style={s.cancelBtn} onPress={() => setSaving(false)}>
                    <Text style={s.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.confirmBtn, !presetName.trim() && { opacity: 0.4 }]}
                    onPress={savePreset}
                    disabled={!presetName.trim()}
                  >
                    <Text style={s.confirmBtnText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        )}

        {/* Palette save panel */}
        {tab === 'palettes' && selectedPalette && (
          <View style={s.params}>
            <Text style={s.paramTitle}>{selectedPalette.name}</Text>
            <Text style={s.hint}>Previewing on device</Text>
            {!saving ? (
              <TouchableOpacity style={s.saveBtn} onPress={() => setSaving(true)}>
                <IconPlus size={16} color="#fff" />
                <Text style={s.saveBtnText}>Save as Preset</Text>
              </TouchableOpacity>
            ) : (
              <View style={s.saveForm}>
                <Text style={s.paramLabel}>Preset Name</Text>
                <TextInput
                  style={s.nameInput}
                  value={presetName}
                  onChangeText={setPresetName}
                  placeholder="e.g. Tomorrowland"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                />
                <View style={s.saveFormBtns}>
                  <TouchableOpacity style={s.cancelBtn} onPress={() => setSaving(false)}>
                    <Text style={s.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.confirmBtn, !presetName.trim() && { opacity: 0.4 }]}
                    onPress={savePreset}
                    disabled={!presetName.trim()}
                  >
                    <Text style={s.confirmBtnText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = (c: ReturnType<typeof import('../utils/theme').useTheme>['colors']) => StyleSheet.create({
  container:        { flex: 1, backgroundColor: c.background },
  tabBar:           { flexDirection: 'row', backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border, paddingHorizontal: 16 },
  tab:              { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive:        { borderBottomColor: c.primary },
  tabText:          { color: c.textMuted, fontWeight: '600', fontSize: 14 },
  tabTextActive:    { color: c.primary },
  refreshBtn:       { marginLeft: 'auto', padding: 12 },
  searchRow:        { flexDirection: 'row', alignItems: 'center', margin: 12, backgroundColor: c.surface, borderRadius: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: c.border },
  search:           { flex: 1, color: c.textPrimary, paddingVertical: 10, fontSize: 14 },
  list:             { flex: 1, borderRightWidth: 1, borderRightColor: c.border },
  listItem:         { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listItemSelected: { backgroundColor: c.primaryDim },
  listItemText:     { color: c.textPrimary, fontSize: 13, flex: 1 },
  centered:         { padding: 24, alignItems: 'center' },
  hint:             { color: c.textMuted, fontSize: 12 },
  params:           { width: 200, backgroundColor: c.surface },
  paramsContent:    { padding: 12, gap: 10 },
  paramTitle:       { color: c.textPrimary, fontWeight: '700', fontSize: 14, marginBottom: 4 },
  paramRow:         { gap: 2 },
  paramHeader:      { flexDirection: 'row', justifyContent: 'space-between' },
  paramLabel:       { color: c.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  paramValue:       { color: c.textMuted, fontSize: 11 },
  checkRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  saveBtn:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.primary, padding: 10, borderRadius: 8, marginTop: 8 },
  saveBtnText:      { color: '#fff', fontWeight: '600', fontSize: 13 },
  saveForm:         { gap: 8, marginTop: 8 },
  nameInput:        { backgroundColor: c.background, borderRadius: 8, borderWidth: 1, borderColor: c.borderFocus, color: c.textPrimary, padding: 8, fontSize: 13 },
  memRow:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  memLabel:         { color: c.textPrimary, fontSize: 12 },
  saveFormBtns:     { flexDirection: 'row', gap: 8, marginTop: 4 },
  cancelBtn:        { flex: 1, padding: 8, borderRadius: 8, backgroundColor: c.surfaceAlt, alignItems: 'center' },
  cancelBtnText:    { color: c.textMuted, fontWeight: '600', fontSize: 12 },
  confirmBtn:       { flex: 1, padding: 8, borderRadius: 8, backgroundColor: c.success, alignItems: 'center' },
  confirmBtnText:   { color: '#fff', fontWeight: '600', fontSize: 12 },
});
