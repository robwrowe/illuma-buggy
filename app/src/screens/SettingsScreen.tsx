import React from 'react';
import {
  View, Text, StyleSheet, Switch,
  ScrollView, TouchableOpacity, TextInput,
} from 'react-native';
import IconBluetooth from '@tabler/icons-react-native/dist/esm/icons/IconBluetooth';
import IconBluetoothOff from '@tabler/icons-react-native/dist/esm/icons/IconBluetoothOff';
import IconSun from '@tabler/icons-react-native/dist/esm/icons/IconSun';
import IconMoon from '@tabler/icons-react-native/dist/esm/icons/IconMoon';
import IconDeviceDesktop from '@tabler/icons-react-native/dist/esm/icons/IconDeviceDesktop';
import IconRefresh from '@tabler/icons-react-native/dist/esm/icons/IconRefresh';
import IconToggleLeft from '@tabler/icons-react-native/dist/esm/icons/IconToggleLeft';
import { useAppStore } from '../stores/store';
import { bleService } from '../services/BLEService';
import { useBLE } from '../hooks/useBLE';
import { useTheme, ThemeMode } from '../utils/theme';

export default function SettingsScreen() {
  const { colors, mode, setMode } = useTheme();
  const s = styles(colors);
  const { isConnected } = useBLE();
  const {
    overrideKillOnZone, setOverrideKillOnZone,
    brightnessConfig, setBrightnessConfig,
    saveToStorage,
  } = useAppStore();

  const updateOverrideMode = (val: boolean) => {
    setOverrideKillOnZone(val);
    bleService.sendOverrideMode(val);
    saveToStorage();
  };

  const updateBrightness = (key: keyof typeof brightnessConfig, val: string) => {
    const num = parseInt(val, 10);
    if (!isNaN(num)) { setBrightnessConfig({ [key]: num }); saveToStorage(); }
  };

  const themeModes: { label: string; value: ThemeMode; icon: React.ReactNode }[] = [
    { label: 'Light', value: 'light',  icon: <IconSun size={16} color={mode === 'light' ? colors.primary : colors.textMuted} /> },
    { label: 'Dark',  value: 'dark',   icon: <IconMoon size={16} color={mode === 'dark' ? colors.primary : colors.textMuted} /> },
    { label: 'System',value: 'system', icon: <IconDeviceDesktop size={16} color={mode === 'system' ? colors.primary : colors.textMuted} /> },
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

      {/* Override */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Override Behavior</Text>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Reset on zone entry</Text>
            <Text style={s.rowHint}>When on, overrides clear automatically when entering a new zone.</Text>
          </View>
          <Switch
            value={overrideKillOnZone}
            onValueChange={updateOverrideMode}
            trackColor={{ false: colors.borderFocus, true: colors.primary }}
            thumbColor="#ffffff"
          />
        </View>
      </View>

      {/* Brightness */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Brightness</Text>
        <BrightnessField label="Daytime"  hint="Applied when sun is above threshold (0–255)" value={brightnessConfig.daytime}  onChange={v => updateBrightness('daytime', v)}  colors={colors} />
        <BrightnessField label="Nighttime" hint="Applied when sun is below threshold (0–255)" value={brightnessConfig.nighttime} onChange={v => updateBrightness('nighttime', v)} colors={colors} />
        <BrightnessField label="Indoor"   hint="Applied inside indoor zones (0–255)"          value={brightnessConfig.indoor}   onChange={v => updateBrightness('indoor', v)}    colors={colors} />
      </View>

      {/* Solar */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Sun Position</Text>
        <BrightnessField label="Threshold (°)"    hint="Sun elevation for day/night crossover. 6° = civil twilight" value={brightnessConfig.solarThresholdDeg}  onChange={v => updateBrightness('solarThresholdDeg', v)}  colors={colors} />
        <BrightnessField label="Transition (min)" hint="Ramp duration centered on threshold"                        value={brightnessConfig.transitionMinutes}   onChange={v => updateBrightness('transitionMinutes', v)}   colors={colors} />
      </View>

      {/* Device */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Device</Text>
        <View style={s.row}>
          {isConnected
            ? <IconBluetooth size={18} color={colors.success} />
            : <IconBluetoothOff size={18} color={colors.danger} />}
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
  container:      { flex: 1, backgroundColor: c.background },
  content:        { padding: 16, gap: 16 },
  section:        { backgroundColor: c.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: c.border, gap: 14 },
  sectionTitle:   { color: c.textSecondary, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  row:            { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel:       { color: c.textPrimary, fontSize: 14, fontWeight: '500' },
  rowHint:        { color: c.textMuted, fontSize: 12, flex: 1 },
  themeRow:       { flexDirection: 'row', gap: 8 },
  themeBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceAlt },
  themeBtnText:   { color: c.textMuted, fontSize: 13, fontWeight: '500' },
  reconnectBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.surfaceAlt, padding: 12, borderRadius: 8 },
  reconnectBtnText: { color: c.primary, fontWeight: '600' },
});
