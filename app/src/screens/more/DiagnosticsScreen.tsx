import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAppStore } from '../../stores/store';
import { useTheme } from '../../utils/theme';
import { moreStyles } from './moreStyles';
import { getBackgroundHealth, type BackgroundHealth } from '../../utils/backgroundHealth';
import { isLocationTaskRunning } from '../../utils/locationTracking';
import {
  isIgnoringBatteryOptimizations,
  isNativeKeepAliveAvailable,
  requestIgnoreBatteryOptimizations,
} from '../../utils/keepAliveNative';

function ageLabel(at: number): string {
  if (!at) return 'never';
  const sec = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.round(min / 60)}h ago`;
}

export default function DiagnosticsScreen() {
  const { colors } = useTheme();
  const s = moreStyles(colors);
  const { sheetsEndpoint, setSheetsEndpoint, mbUnmatchedLogEnabled, setMbUnmatchedLogEnabled, saveToStorage } = useAppStore();
  const [health, setHealth] = useState<BackgroundHealth>(getBackgroundHealth());
  const [fgsRunning, setFgsRunning] = useState<boolean | null>(null);
  const [batteryExempt, setBatteryExempt] = useState<boolean | null>(null);

  useEffect(() => {
    let cancel = false;
    const tick = async () => {
      if (cancel) return;
      setHealth({ ...getBackgroundHealth() });
      try {
        setFgsRunning(await isLocationTaskRunning());
      } catch {
        setFgsRunning(null);
      }
      setBatteryExempt(isIgnoringBatteryOptimizations());
    };
    void tick();
    const id = setInterval(() => { void tick(); }, 2000);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, []);

  const batteryLabel = !isNativeKeepAliveAvailable()
    ? 'unknown until the next app build'
    : batteryExempt ? 'exempt' : 'not exempt';
  const bleLabel = health.lastBleWriteAt
    ? `${health.lastBleWriteOk ? 'ok' : 'fail'} · ${health.lastBleWriteDetail} · ${ageLabel(health.lastBleWriteAt)}`
    : 'none yet';

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Background keep-alive</Text>
        <Text style={s.rowLabel}>Foreground service: {fgsRunning == null ? '…' : fgsRunning ? 'running' : 'stopped'}</Text>
        <Text style={s.rowLabel}>Battery optimization: {batteryLabel}</Text>
        <Text style={s.rowHint}>Last JS tick: {ageLabel(health.lastJsTickAt)}</Text>
        <Text style={s.rowHint}>Last show tick: {ageLabel(health.lastShowsTickAt)}</Text>
        <Text style={s.rowHint}>Last BLE write: {bleLabel}</Text>
        <TouchableOpacity style={s.dataBtn} onPress={() => { requestIgnoreBatteryOptimizations(); }}>
          <Text style={s.dataBtnText}>Request battery exemption</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.dataBtn} onPress={() => { void Linking.openURL('https://dontkillmyapp.com/'); }}>
          <Text style={s.dataBtnText}>OEM battery guidance</Text>
        </TouchableOpacity>
        <Text style={s.sectionHint}>
          The location notification stays up while zones, a show in the active park, capture, or a board connection need the app awake. Lock the phone and confirm the JS tick stays recent.
        </Text>
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Capture Uploads</Text>
        <View style={s.wledField}>
          <Text style={s.rowLabel}>Sheets endpoint</Text>
          <TextInput style={s.wledInput} value={sheetsEndpoint} onChangeText={setSheetsEndpoint} onEndEditing={saveToStorage} placeholder="https://script.google.com/macros/s/…/exec" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} />
          <Text style={s.rowHint}>Apps Script Web App URL for raw capture uploads. Leave blank to queue locally.</Text>
        </View>
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>BLE Diagnostics</Text>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Log unmatched BLE Data packets</Text>
            <Text style={s.rowHint}>Runs while connected. Disable if it causes instability.</Text>
          </View>
          <Switch value={mbUnmatchedLogEnabled} onValueChange={setMbUnmatchedLogEnabled} trackColor={{ false: colors.borderFocus, true: colors.primary }} thumbColor="#fff" />
        </View>
      </View>
    </ScrollView>
  );
}
