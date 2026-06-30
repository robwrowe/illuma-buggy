import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Switch, Alert,
} from 'react-native';
import Slider from '@react-native-community/slider';
import IconBluetooth    from '@tabler/icons-react-native/dist/esm/icons/IconBluetooth';
import IconBluetoothOff from '@tabler/icons-react-native/dist/esm/icons/IconBluetoothOff';
import IconBulb         from '@tabler/icons-react-native/dist/esm/icons/IconBulb';
import IconSparkles     from '@tabler/icons-react-native/dist/esm/icons/IconSparkles';
import IconBolt         from '@tabler/icons-react-native/dist/esm/icons/IconBolt';
import IconX            from '@tabler/icons-react-native/dist/esm/icons/IconX';
import IconWifi         from '@tabler/icons-react-native/dist/esm/icons/IconWifi';
import IconWifiOff      from '@tabler/icons-react-native/dist/esm/icons/IconWifiOff';
import IconMap          from '@tabler/icons-react-native/dist/esm/icons/IconMap';

import { useBLE } from '../hooks/useBLE';
import { useAppStore } from '../stores/store';
import { bleService } from '../services/BLEService';
import { useTheme } from '../utils/theme';
import { useNavigation } from '@react-navigation/native';

const OVERRIDE_LABELS = ['—', 'Zone', 'Manual', 'MagicBand+', 'Starlight Wand'];
const OVERRIDE_COLORS = (c: ReturnType<typeof import('../utils/theme').useTheme>['colors']) =>
  [c.textMuted, c.success, c.warning, c.primary, '#c084fc'];

export default function HomeScreen() {
  const { colors } = useTheme();
  const s = styles(colors);
  const navigation = useNavigation();
  const { connectionState, isConnected } = useBLE();

  const {
    deviceStatus, presets, zones,
    activeZoneIds, zonesEnabled, setZonesEnabled,
    customPalettes, paletteSets, activePaletteSetId,
    setActivePaletteSet, saveToStorage,
    overrideDetail, setOverrideDetail,
    bleCaptureActive, bleCaptureLiveCount,
  } = useAppStore();

  const [brightness, setBrightness] = useState(deviceStatus?.brightness ?? 128);
  const [events, setEvents]         = useState<string[]>([]);

  // Request status immediately on connect, then every 5s
  useEffect(() => {
    if (!isConnected) return;
    bleService.sendStatus();
    const interval = setInterval(() => bleService.sendStatus(), 5000);
    return () => clearInterval(interval);
  }, [isConnected]);

  // Sync slider with device
  useEffect(() => {
    if (deviceStatus?.brightness !== undefined) setBrightness(deviceStatus.brightness);
  }, [deviceStatus?.brightness]);

  // BLE effect event feed (Starlight Wand + MagicBand+)
  useEffect(() => {
    return bleService.onMessage((msg) => {
      if (msg.type === 'sw_color') {
        const label = `Wand palette ${msg.palette} → R${msg.r} G${msg.g} B${msg.b}`;
        setEvents(prev => [label, ...prev].slice(0, 12));
      } else if (msg.type === 'sw_debug') {
        const label = `Wand [${msg.reason}] ${msg.hex} (${msg.len}b)`;
        setEvents(prev => [label, ...prev].slice(0, 12));
      } else if (msg.type === 'sw_event') {
        const name = msg.name ? ` (${msg.name})` : '';
        setEvents(prev => [`Wand: ${String(msg.event)}${name}`, ...prev].slice(0, 12));
      } else if (msg.type === 'ble_event' || msg.type === 'ble_color') {
        const label = msg.type === 'ble_color'
          ? `MB+ color → R${msg.r} G${msg.g} B${msg.b}`
          : `MB+: ${String(msg.event)}`;
        setEvents(prev => [label, ...prev].slice(0, 12));
      }
    });
  }, []);

  const overrideIndex  = deviceStatus?.override ?? 0;
  const overrideColor  = OVERRIDE_COLORS(colors)[overrideIndex] ?? colors.textMuted;
  const currentPreset  = presets.find(p => p.id === deviceStatus?.currentPreset);
  const activeZones    = zones.filter(z => activeZoneIds.includes(z.id));
  const overrideActive = overrideIndex > 0;

  const effectDescription = (() => {
    if (!deviceStatus || overrideIndex === 0) return 'Normal — zone or idle';
    if (overrideDetail) return overrideDetail;
    if (currentPreset) return currentPreset.name;
    if (overrideIndex === 1) return 'Zone preset';
    if (overrideIndex === 2) return 'Manual preset';
    if (overrideIndex === 3) return 'MagicBand+ effect';
    if (overrideIndex === 4) return 'Starlight Wand effect';
    return 'Active override';
  })();

  const clearEffect = () => {
    bleService.sendOverrideClear();
    setOverrideDetail(null);
  };

  // Push active palette set to WLED
  const activateSet = (setId: string | null) => {
    setActivePaletteSet(setId);
    saveToStorage();
    if (!setId || !isConnected) return;

    const ps = paletteSets.find(p => p.id === setId);
    if (!ps) return;

    // Custom palettes must be uploaded to WLED as /paletteN.json (web tool → Palettes → ↑ WLED).
    // Palette set order is stored here; WLED slot + palette # live on each CustomPalette after sync.
    const count = ps.paletteIds.length;
    Alert.alert(
      'Palette Set Selected',
      `“${ps.name}” has ${count} palette${count !== 1 ? 's' : ''}. ` +
      'Sync them to WLED from the web config tool (Palettes tab → ↑ WLED) while on StrollerNet, then presets using those palettes will apply correctly.',
    );
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>

      {bleCaptureActive && (
        <TouchableOpacity
          style={s.captureBanner}
          onPress={() => navigation.navigate('Capture' as never)}
        >
          <IconBolt size={16} color={colors.danger} />
          <Text style={s.captureBannerText}>
            Recording BLE · {bleCaptureLiveCount} packets — tap to view
          </Text>
        </TouchableOpacity>
      )}

      {/* Connection */}
      <View style={s.card}>
        <View style={s.row}>
          {isConnected
            ? <IconBluetooth size={18} color={colors.success} />
            : <IconBluetoothOff size={18} color={colors.danger} />}
          <Text style={s.statusText}>
            {connectionState === 'connected'    ? 'Connected to IllumaBuggy' :
             connectionState === 'scanning'     ? 'Scanning…' :
             connectionState === 'connecting'   ? 'Connecting…' :
             connectionState === 'disconnected' ? 'Disconnected — will retry' :
                                                  'Connection error — retrying'}
          </Text>
          {(connectionState === 'scanning' || connectionState === 'connecting') &&
            <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 'auto' }} />}
        </View>
        {deviceStatus && (
          <View style={s.row}>
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
        <Text style={s.label}>Current Effect</Text>
        {deviceStatus ? (
          <>
            <View style={s.row}>
              <View style={[s.badge, { backgroundColor: overrideColor + '22', borderColor: overrideColor }]}>
                <Text style={[s.badgeText, { color: overrideColor }]}>{OVERRIDE_LABELS[overrideIndex]}</Text>
              </View>
              {overrideActive && (
                <TouchableOpacity style={s.clearBtn} onPress={clearEffect}>
                  <IconX size={14} color={colors.danger} />
                  <Text style={[s.clearBtnText, { color: colors.danger }]}>Clear Effect</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={s.effectText}>{effectDescription}</Text>
            {currentPreset && overrideIndex <= 2 && (
              <Text style={s.subText}>Preset: {currentPreset.name}</Text>
            )}
          </>
        ) : (
          <Text style={s.subText}>{isConnected ? 'Waiting for status…' : 'Not connected'}</Text>
        )}
      </View>

      {/* Active Zones */}
      {(activeZones.length > 0 || zonesEnabled) && (
        <View style={s.card}>
          <View style={s.row}>
            <IconMap size={15} color={colors.textSecondary} />
            <Text style={s.label}>Active Zones</Text>
            <Switch
              value={zonesEnabled}
              onValueChange={v => { setZonesEnabled(v); saveToStorage(); }}
              trackColor={{ false: colors.borderFocus, true: colors.primary }}
              thumbColor="#fff"
              style={{ marginLeft: 'auto' }}
            />
          </View>
          {activeZones.length === 0 ? (
            <Text style={s.subText}>{zonesEnabled ? 'Not in any zone' : 'Zone triggers paused'}</Text>
          ) : (
            activeZones.map(z => {
              const preset = presets.find(p => p.id === z.presetId);
              return (
                <View key={z.id} style={s.zoneRow}>
                  <View style={s.zoneDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.zoneName}>{z.name}</Text>
                    {preset && <Text style={s.subText}>{preset.name}</Text>}
                  </View>
                </View>
              );
            })
          )}
        </View>
      )}

      {/* Palette Sets */}
      {paletteSets.length > 0 && (
        <View style={s.card}>
          <Text style={s.label}>Palette Set</Text>
          <Text style={s.subText}>Push a custom palette set to the device for this park</Text>
          <View style={s.setRow}>
            <TouchableOpacity
              style={[s.setChip, activePaletteSetId === null && s.setChipActive]}
              onPress={() => activateSet(null)}
            >
              <Text style={[s.setChipText, activePaletteSetId === null && { color: colors.primary }]}>Default</Text>
            </TouchableOpacity>
            {paletteSets.map(ps => (
              <TouchableOpacity
                key={ps.id}
                style={[s.setChip, activePaletteSetId === ps.id && s.setChipActive]}
                onPress={() => activateSet(ps.id)}
              >
                <Text style={[s.setChipText, activePaletteSetId === ps.id && { color: colors.primary }]}>
                  {ps.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {activePaletteSetId && (
            <Text style={[s.subText, { color: colors.success }]}>
              ✓ {paletteSets.find(p => p.id === activePaletteSetId)?.name} active
            </Text>
          )}
        </View>
      )}

      {/* Brightness */}
      <View style={s.card}>
        <View style={s.row}>
          <IconBulb size={15} color={colors.textSecondary} />
          <Text style={s.label}>Brightness</Text>
          <Text style={[s.label, { marginLeft: 'auto', color: colors.textPrimary }]}>{brightness}</Text>
        </View>
        <Slider
          minimumValue={0} maximumValue={255} step={1} value={brightness}
          minimumTrackTintColor={colors.primary} maximumTrackTintColor={colors.borderFocus}
          thumbTintColor={colors.primary}
          onValueChange={setBrightness}
          onSlidingComplete={v => bleService.sendBrightness(Math.round(v))}
          disabled={!isConnected}
        />
      </View>

      {/* BLE effect events — always visible when connected */}
      {isConnected && (
        <View style={s.card}>
          <View style={s.row}>
            <IconSparkles size={15} color={colors.textSecondary} />
            <Text style={s.label}>BLE Effect Events</Text>
          </View>
          {events.length === 0 ? (
            <Text style={s.subText}>Wave the wand — raw packets appear here as [packet] hex dumps</Text>
          ) : (
            events.map((e, i) => (
              <View key={i} style={[s.row, { opacity: Math.max(0.3, 1 - i * 0.08) }]}>
                <IconBolt size={11} color={colors.primary} />
                <Text style={[s.subText, { marginLeft: 4, flex: 1 }]} numberOfLines={2}>{e}</Text>
              </View>
            ))
          )}
        </View>
      )}

    </ScrollView>
  );
}

const styles = (c: ReturnType<typeof import('../utils/theme').useTheme>['colors']) => StyleSheet.create({
  container:    { flex: 1, backgroundColor: c.background },
  content:      { padding: 16, gap: 12 },
  captureBanner:{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.danger + '18', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: c.danger + '55' },
  captureBannerText: { color: c.textPrimary, fontSize: 13, fontWeight: '600', flex: 1 },
  card:         { backgroundColor: c.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: c.border, gap: 8 },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label:        { color: c.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  statusText:   { color: c.textPrimary, fontSize: 14, fontWeight: '500', flex: 1 },
  subText:      { color: c.textMuted, fontSize: 12 },
  badge:        { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  badgeText:    { fontSize: 13, fontWeight: '600' },
  effectText:   { color: c.textPrimary, fontSize: 15, fontWeight: '500' },
  clearBtn:     { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.danger + '18', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: c.danger + '44' },
  clearBtnText: { fontSize: 12, fontWeight: '600' },
  zoneRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  zoneDot:      { width: 8, height: 8, borderRadius: 4, backgroundColor: c.success },
  zoneName:     { color: c.textPrimary, fontSize: 13, fontWeight: '500' },
  setRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  setChip:      { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceAlt },
  setChipActive: { borderColor: c.primary, backgroundColor: c.primaryDim },
  setChipText:  { color: c.textMuted, fontSize: 13, fontWeight: '500' },
});
