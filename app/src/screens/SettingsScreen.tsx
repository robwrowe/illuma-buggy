import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, Switch,
  ScrollView, TouchableOpacity, TextInput, Alert, Share,
  Modal, ActivityIndicator, FlatList,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
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
import IconWifi from '@tabler/icons-react-native/dist/esm/icons/IconWifi';
import IconPlus from '@tabler/icons-react-native/dist/esm/icons/IconPlus';
import IconX from '@tabler/icons-react-native/dist/esm/icons/IconX';

import {
  useAppStore,
  RecallState,
  RecallValue,
  BoardRoleMode,
  DEFAULT_LOCATION_POLL_SEC,
  LOCATION_POLL_SEC_MIN,
  LOCATION_POLL_SEC_MAX,
} from '../stores/store';
import { MbMappingSections, PresetPickerModal } from './MbMappingSections';
import ShowsScreen from './ShowsScreen';
import { bleService } from '../services/BLEService';
import { useBLE } from '../hooks/useBLE';
import { requestFullBoardSync } from '../utils/connectBootstrap';
import { useTheme, ThemeMode } from '../utils/theme';
import {
  scanForScanners,
  DiscoveredScanner,
  normalizeScannerMacInput,
} from '../utils/scannerDiscovery';

const SCANNER_DISCOVERY_SEC = 10;

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
    mbUnmatchedLogEnabled, setMbUnmatchedLogEnabled,
    bleEffectTransitionMs, setBleEffectTransitionMs,
    wledSsid, setWledSsid,
    wledPass, setWledPass,
    wledIp, setWledIp,
    wledPort, setWledPort,
    deviceStatus,
    locationPollSec, setLocationPollSec,
    ftbPresetId, setFtbPresetId, presets,
    brightnessConfig, setBrightnessConfig,
    recallState, setRecallState,
    syncMode, setSyncMode,
    boardConnectEnabled, setBoardConnectEnabled,
    boardRole, setBoardRole,
    scannerMac, setScannerMac,
    saveToStorage, exportData, importData,
  } = useAppStore();

  const [ftbPickerOpen, setFtbPickerOpen] = useState(false);
  const [scannerModalOpen, setScannerModalOpen] = useState(false);
  const [scannerScanning, setScannerScanning] = useState(false);
  const [scannerResults, setScannerResults] = useState<DiscoveredScanner[]>([]);
  const [scannerSecLeft, setScannerSecLeft] = useState(SCANNER_DISCOVERY_SEC);
  const scannerStopRef = useRef<(() => void) | null>(null);

  const isDualBoard = boardRole === 'logic_board';

  useFocusEffect(
    useCallback(() => {
      if (!isConnected || !isDualBoard) return;
      void bleService.sendStatus();
      const id = setInterval(() => {
        if (bleService.isConnected()) void bleService.sendStatus();
      }, 5000);
      return () => clearInterval(id);
    }, [isConnected, isDualBoard]),
  );

  useEffect(() => () => {
    scannerStopRef.current?.();
    scannerStopRef.current = null;
  }, []);

  const pushBoardRole = (role: BoardRoleMode) => {
    if (isConnected) void bleService.sendBoardRole(role);
  };

  const pushScannerMacToBoard = (mac: string) => {
    const normalized = normalizeScannerMacInput(mac);
    if (!normalized) {
      Alert.alert('Invalid MAC', 'Enter a MAC like AA:BB:CC:DD:EE:FF');
      return false;
    }
    setScannerMac(normalized);
    if (isConnected) void bleService.sendScannerMac(normalized);
    saveToStorage();
    return true;
  };

  const updateBoardRole = (role: BoardRoleMode) => {
    setBoardRole(role);
    pushBoardRole(role);
    saveToStorage();
  };

  const startScannerDiscovery = () => {
    if (scannerScanning) return;
    setScannerResults([]);
    setScannerSecLeft(SCANNER_DISCOVERY_SEC);
    setScannerScanning(true);
    setScannerModalOpen(true);

    const tick = setInterval(() => {
      setScannerSecLeft(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    const { stop, done } = scanForScanners(SCANNER_DISCOVERY_SEC * 1000, (found) => {
      setScannerResults(prev => {
        if (prev.some(s => s.mac === found.mac)) return prev;
        return [...prev, found].sort((a, b) => b.rssi - a.rssi);
      });
    });
    scannerStopRef.current = stop;

    void done.finally(() => {
      clearInterval(tick);
      setScannerScanning(false);
      scannerStopRef.current = null;
    });
  };

  const selectDiscoveredScanner = (item: DiscoveredScanner) => {
    if (!isConnected) {
      Alert.alert('Not connected', 'Connect to IllumaBuggy before pairing a scanner.');
      return;
    }
    if (pushScannerMacToBoard(item.mac)) {
      setScannerModalOpen(false);
      scannerStopRef.current?.();
      Alert.alert('Scanner selected', `${item.mac} sent to logic board. Reboot logic board if scan radio was already running.`);
    }
  };

  const saveScannerMacManual = () => {
    if (!isConnected) {
      Alert.alert('Not connected', 'Connect to IllumaBuggy before saving scanner MAC.');
      return;
    }
    if (pushScannerMacToBoard(scannerMac)) {
      Alert.alert('Saved', 'Scanner MAC sent to logic board.');
    }
  };

  const scannerLinkLabel = (): { text: string; color: string } => {
    if (!isDualBoard) {
      return { text: 'Standalone — local BLE scan on logic board', color: colors.textMuted };
    }
    if (!deviceStatus?.scannerMac && !scannerMac) {
      return { text: 'Dual-board — no scanner MAC configured', color: colors.warning };
    }
    if (!deviceStatus?.scannerSeen) {
      return { text: 'Scanner: no signal', color: colors.danger };
    }
    const ageSec = Math.round((deviceStatus.scannerAgeMs ?? 0) / 1000);
    if (ageSec <= 15) {
      return { text: `Scanner: last seen ${ageSec}s ago`, color: colors.success };
    }
    if (ageSec <= 60) {
      return { text: `Scanner: last seen ${ageSec}s ago`, color: colors.warning };
    }
    return { text: `Scanner: last seen ${ageSec}s ago (stale)`, color: colors.danger };
  };

  const linkStatus = scannerLinkLabel();

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

  const pushBleEffectConfig = (transitionMs = bleEffectTransitionMs) => {
    if (isConnected) bleService.sendBleEffectConfig(transitionMs);
  };

  const saveWledNetConfig = () => {
    if (!isConnected) {
      Alert.alert('Not connected', 'Connect to IllumaBuggy before saving WLED network settings.');
      return;
    }
    const payload: { ssid?: string; pass?: string; ip?: string; port?: number } = {};
    if (wledSsid.trim()) payload.ssid = wledSsid.trim();
    if (wledPass) payload.pass = wledPass;
    if (wledIp.trim()) payload.ip = wledIp.trim();
    if (wledPort > 0) payload.port = wledPort;
    if (!payload.ssid && !payload.pass && !payload.ip && payload.port === undefined) {
      Alert.alert('Nothing to save', 'Enter at least one WLED network field.');
      return;
    }
    bleService.sendWledNetConfig(payload.ssid, payload.pass, payload.ip, payload.port);
    saveToStorage();
    Alert.alert('Saved', 'WLED network settings sent to board. WiFi will reconnect.');
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

      {/* WLED Network */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>WLED Network</Text>
        <Text style={s.sectionHint}>
          WiFi credentials and HTTP target for the GLEDOPTO controller. Saved to board NVS — tap Save to apply.
          {deviceStatus?.wledIp ? ` Board: ${deviceStatus.wledSsid ?? '?'} @ ${deviceStatus.wledIp}:${deviceStatus.wledPort ?? 80}` : ''}
        </Text>
        <View style={s.wledField}>
          <Text style={s.rowLabel}>SSID</Text>
          <TextInput
            style={s.wledInput}
            value={wledSsid}
            onChangeText={setWledSsid}
            placeholder={deviceStatus?.wledSsid ?? 'KyLan Ren'}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={s.wledField}>
          <Text style={s.rowLabel}>Password</Text>
          <TextInput
            style={s.wledInput}
            value={wledPass}
            onChangeText={setWledPass}
            placeholder="(unchanged if empty)"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={s.wledField}>
          <Text style={s.rowLabel}>IP / hostname</Text>
          <TextInput
            style={s.wledInput}
            value={wledIp}
            onChangeText={setWledIp}
            placeholder={deviceStatus?.wledIp ?? '4.3.2.1'}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Port</Text>
            <Text style={s.rowHint}>HTTP port (usually 80).</Text>
          </View>
          <TextInput
            style={{ backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.borderFocus, color: colors.textPrimary, padding: 8, fontSize: 14, width: 72, textAlign: 'right' }}
            value={String(wledPort)}
            onChangeText={v => { const n = parseInt(v, 10); if (!isNaN(n)) setWledPort(n); }}
            keyboardType="number-pad"
            selectTextOnFocus
          />
        </View>
        <TouchableOpacity style={s.dataBtn} onPress={saveWledNetConfig}>
          <IconWifi size={16} color={colors.primary} />
          <Text style={s.dataBtnText}>Save WLED network</Text>
        </TouchableOpacity>
      </View>

      {/* Starlight Wand */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Starlight Wand Effects</Text>
        <Text style={s.sectionHint}>Highest priority. Map presets under Wand & MagicBand Presets → Starlight tab.</Text>
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
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Log unmatched MB/Wand packets</Text>
            <Text style={s.rowHint}>Runs continuously while connected. Disable if it causes instability.</Text>
          </View>
          <Switch
            value={mbUnmatchedLogEnabled}
            onValueChange={setMbUnmatchedLogEnabled}
            trackColor={{ false: colors.borderFocus, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* Quick actions config */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Quick Actions</Text>
        <Text style={s.sectionHint}>
          Used for Home “Fade to Black” and MB rule fade-out (keeps WLED powered so the next effect can render). Empty = master power off.
        </Text>
        <TouchableOpacity style={s.dataBtn} onPress={() => setFtbPickerOpen(true)}>
          <IconMoon size={16} color={colors.primary} />
          <Text style={s.dataBtnText}>
            FTB preset: {ftbPresetId ? (presets.find(p => p.id === ftbPresetId)?.name ?? ftbPresetId) : 'Pure black'}
          </Text>
        </TouchableOpacity>
      </View>

      <PresetPickerModal
        visible={ftbPickerOpen}
        title="Fade to Black preset"
        presets={presets}
        selectedId={ftbPresetId}
        emptyLabel="Pure black (no preset)"
        onSelect={(id) => {
          setFtbPresetId(id);
          saveToStorage();
          if (bleService.isConnected()) bleService.sendMbRuleConfig(id || '');
        }}
        onClose={() => setFtbPickerOpen(false)}
        colors={colors}
      />

      {/* Zone GPS polling */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Zone Location</Text>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>GPS poll interval (sec)</Text>
            <Text style={s.rowHint}>
              Background refresh while zones are on ({LOCATION_POLL_SEC_MIN}–{LOCATION_POLL_SEC_MAX} sec).
              Lower = faster zone updates, more battery. Default {DEFAULT_LOCATION_POLL_SEC} sec.
            </Text>
          </View>
          <TextInput
            style={{ backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.borderFocus, color: colors.textPrimary, padding: 8, fontSize: 14, width: 72, textAlign: 'right' }}
            value={String(locationPollSec)}
            onChangeText={v => {
              const n = parseInt(v, 10);
              if (!isNaN(n)) setLocationPollSec(n);
            }}
            onEndEditing={() => saveToStorage()}
            keyboardType="number-pad"
            selectTextOnFocus
          />
        </View>
      </View>

      {/* MB / Wand transition */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Effect Transitions</Text>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Fade duration (ms)</Text>
            <Text style={s.rowHint}>Crossfade when MB+ or wand effects start and end. Preset/zone applies are always instant. 0 = hard cut.</Text>
          </View>
          <TextInput
            style={{ backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.borderFocus, color: colors.textPrimary, padding: 8, fontSize: 14, width: 72, textAlign: 'right' }}
            value={String(bleEffectTransitionMs)}
            onChangeText={v => { const n = parseInt(v, 10); if (!isNaN(n) && n >= 0) setBleEffectTransitionMs(n); }}
            onEndEditing={() => { pushBleEffectConfig(); saveToStorage(); }}
            keyboardType="number-pad"
            selectTextOnFocus
          />
        </View>
      </View>

      {/* MB → WLED mapping */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Wand & MagicBand Presets</Text>
        <Text style={s.sectionHint}>
          Same presets as GPS zones. Set a default, then per-effect overrides under Starlight / MagicBand tabs.
        </Text>
        <MbMappingSections colors={colors} isConnected={isConnected} />
      </View>

      {/* Park shows */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Park Shows</Text>
        <Text style={s.sectionHint}>
          Assign pre-show, in-show, and post-show presets to parades and fireworks per park.
        </Text>
        <ShowsScreen />
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

      {/* BLE Scanner Board (dual-board ESP-NOW) */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>BLE Scanner Board</Text>
        <Text style={s.sectionHint}>
          Optional second ESP32 scans Disney packets and forwards them over ESP-NOW.
          Reboot the logic board after switching modes.
        </Text>
        <View style={s.recallRow}>
          <Text style={s.rowLabel}>Board mode</Text>
          <View style={s.recallBtns}>
            {(['standalone', 'logic_board'] as BoardRoleMode[]).map(role => (
              <TouchableOpacity
                key={role}
                style={[s.recallBtn, boardRole === role && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                onPress={() => updateBoardRole(role)}
              >
                <Text style={[s.recallBtnText, boardRole === role && { color: '#fff' }]}>
                  {role === 'standalone' ? 'Standalone' : 'Dual-Board'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={s.row}>
          <Text style={[s.rowHint, { color: linkStatus.color, flex: 1 }]}>
            {linkStatus.text}
          </Text>
        </View>
        {isDualBoard && (
          <>
            <TouchableOpacity
              style={s.dataBtn}
              onPress={startScannerDiscovery}
              disabled={scannerScanning}
            >
              {scannerScanning ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <IconPlus size={16} color={colors.primary} />
              )}
              <Text style={s.dataBtnText}>
                {scannerScanning ? `Scanning… ${scannerSecLeft}s` : 'Add Scanner'}
              </Text>
            </TouchableOpacity>
            <View style={s.wledField}>
              <Text style={s.rowLabel}>Scanner MAC</Text>
              <Text style={s.rowHint}>Manual fallback — usually filled by Add Scanner.</Text>
              <TextInput
                style={s.wledInput}
                value={scannerMac}
                onChangeText={setScannerMac}
                placeholder="AA:BB:CC:DD:EE:FF"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>
            <TouchableOpacity
              style={[s.dataBtn, !scannerMac.trim() && { opacity: 0.4 }]}
              onPress={saveScannerMacManual}
              disabled={!scannerMac.trim()}
            >
              <IconBluetooth size={16} color={colors.primary} />
              <Text style={s.dataBtnText}>Save scanner MAC to board</Text>
            </TouchableOpacity>
            {deviceStatus?.logicMac ? (
              <Text style={s.rowHint}>Logic board MAC: {deviceStatus.logicMac}</Text>
            ) : null}
          </>
        )}
      </View>

      <Modal visible={scannerModalOpen} transparent animationType="slide">
        <View style={s.modalBackdrop}>
          <View style={[s.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={s.row}>
              <Text style={[s.sectionTitle, { flex: 1, textTransform: 'none', letterSpacing: 0 }]}>
                Unpaired scanners
              </Text>
              <TouchableOpacity
                onPress={() => {
                  scannerStopRef.current?.();
                  setScannerModalOpen(false);
                  setScannerScanning(false);
                }}
              >
                <IconX size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={s.sectionHint}>
              {scannerScanning
                ? `Scanning ${scannerSecLeft}s — tap a board to pair`
                : 'Scan complete — tap a result or close'}
            </Text>
            <FlatList
              data={scannerResults}
              keyExtractor={item => item.mac}
              style={{ maxHeight: 280 }}
              ListEmptyComponent={
                <Text style={[s.rowHint, { paddingVertical: 16, textAlign: 'center' }]}>
                  {scannerScanning ? 'Listening for unpaired scanners…' : 'No scanners found'}
                </Text>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.mapRow, { borderBottomColor: colors.border }]}
                  onPress={() => selectDiscoveredScanner(item)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowLabel}>{item.mac}</Text>
                    <Text style={s.rowHint}>{item.name} · rssi {item.rssi}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Device */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Device</Text>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Auto-sync on connect</Text>
            <Text style={s.rowHint}>Off: board keeps its saved config until you tap Sync board config.</Text>
          </View>
          <Switch
            value={syncMode === 'auto'}
            onValueChange={(v) => setSyncMode(v ? 'auto' : 'manual')}
            trackColor={{ false: colors.borderFocus, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>
        {syncMode === 'manual' && (
          <Text style={s.sectionHint}>
            Board will run off its last-known config. Use Sync board config on Home to push changes.
          </Text>
        )}
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Connect to IllumaBuggy board</Text>
            <Text style={s.rowHint}>
              Turn off when using your phone alone at the parks (e.g. for BLE capture) so the board
              connection doesn't use the Bluetooth radio.
            </Text>
          </View>
          <Switch
            value={boardConnectEnabled}
            onValueChange={setBoardConnectEnabled}
            trackColor={{ false: colors.borderFocus, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>
        <View style={s.row}>
          {isConnected ? <IconBluetooth size={18} color={colors.success} /> : <IconBluetoothOff size={18} color={colors.danger} />}
          <Text style={s.rowLabel}>IllumaBuggy</Text>
          <Text style={[s.rowHint, { marginLeft: 0 }]}>{isConnected ? 'Connected' : 'Disconnected'}</Text>
        </View>
        <TouchableOpacity
          style={s.reconnectBtn}
          onPress={() => bleService.connect()}
          disabled={isConnected || !boardConnectEnabled}
        >
          <IconRefresh size={16} color={colors.primary} />
          <Text style={s.reconnectBtnText}>Reconnect</Text>
        </TouchableOpacity>
        <Text style={s.sectionHint}>
          If MB+ or wand effects look wrong after a board reboot, tap Sync board config while connected.
        </Text>
        <TouchableOpacity
          style={s.dataBtn}
          onPress={() => requestFullBoardSync()}
          disabled={!isConnected}
        >
          <IconRefresh size={16} color={colors.primary} />
          <Text style={s.dataBtnText}>Sync board config</Text>
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
  wledField:       { gap: 6 },
  wledInput:       { backgroundColor: c.background, borderRadius: 8, borderWidth: 1, borderColor: c.borderFocus, color: c.textPrimary, padding: 10, fontSize: 14 },
  modalBackdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalCard:       { borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, padding: 16, gap: 12, maxHeight: '70%' },
});
