import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, TextInput, Alert, ActivityIndicator,
} from 'react-native';
import IconPlus from '@tabler/icons-react-native/dist/esm/icons/IconPlus';
import IconRefresh from '@tabler/icons-react-native/dist/esm/icons/IconRefresh';
import IconCheck from '@tabler/icons-react-native/dist/esm/icons/IconCheck';
import IconTrash from '@tabler/icons-react-native/dist/esm/icons/IconTrash';
import IconSparkles from '@tabler/icons-react-native/dist/esm/icons/IconSparkles';
import { useBLE } from '../hooks/useBLE';
import { useAppStore, Preset } from '../stores/store';
import { bleService } from '../services/BLEService';
import { generateId } from '../utils/utils';
import { useTheme } from '../utils/theme';

export default function PresetsScreen() {
  const { colors } = useTheme();
  const s = styles(colors);
  const { isConnected, sendPresetList } = useBLE();
  const { presets, deviceStatus, addOrUpdatePreset, removePreset } = useAppStore();
  const [loading, setLoading]   = useState(false);
  const [newName, setNewName]   = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isConnected) return;
    setLoading(true);
    const unsub = bleService.onMessage((msg) => {
      if (msg.type === 'preset_list') setLoading(false);
    });
    sendPresetList();
    return unsub;
  }, [isConnected]);

  const applyPreset = (id: string) => bleService.sendPresetApply(id);

  const deletePreset = (preset: Preset) => {
    Alert.alert('Delete Preset', `Delete "${preset.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        bleService.sendPresetDelete(preset.id);
        removePreset(preset.id);
      }},
    ]);
  };

  const capturePreset = () => {
    if (!newName.trim()) return;
    const id = generateId();
    const preset: Preset = {
      id, name: newName.trim(),
      wled: { on: true, bri: 200, seg: [{ fx: 0, col: [[128, 0, 255]] }] },
    };
    bleService.sendPresetSave(id, preset.name, preset.wled);
    addOrUpdatePreset(preset);
    setNewName('');
    setCreating(false);
  };

  const renderPreset = ({ item }: { item: Preset }) => {
    const isActive = deviceStatus?.currentPreset === item.id;
    return (
      <View style={[s.presetCard, isActive && { borderColor: colors.primary }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.presetName}>{item.name}</Text>
          {isActive && (
            <View style={s.activePill}>
              <IconCheck size={10} color={colors.primary} />
              <Text style={s.activeLabel}>Active</Text>
            </View>
          )}
        </View>
        <TouchableOpacity style={s.applyBtn} onPress={() => applyPreset(item.id)} disabled={!isConnected}>
          <Text style={s.applyBtnText}>Apply</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.deleteBtn} onPress={() => deletePreset(item)}>
          <IconTrash size={18} color={colors.danger} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity style={s.iconBtn} onPress={() => { setLoading(true); sendPresetList(); }} disabled={!isConnected}>
          <IconRefresh size={18} color={colors.primary} />
          <Text style={s.iconBtnText}>Sync</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.iconBtn} onPress={() => setCreating(v => !v)} disabled={!isConnected}>
          <IconPlus size={18} color={colors.primary} />
          <Text style={s.iconBtnText}>New</Text>
        </TouchableOpacity>
      </View>

      {creating && (
        <View style={s.createCard}>
          <Text style={s.fieldLabel}>Preset Name</Text>
          <TextInput
            style={s.input}
            value={newName}
            onChangeText={setNewName}
            placeholder="e.g. Fantasyland"
            placeholderTextColor={colors.textMuted}
            autoFocus
          />
          <Text style={s.hint}>Set up your lights in WLED first, then capture the state.</Text>
          <TouchableOpacity
            style={[s.captureBtn, !newName.trim() && { opacity: 0.4 }]}
            onPress={capturePreset}
            disabled={!newName.trim()}
          >
            <IconSparkles size={16} color="#fff" />
            <Text style={s.captureBtnText}>Capture</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator color={colors.primary} />
          <Text style={s.hint}>Loading presets…</Text>
        </View>
      ) : presets.length === 0 ? (
        <View style={s.centered}>
          <IconSparkles size={40} color={colors.textMuted} />
          <Text style={s.emptyText}>No presets yet</Text>
          <Text style={s.hint}>Connect to IllumaBuggy, configure WLED, then tap New.</Text>
        </View>
      ) : (
        <FlatList
          data={presets}
          keyExtractor={item => item.id}
          renderItem={renderPreset}
          contentContainerStyle={s.list}
        />
      )}
    </View>
  );
}

const styles = (c: ReturnType<typeof import('../utils/theme').useTheme>['colors']) => StyleSheet.create({
  container:  { flex: 1, backgroundColor: c.background },
  header:     { flexDirection: 'row', justifyContent: 'flex-end', padding: 16, gap: 8 },
  list:       { padding: 16, gap: 10 },
  centered:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  presetCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border, gap: 10 },
  presetName: { color: c.textPrimary, fontSize: 15, fontWeight: '500' },
  activePill: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  activeLabel: { color: c.primary, fontSize: 12 },
  applyBtn:   { backgroundColor: c.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  applyBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  deleteBtn:  { padding: 8 },
  iconBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.surfaceAlt, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  iconBtnText: { color: c.primary, fontWeight: '500' },
  createCard: { backgroundColor: c.surface, margin: 16, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: c.border, gap: 10 },
  fieldLabel: { color: c.textSecondary, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  input:      { backgroundColor: c.background, borderRadius: 8, borderWidth: 1, borderColor: c.borderFocus, color: c.textPrimary, padding: 10, fontSize: 15 },
  hint:       { color: c.textMuted, fontSize: 12 },
  captureBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.success, padding: 12, borderRadius: 8 },
  captureBtnText: { color: '#fff', fontWeight: '600' },
  emptyText:  { color: c.textPrimary, fontSize: 16, fontWeight: '500' },
});
