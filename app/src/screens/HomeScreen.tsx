import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Switch,
} from 'react-native';
import Slider from '@react-native-community/slider';
import IconBluetooth from '@tabler/icons-react-native/dist/esm/icons/IconBluetooth';
import IconBluetoothOff from '@tabler/icons-react-native/dist/esm/icons/IconBluetoothOff';
import IconBulb from '@tabler/icons-react-native/dist/esm/icons/IconBulb';
import IconSparkles from '@tabler/icons-react-native/dist/esm/icons/IconSparkles';
import IconBolt from '@tabler/icons-react-native/dist/esm/icons/IconBolt';
import IconFlame from '@tabler/icons-react-native/dist/esm/icons/IconFlame';
import IconX from '@tabler/icons-react-native/dist/esm/icons/IconX';
import IconRefresh from '@tabler/icons-react-native/dist/esm/icons/IconRefresh';
import IconWifi from '@tabler/icons-react-native/dist/esm/icons/IconWifi';
import IconWifiOff from '@tabler/icons-react-native/dist/esm/icons/IconWifiOff';
import IconMap from '@tabler/icons-react-native/dist/esm/icons/IconMap';

import { useBLE } from '../hooks/useBLE';
import { useAppStore } from '../stores/store';
import { bleService } from '../services/BLEService';
import { useTheme } from '../utils/theme';

const OVERRIDE_LABELS = ['Zone', 'Zone', 'Manual', 'MagicBand+'];
const OVERRIDE_COLORS = (c: any) => [c.textMuted, c.success, c.warning, c.primary];

export default function HomeScreen() {
  const { colors } = useTheme();
  const s = styles(colors);
  const { connectionState, isConnected, sendOverrideClear } = useBLE();
  const { deviceStatus, presets, saveToStorage } = useAppStore();
  const [brightness, setBrightness]       = useState(deviceStatus?.brightness ?? 128);
  const [events, setEvents]               = useState<string[]>([]);
  const [zonesEnabled, setZonesEnabled]   = useState(true);

  // Request status immediately when connected
  useEffect(() => {
    if (!isConnected) return;
    bleService.sendStatus();
    const interval = setInterval(() => bleService.sendStatus(), 5000);
    return () => clearInterval(interval);
  }, [isConnected]);

  // Sync slider with device status
  useEffect(() => {
    if (deviceStatus?.brightness !== undefined) setBrightness(deviceStatus.brightness);
  }, [deviceStatus?.brightness]);

  // MagicBand+ event feed
  useEffect(() => {
    const unsub = bleService.onMessage((msg) => {
      if (msg.type === 'ble_event' || msg.type === 'ble_color') {
        const label = msg.type === 'ble_color'
          ? `Color → R${msg.r} G${msg.g} B${msg.b}`
          : String(msg.event);
        setEvents(prev => [label, ...prev].slice(0, 8));
      }
    });
    return unsub;
  }, []);

  const overrideIndex  = deviceStatus?.override ?? 0;
  const overrideColors = OVERRIDE_COLORS(colors);
  const overrideColor  = overrideColors[overrideIndex] ?? colors.textMuted;
  const currentPresetName = presets.find(p => p.id === deviceStatus?.currentPreset)?.name
    ?? (deviceStatus?.currentPreset ? deviceStatus.currentPreset : '—');

  const connIcon = isConnected
    ? <IconBluetooth size={18} color={colors.success} />
    : <IconBluetoothOff size={18} color={colors.danger} />;

  const toggleZones = (val: boolean) => {
    setZonesEnabled(val);
    // Persist zones enabled state
    useAppStore.setState({ zonesEnabled: val });
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>

      {/* Connection */}
      <View style={s.card}>
        <View style={s.row}>
          {connIcon}
          <Text style={s.statusText}>
            {connectionState === 'connected'    ? 'Connected to IllumaBuggy' :
             connectionState === 'scanning'     ? 'Scanning…' :
             connectionState === 'connecting'   ? 'Connecting…' :
             connectionState === 'disconnected' ? 'Disconnected' :
                                                  'Connection error — retrying'}
          </Text>
          {(connectionState === 'scanning' || connectionState === 'connecting') && (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 8 }} />
          )}
        </View>
        {deviceStatus && (
          <View style={[s.row, { marginTop: 4 }]}>
            {deviceStatus.wifiConnected
              ? <IconWifi size={13} color={colors.success} />
              : <IconWifiOff size={13} color={colors.danger} />}
            <Text style={s.subText}>
              WLED: {deviceStatus.wifiConnected ? 'connected' : 'not connected'}
            </Text>
          </View>
        )}
      </View>

      {/* Current Mode */}
      <View style={s.card}>
        <Text style={s.label}>Current Mode</Text>
        {deviceStatus ? (
          <>
            <View style={s.row}>
              <View style={[s.badge, { backgroundColor: overrideColor + '22', borderColor: overrideColor }]}>
                <Text style={[s.badgeText, { color: overrideColor }]}>
                  {OVERRIDE_LABELS[overrideIndex]}
                </Text>
              </View>
              {overrideIndex > 1 && (
                <TouchableOpacity style={s.clearBtn} onPress={() => bleService.sendOverrideClear()}>
                  <IconX size={14} color={colors.primary} />
                  <Text style={s.clearBtnText}>Resume Zone</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={s.subText}>Preset: {currentPresetName}</Text>
          </>
        ) : (
          <Text style={s.subText}>{isConnected ? 'Waiting for status…' : 'Not connected'}</Text>
        )}
      </View>

      {/* Zone control */}
      <View style={s.card}>
        <View style={s.row}>
          <IconMap size={16} color={colors.textSecondary} />
          <Text style={s.label}>Zone Automation</Text>
          <Switch
            value={zonesEnabled}
            onValueChange={toggleZones}
            trackColor={{ false: colors.borderFocus, true: colors.primary }}
            thumbColor="#ffffff"
            style={{ marginLeft: 'auto' }}
          />
        </View>
        <Text style={s.subText}>
          {zonesEnabled ? 'Zones active — entering a zone will trigger its preset' : 'Zones paused — no automatic preset changes'}
        </Text>
      </View>

      {/* Brightness */}
      <View style={s.card}>
        <View style={s.row}>
          <IconBulb size={16} color={colors.textSecondary} />
          <Text style={s.label}>Brightness</Text>
          <Text style={[s.label, { marginLeft: 'auto', color: colors.textPrimary }]}>{brightness}</Text>
        </View>
        <Slider
          style={{ marginTop: 8 }}
          minimumValue={0}
          maximumValue={255}
          step={1}
          value={brightness}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.borderFocus}
          thumbTintColor={colors.primary}
          onValueChange={setBrightness}
          onSlidingComplete={val => bleService.sendBrightness(Math.round(val))}
          disabled={!isConnected}
        />
      </View>

      {/* MagicBand+ feed */}
      {events.length > 0 && (
        <View style={s.card}>
          <View style={s.row}>
            <IconSparkles size={16} color={colors.textSecondary} />
            <Text style={s.label}>MagicBand+ Events</Text>
          </View>
          {events.map((e, i) => (
            <View key={i} style={[s.row, { opacity: 1 - i * 0.1, marginTop: 4 }]}>
              <IconBolt size={12} color={colors.primary} />
              <Text style={[s.subText, { marginLeft: 6 }]}>{e}</Text>
            </View>
          ))}
        </View>
      )}

    </ScrollView>
  );
}

const styles = (c: ReturnType<typeof import('../utils/theme').useTheme>['colors']) => StyleSheet.create({
  container:    { flex: 1, backgroundColor: c.background },
  content:      { padding: 16, gap: 12 },
  card:         { backgroundColor: c.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: c.border, gap: 8 },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label:        { color: c.textSecondary, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  statusText:   { color: c.textPrimary, fontSize: 15, fontWeight: '500' },
  subText:      { color: c.textMuted, fontSize: 13 },
  badge:        { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  badgeText:    { fontSize: 13, fontWeight: '600' },
  clearBtn:     { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.surfaceAlt, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  clearBtnText: { color: c.primary, fontSize: 13, fontWeight: '500' },
});
