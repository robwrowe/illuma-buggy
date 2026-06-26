import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator,
} from 'react-native';
import Slider from '@react-native-community/slider';
import {
  IconBluetooth, IconBluetoothOff, IconBulb,
  IconSparkles, IconZap, IconFlame, IconX,
  IconRefresh, IconWifi, IconWifiOff,
} from '@tabler/icons-react-native';
import { useBLE } from '../hooks/useBLE';
import { useAppStore } from '../stores/store';
import { bleService } from '../services/BLEService';
import { useTheme } from '../utils/theme';

const OVERRIDE_LABELS = ['Zone', 'Zone', 'Manual', 'MagicBand+'];

export default function HomeScreen() {
  const { colors } = useTheme();
  const s = styles(colors);
  const { connectionState, isConnected, sendStatus, sendOverrideClear } = useBLE();
  const { deviceStatus, presets } = useAppStore();
  const [brightness, setBrightness] = useState(deviceStatus?.brightness ?? 128);
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    if (deviceStatus) setBrightness(deviceStatus.brightness);
  }, [deviceStatus?.brightness]);

  useEffect(() => {
    const unsub = bleService.onMessage((msg) => {
      if (msg.type === 'ble_event' || msg.type === 'ble_color') {
        const label = msg.type === 'ble_color'
          ? `Color → R${msg.r} G${msg.g} B${msg.b}`
          : `${msg.event}`;
        setEvents((prev) => [label, ...prev].slice(0, 8));
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!isConnected) return;
    sendStatus();
    const interval = setInterval(sendStatus, 5000);
    return () => clearInterval(interval);
  }, [isConnected]);

  const overrideIndex = deviceStatus?.override ?? 0;
  const overrideColor = [colors.textMuted, colors.success, colors.warning, colors.primary][overrideIndex];
  const currentPresetName = presets.find(p => p.id === deviceStatus?.currentPreset)?.name ?? '—';

  const connIcon = isConnected
    ? <IconBluetooth size={18} color={colors.success} />
    : <IconBluetoothOff size={18} color={colors.danger} />;

  const wifiIcon = deviceStatus?.wifiConnected
    ? <IconWifi size={14} color={colors.success} />
    : <IconWifiOff size={14} color={colors.danger} />;

  const eventIcon = (e: string) => {
    if (e.includes('Color'))     return <IconBulb size={14} color={colors.primary} />;
    if (e.includes('fireworks')) return <IconSparkles size={14} color={colors.warning} />;
    if (e.includes('flash'))     return <IconZap size={14} color={colors.warning} />;
    return <IconFlame size={14} color={colors.primary} />;
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>

      {/* Connection */}
      <View style={s.card}>
        <View style={s.row}>
          {connIcon}
          <Text style={s.statusText}>
            {connectionState === 'connected'    && 'Connected to IllumaBuggy'}
            {connectionState === 'scanning'     && 'Scanning…'}
            {connectionState === 'connecting'   && 'Connecting…'}
            {connectionState === 'disconnected' && 'Disconnected'}
            {connectionState === 'error'        && 'Connection error — retrying'}
          </Text>
          {(connectionState === 'scanning' || connectionState === 'connecting') && (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 8 }} />
          )}
        </View>
        {deviceStatus && (
          <View style={[s.row, { marginTop: 4 }]}>
            {wifiIcon}
            <Text style={s.subText}>
              WLED: {deviceStatus.wifiConnected ? 'connected' : 'not connected'}
            </Text>
          </View>
        )}
      </View>

      {/* Mode */}
      {deviceStatus && (
        <View style={s.card}>
          <Text style={s.label}>Current Mode</Text>
          <View style={s.row}>
            <View style={[s.badge, { backgroundColor: overrideColor + '22', borderColor: overrideColor }]}>
              <Text style={[s.badgeText, { color: overrideColor }]}>
                {OVERRIDE_LABELS[overrideIndex]}
              </Text>
            </View>
            {overrideIndex > 1 && (
              <TouchableOpacity style={s.clearBtn} onPress={sendOverrideClear}>
                <IconX size={14} color={colors.primary} />
                <Text style={s.clearBtnText}>Resume Zone</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={s.subText}>Preset: {currentPresetName}</Text>
        </View>
      )}

      {/* Brightness */}
      <View style={s.card}>
        <View style={s.row}>
          <IconBulb size={16} color={colors.textSecondary} />
          <Text style={s.label}>Brightness</Text>
          <Text style={s.value}>{brightness}</Text>
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
          onSlidingComplete={(val) => bleService.sendBrightness(Math.round(val))}
          disabled={!isConnected}
        />
      </View>

      {/* MagicBand+ Events */}
      {events.length > 0 && (
        <View style={s.card}>
          <View style={s.row}>
            <IconSparkles size={16} color={colors.textSecondary} />
            <Text style={s.label}>MagicBand+ Events</Text>
          </View>
          {events.map((e, i) => (
            <View key={i} style={[s.row, { opacity: 1 - i * 0.1, marginTop: 4 }]}>
              {eventIcon(e)}
              <Text style={[s.subText, { marginLeft: 6 }]}>{e}</Text>
            </View>
          ))}
        </View>
      )}

    </ScrollView>
  );
}

const styles = (c: ReturnType<typeof import('../utils/theme').useTheme>['colors']) => StyleSheet.create({
  container:   { flex: 1, backgroundColor: c.background },
  content:     { padding: 16, gap: 12 },
  card:        { backgroundColor: c.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: c.border, gap: 8 },
  row:         { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label:       { color: c.textSecondary, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  value:       { color: c.textPrimary, fontSize: 14, fontWeight: '600', marginLeft: 'auto' },
  statusText:  { color: c.textPrimary, fontSize: 15, fontWeight: '500' },
  subText:     { color: c.textMuted, fontSize: 13 },
  badge:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  badgeText:   { fontSize: 13, fontWeight: '600' },
  clearBtn:    { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.surfaceAlt, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  clearBtnText: { color: c.primary, fontSize: 13, fontWeight: '500' },
});
