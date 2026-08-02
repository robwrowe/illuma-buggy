import React, { useState } from 'react';
import { Alert, ScrollView, Share, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import IconBluetooth from '@tabler/icons-react-native/dist/esm/icons/IconBluetooth';
import IconBluetoothOff from '@tabler/icons-react-native/dist/esm/icons/IconBluetoothOff';
import IconDeviceDesktop from '@tabler/icons-react-native/dist/esm/icons/IconDeviceDesktop';
import IconDownload from '@tabler/icons-react-native/dist/esm/icons/IconDownload';
import IconMoon from '@tabler/icons-react-native/dist/esm/icons/IconMoon';
import IconRefresh from '@tabler/icons-react-native/dist/esm/icons/IconRefresh';
import IconSun from '@tabler/icons-react-native/dist/esm/icons/IconSun';
import IconUpload from '@tabler/icons-react-native/dist/esm/icons/IconUpload';
import { PresetPickerModal } from '../MbMappingSections';
import { DEFAULT_LOCATION_POLL_SEC, LOCATION_POLL_SEC_MAX, LOCATION_POLL_SEC_MIN, useAppStore } from '../../stores/store';
import { bleService } from '../../services/BLEService';
import { useBLE } from '../../hooks/useBLE';
import { requestFullBoardSync } from '../../utils/connectBootstrap';
import { ThemeMode, useTheme } from '../../utils/theme';
import { moreStyles } from './moreStyles';

export default function GeneralScreen() {
  const { colors, mode, setMode } = useTheme();
  const s = moreStyles(colors);
  const { isConnected } = useBLE();
  const {
    locationPollSec, setLocationPollSec, ftbPresetId, setFtbPresetId, presets, syncMode, setSyncMode,
    boardConnectEnabled, setBoardConnectEnabled, parkMode, setParkMode, saveToStorage, exportData, importData,
  } = useAppStore();
  const [pickerOpen, setPickerOpen] = useState(false);
  const modes: { label: string; value: ThemeMode; icon: React.ReactNode }[] = [
    { label: 'Light', value: 'light', icon: <IconSun size={16} color={mode === 'light' ? colors.primary : colors.textMuted} /> },
    { label: 'Dark', value: 'dark', icon: <IconMoon size={16} color={mode === 'dark' ? colors.primary : colors.textMuted} /> },
    { label: 'System', value: 'system', icon: <IconDeviceDesktop size={16} color={mode === 'system' ? colors.primary : colors.textMuted} /> },
  ];
  const exportConfig = async () => {
    try {
      const filename = `illuma-buggy-${new Date().toISOString().split('T')[0]}.json`;
      const path = FileSystem.cacheDirectory + filename;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(exportData(), null, 2));
      await Share.share({ url: path, title: 'Illuma Buggy Export' });
    } catch (error) {
      Alert.alert('Export Failed', String(error));
    }
  };
  const importConfig = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
      if (result.canceled) return;
      const file = result.assets[0];
      const data = JSON.parse(await FileSystem.readAsStringAsync(file.uri));
      if (!data.version) throw new Error('Not a valid Illuma Buggy export file');
      Alert.alert('Import Data', `Replace presets, zones, and settings with ${file.name}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Import', style: 'destructive', onPress: () => { importData(data); Alert.alert('Imported', 'Data imported successfully.'); } },
      ]);
    } catch (error) {
      Alert.alert('Import Failed', String(error));
    }
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Appearance</Text>
        <View style={s.themeRow}>
          {modes.map(({ label, value, icon }) => (
            <TouchableOpacity key={value} style={[s.themeBtn, mode === value && { borderColor: colors.primary, backgroundColor: colors.primaryDim }]} onPress={() => setMode(value)}>
              {icon}<Text style={[s.themeBtnText, mode === value && { color: colors.primary }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Zone Location</Text>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>GPS poll interval (sec)</Text>
            <Text style={s.rowHint}>Background refresh while zones are on ({LOCATION_POLL_SEC_MIN}–{LOCATION_POLL_SEC_MAX} sec). Default {DEFAULT_LOCATION_POLL_SEC} sec.</Text>
          </View>
          <TextInput style={[s.wledInput, { width: 72, textAlign: 'right', padding: 8 }]} value={String(locationPollSec)} onChangeText={v => { const n = parseInt(v, 10); if (!Number.isNaN(n)) setLocationPollSec(n); }} onEndEditing={saveToStorage} keyboardType="number-pad" selectTextOnFocus />
        </View>
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Data</Text>
        <Text style={s.sectionHint}>Export all presets, zones, and settings. Import restores everything.</Text>
        <TouchableOpacity style={s.dataBtn} onPress={exportConfig}><IconDownload size={16} color={colors.primary} /><Text style={s.dataBtnText}>Export…</Text></TouchableOpacity>
        <TouchableOpacity style={s.dataBtn} onPress={importConfig}><IconUpload size={16} color={colors.primary} /><Text style={s.dataBtnText}>Import…</Text></TouchableOpacity>
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Quick Actions</Text>
        <TouchableOpacity style={s.dataBtn} onPress={() => setPickerOpen(true)}>
          <IconMoon size={16} color={colors.primary} /><Text style={s.dataBtnText}>FTB preset: {ftbPresetId ? (presets.find(p => p.id === ftbPresetId)?.name ?? ftbPresetId) : 'Pure black'}</Text>
        </TouchableOpacity>
        <PresetPickerModal visible={pickerOpen} title="Fade to Black preset" presets={presets} selectedId={ftbPresetId} emptyLabel="Pure black (no preset)" colors={colors} onClose={() => setPickerOpen(false)} onSelect={id => { setFtbPresetId(id); saveToStorage(); if (bleService.isConnected()) void bleService.sendMbRuleConfig(id || ''); }} />
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Device</Text>
        <View style={s.row}><View style={{ flex: 1 }}><Text style={s.rowLabel}>Park Mode</Text><Text style={s.rowHint}>Minimize BLE traffic and skip config push on connect.</Text></View><Switch value={parkMode} onValueChange={setParkMode} trackColor={{ false: colors.borderFocus, true: colors.primary }} thumbColor="#fff" /></View>
        <View style={s.row}><View style={{ flex: 1 }}><Text style={s.rowLabel}>Connect to IllumaBuggy board</Text><Text style={s.rowHint}>Turn off for phone-only park use.</Text></View><Switch value={boardConnectEnabled} onValueChange={setBoardConnectEnabled} trackColor={{ false: colors.borderFocus, true: colors.primary }} thumbColor="#fff" /></View>
        <View style={s.row}>{isConnected ? <IconBluetooth size={18} color={colors.success} /> : <IconBluetoothOff size={18} color={colors.danger} />}<Text style={s.rowLabel}>IllumaBuggy</Text><Text style={s.rowHint}>{isConnected ? 'Connected' : 'Disconnected'}</Text></View>
        <View style={s.row}><View style={{ flex: 1 }}><Text style={s.rowLabel}>Auto-sync on connect</Text><Text style={s.rowHint}>Off keeps board config until manually synced.</Text></View><Switch value={syncMode === 'auto'} onValueChange={v => setSyncMode(v ? 'auto' : 'manual')} trackColor={{ false: colors.borderFocus, true: colors.primary }} thumbColor="#fff" /></View>
        <TouchableOpacity style={s.dataBtn} disabled={!isConnected} onPress={() => requestFullBoardSync()}><IconRefresh size={16} color={colors.primary} /><Text style={s.dataBtnText}>Sync board config</Text></TouchableOpacity>
        <TouchableOpacity style={s.reconnectBtn} disabled={isConnected || !boardConnectEnabled} onPress={() => bleService.connect()}><IconRefresh size={16} color={colors.primary} /><Text style={s.reconnectBtnText}>Reconnect</Text></TouchableOpacity>
      </View>
    </ScrollView>
  );
}
