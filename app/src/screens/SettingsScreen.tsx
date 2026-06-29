import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Switch,
  ScrollView, TouchableOpacity, TextInput, Alert, Share,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import IconBluetooth from '@tabler/icons-react-native/dist/esm/icons/IconBluetooth';
import IconBluetoothOff from '@tabler/icons-react-native/dist/esm/icons/IconBluetoothOff';
import IconSun from '@tabler/icons-react-native/dist/esm/icons/IconSun';
import IconMoon from '@tabler/icons-react-native/dist/esm/icons/IconMoon';
import IconDeviceDesktop from '@tabler/icons-react-native/dist/esm/icons/IconDeviceDesktop';
import IconRefresh from '@tabler/icons-react-native/dist/esm/icons/IconRefresh';
import IconDownload from '@tabler/icons-react-native/dist/esm/icons/IconDownload';
import IconUpload from '@tabler/icons-react-native/dist/esm/icons/IconUpload';

import { useAppStore, RecallState, RecallValue } from '../stores/store';
import { MbMappingSections } from './MbMappingSections';
import { bleService } from '../services/BLEService';
import { useBLE } from '../hooks/useBLE';
import { useTheme, ThemeMode } from '../utils/theme';

const RECALL_OPTIONS: RecallValue[] = ['always', 'never', 'memory'];
const RECALL_LABELS: Record<RecallValue, string> = { always: 'Always', never: 'Never', memory: 'Memory' };

export default function SettingsScreen() {
  const { colors, mode, setMode } = useTheme();
  const s = styles(colors);
  const { isConnected } = useBLE();
  const {
    overrideKillOnZone, setOverrideKillOnZone,
    starlightEnabled, setStarlightEnabled,
    starlightTimeoutSec, setStarlightTimeoutSec,
    magicBandEnabled, setMagicBandEnabled,
    magicBandFivePoint, setMagicBandFivePoint,
    magicBandTimeoutSec, setMagicBandTimeoutSec,
    brightnessConfig, setBrightnessConfig,
    recallState, setRecallState,
    saveToStorage, exportData, importData,
  } = useAppStore();

  const updateOverrideMode = (val: boolean) => {
    setOverrideKillOnZone(val);
    bleService.sendOverrideMode(val);
    saveToStorage();
  };

  const pushSwConfig = (enabled = starlightEnabled, timeoutSec = starlightTimeoutSec) => {
    if (isConnected) bleService.sendSwConfig(enabled, timeoutSec * 1000);
  };

  const pushMbConfig = (
    enabled = magicBandEnabled,
    fivePoint = magicBandFivePoint,
    timeoutSec = magicBandTimeoutSec,
  ) => {
    if (isConnected) bleService.sendMbConfig(enabled, fivePoint, timeoutSec * 1000);
  };

  const updateStarlightEnabled = (val: boolean) => {
    setStarlightEnabled(val);
    pushSwConfig(val);
    saveToStorage();
  };

  const updateMbEnabled = (val: boolean) => {
    setMagicBandEnabled(val);
    pushMbConfig(val);
    saveToStorage();
  };

  const updateMbFivePoint = (val: boolean) => {
    setMagicBandFivePoint(val);
    pushMbConfig(magicBandEnabled, val);
    saveToStorage();
  };

  const updateBrightness = (key: keyof typeof brightnessConfig, val: string) => {
    const num = parseInt(val, 10);
    if (!isNaN(num)) { setBrightnessConfig({ [key]: num }); saveToStorage(); }
  };

  const updateRecall = (key: keyof RecallState, val: RecallValue) => {
    setRecallState({ [key]: val });
    saveToStorage();
  };

  const handleExport = async () => {
    try {
      const data = exportData();
      const json = JSON.stringify(data, null, 2);
      const filename = `illuma-buggy-${new Date().toISOString().split('T')[0]}.json`;
      const path = FileSystem.cacheDirectory + filename;
      await FileSystem.writeAsStringAsync(path, json);
      await Share.share({ url: path, title: 'Illuma Buggy Export' });
    } catch (e) {
      Alert.alert('Export Failed', String(e));
    }
  };

  const handleImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
      if (result.canceled) return;
      const file = result.assets[0];
      const json = await FileSystem.readAsStringAsync(file.uri);
      const data = JSON.parse(json);
      if (!data.version) throw new Error('Not a valid Illuma Buggy export file');
      Alert.alert(
        'Import Data',
        `This will replace all your presets, zones, and settings with data from ${file.name}. Continue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Import', style: 'destructive', onPress: () => { importData(data); Alert.alert('Imported', 'Data imported successfully.'); } },
        ]
      );
    } catch (e) {
      Alert.alert('Import Failed', String(e));
    }
  };

  const themeModes: { label: string; value: ThemeMode; icon: React.ReactNode }[] = [
    { label: 'Light',  value: 'light',  icon: <IconSun size={16} color={mode === 'light' ? colors.primary : colors.textMuted} /> },
    { label: 'Dark',   value: 'dark',   icon: <IconMoon size={16} color={mode === 'dark' ? colors.primary : colors.textMuted} /> },
    { label: 'System', value: 'system', icon: <IconDeviceDesktop size={16} color={mode === 'system' ? colors.primary : colors.textMuted} /> },
  ];

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>

      {/* Appearance */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Appearance</Text>
        <View style={s.themeRow}>
          {themeModes.map(({ label, value, icon }) => (
            <TouchableOpacity
              key={value}
              style={[s.themeBtn, mode === value && { borderColor: colors.primary, backgroundColor: colors.primaryDim }]}
              onPress={() => setMode(value)}
            >
              {icon}
              <Text style={[s.themeBtnText, mode === value && { color: colors.primary }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Recall State */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Recall State</Text>
        <Text style={s.sectionHint}>
          Controls which preset properties are applied when recalling a preset.
          "Memory" uses what was set at capture time.
        </Text>
        {(Object.keys(recallState) as (keyof RecallState)[]).map(key => (
          <View key={key} style={s.recallRow}>
            <Text style={s.rowLabel}>{key.charAt(0).toUpperCase() + key.slice(1)}</Text>
            <View style={s.recallBtns}>
              {RECALL_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt}
                  style={[s.recallBtn, recallState[key] === opt && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                  onPress={() => updateRecall(key, opt)}
                >
                  <Text style={[s.recallBtnText, recallState[key] === opt && { color: '#fff' }]}>
                    {RECALL_LABELS[opt]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
      </View>

      {/* Override */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Override Behavior</Text>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Reset on zone entry</Text>
            <Text style={s.rowHint}>When on, overrides clear when entering a new zone.</Text>
          </View>
          <Switch value={overrideKillOnZone} onValueChange={updateOverrideMode}
            trackColor={{ false: colors.borderFocus, true: colors.primary }} thumbColor="#fff" />
        </View>
      </View>

      {/* Starlight Wand */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Starlight Wand Effects</Text>
        <Text style={s.sectionHint}>Highest priority. Detects 0xCF9B wand broadcasts at home or in-park.</Text>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Enable wand effects</Text>
            <Text style={s.rowHint}>Listen for Starlight Wand BLE color codes.</Text>
          </View>
          <Switch value={starlightEnabled} onValueChange={updateStarlightEnabled}
            trackColor={{ false: colors.borderFocus, true: colors.primary }} thumbColor="#fff" />
        </View>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Auto-clear timeout</Text>
            <Text style={s.rowHint}>Seconds before wand effect reverts. 0 = never.</Text>
          </View>
          <TextInput
            style={{ backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.borderFocus, color: colors.textPrimary, padding: 8, fontSize: 14, width: 72, textAlign: 'right' }}
            value={String(starlightTimeoutSec)}
            onChangeText={v => { const n = parseInt(v, 10); if (!isNaN(n)) setStarlightTimeoutSec(n); }}
            onEndEditing={() => { pushSwConfig(); saveToStorage(); }}
            keyboardType="number-pad"
            selectTextOnFocus
          />
        </View>
      </View>

      {/* MagicBand */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>MagicBand+ Effects</Text>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Enable MB+ effects</Text>
            <Text style={s.rowHint}>Listen for in-park E9 show codes (lower priority than wand).</Text>
          </View>
          <Switch value={magicBandEnabled} onValueChange={updateMbEnabled}
            trackColor={{ false: colors.borderFocus, true: colors.primary }} thumbColor="#fff" />
        </View>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>5-point mode</Text>
            <Text style={s.rowHint}>On: 4 corners + center LED. Off: 4 corners only.</Text>
          </View>
          <Switch value={magicBandFivePoint} onValueChange={updateMbFivePoint}
            trackColor={{ false: colors.borderFocus, true: colors.primary }} thumbColor="#fff" />
        </View>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Auto-clear timeout</Text>
            <Text style={s.rowHint}>Seconds before MB+ effect auto-clears. 0 = never.</Text>
          </View>
          <TextInput
            style={{ backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.borderFocus, color: colors.textPrimary, padding: 8, fontSize: 14, width: 72, textAlign: 'right' }}
            value={String(magicBandTimeoutSec)}
            onChangeText={v => { const n = parseInt(v, 10); if (!isNaN(n)) setMagicBandTimeoutSec(n); }}
            onEndEditing={() => { pushMbConfig(); saveToStorage(); }}
            keyboardType="number-pad"
            selectTextOnFocus
          />
        </View>
      </View>

      {/* MB → WLED mapping */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>MagicBand Mapping</Text>
        <Text style={s.sectionHint}>
          Colors, animation/pattern presets, and segment layout. Synced to the board on change when connected.
        </Text>
        <MbMappingSections colors={colors} isConnected={isConnected} />
      </View>

      {/* Brightness */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Brightness</Text>
        <BrightnessField label="Daytime"   hint="Sun above threshold (0–255)" value={brightnessConfig.daytime}          onChange={v => updateBrightness('daytime', v)}          colors={colors} />
        <BrightnessField label="Nighttime" hint="Sun below threshold (0–255)" value={brightnessConfig.nighttime}        onChange={v => updateBrightness('nighttime', v)}        colors={colors} />
        <BrightnessField label="Indoor"    hint="Inside indoor zones (0–255)" value={brightnessConfig.indoor}           onChange={v => updateBrightness('indoor', v)}           colors={colors} />
        <BrightnessField label="Threshold (°)" hint="Solar elevation for day/night"  value={brightnessConfig.solarThresholdDeg}  onChange={v => updateBrightness('solarThresholdDeg', v)}  colors={colors} />
        <BrightnessField label="Transition (min)" hint="Ramp duration at threshold" value={brightnessConfig.transitionMinutes} onChange={v => updateBrightness('transitionMinutes', v)} colors={colors} />
      </View>

      {/* Export / Import */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Data</Text>
        <Text style={s.sectionHint}>Export all presets, zones, and settings to a JSON file. Import restores everything.</Text>
        <TouchableOpacity style={s.dataBtn} onPress={handleExport}>
          <IconDownload size={16} color={colors.primary} />
          <Text style={s.dataBtnText}>Export…</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.dataBtn} onPress={handleImport}>
          <IconUpload size={16} color={colors.primary} />
          <Text style={s.dataBtnText}>Import…</Text>
        </TouchableOpacity>
      </View>

      {/* Device */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Device</Text>
        <View style={s.row}>
          {isConnected ? <IconBluetooth size={18} color={colors.success} /> : <IconBluetoothOff size={18} color={colors.danger} />}
          <Text style={s.rowLabel}>IllumaBuggy</Text>
          <Text style={[s.rowHint, { marginLeft: 0 }]}>{isConnected ? 'Connected' : 'Disconnected'}</Text>
        </View>
        <TouchableOpacity style={s.reconnectBtn} onPress={() => bleService.connect()} disabled={isConnected}>
          <IconRefresh size={16} color={colors.primary} />
          <Text style={s.reconnectBtnText}>Reconnect</Text>
        </TouchableOpacity>
      </View>

    </ScrollView>
  );
}

function BrightnessField({ label, hint, value, onChange, colors }: {
  label: string; hint: string; value: number;
  onChange: (val: string) => void;
  colors: ReturnType<typeof import('../utils/theme').useTheme>['colors'];
}) {
  const s = StyleSheet.create({
    field:  { gap: 4 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    label:  { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
    hint:   { color: colors.textMuted, fontSize: 12 },
    input:  { backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.borderFocus, color: colors.textPrimary, padding: 8, fontSize: 14, width: 72, textAlign: 'right' },
  });
  return (
    <View style={s.field}>
      <View style={s.header}>
        <Text style={s.label}>{label}</Text>
        <TextInput style={s.input} value={String(value)} onChangeText={onChange} keyboardType="number-pad" selectTextOnFocus />
      </View>
      <Text style={s.hint}>{hint}</Text>
    </View>
  );
}

const styles = (c: ReturnType<typeof import('../utils/theme').useTheme>['colors']) => StyleSheet.create({
  container:       { flex: 1, backgroundColor: c.background },
  content:         { padding: 16, gap: 16 },
  section:         { backgroundColor: c.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: c.border, gap: 14 },
  sectionTitle:    { color: c.textSecondary, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  sectionHint:     { color: c.textMuted, fontSize: 12 },
  subHead:         { color: c.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 4 },
  row:             { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel:        { color: c.textPrimary, fontSize: 14, fontWeight: '500' },
  rowHint:         { color: c.textMuted, fontSize: 12, flex: 1 },
  mapRow:          { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border },
  mapValue:        { color: c.primary, fontSize: 13, fontWeight: '600', maxWidth: 120 },
  paletteRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border },
  paletteSwatch:   { width: 28, height: 28, borderRadius: 6, borderWidth: 1, borderColor: c.border },
  paletteInput:    { backgroundColor: c.background, borderRadius: 8, borderWidth: 1, borderColor: c.borderFocus, color: c.textPrimary, padding: 6, fontSize: 12, width: 88, fontFamily: 'monospace' },
  themeRow:        { flexDirection: 'row', gap: 8 },
  themeBtn:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceAlt },
  themeBtnText:    { color: c.textMuted, fontSize: 13, fontWeight: '500' },
  recallRow:       { gap: 6 },
  recallBtns:      { flexDirection: 'row', gap: 6 },
  recallBtn:       { flex: 1, padding: 6, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceAlt, alignItems: 'center' },
  recallBtnText:   { color: c.textMuted, fontSize: 11, fontWeight: '600' },
  dataBtn:         { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surfaceAlt, padding: 12, borderRadius: 8 },
  dataBtnText:     { color: c.primary, fontWeight: '600' },
  reconnectBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.surfaceAlt, padding: 12, borderRadius: 8 },
  reconnectBtnText: { color: c.primary, fontWeight: '600' },
});
