import React from 'react';
import { ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { PresetApplyMode, RecallState, RecallValue, useAppStore } from '../../stores/store';
import { bleService } from '../../services/BLEService';
import { useTheme } from '../../utils/theme';
import { moreStyles } from './moreStyles';

const OPTIONS: RecallValue[] = ['always', 'never', 'memory'];
const LABELS: Record<RecallValue, string> = { always: 'Always', never: 'Never', memory: 'Memory' };

const APPLY_MODE_META: Record<PresetApplyMode, { label: string; hint: string }> = {
  legacy: {
    label: 'Legacy (phone resolves)',
    hint: 'Most tested — phone builds WLED JSON and sends wled_raw.',
  },
  board: {
    label: 'Board (preset_apply)',
    hint: 'Faster to stay current for manual applies; auto-falls back if unsynced.',
  },
  wledDirect: {
    label: 'Direct WLED (zone GPS)',
    hint: 'Zone triggers POST straight to WLED over WiFi when on StrollerNet; falls back to BLE.',
  },
};

export default function PresetsConfigScreen() {
  const { colors } = useTheme();
  const s = moreStyles(colors);
  const {
    overrideKillOnZone, setOverrideKillOnZone,
    presetApplyMode, setPresetApplyMode,
    autoWledDirect, setAutoWledDirect,
    recallState, setRecallState, saveToStorage,
  } = useAppStore();
  const updateOverride = (value: boolean) => {
    setOverrideKillOnZone(value);
    void bleService.sendOverrideMode(value);
    saveToStorage();
  };
  const updateApplyMode = (value: PresetApplyMode) => {
    setPresetApplyMode(value);
    saveToStorage();
  };
  const updateAutoWledDirect = (value: boolean) => {
    setAutoWledDirect(value);
    saveToStorage();
  };
  const updateRecall = (key: keyof RecallState, value: RecallValue) => {
    setRecallState({ [key]: value });
    saveToStorage();
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Override Behavior</Text>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Reset on zone entry</Text>
            <Text style={s.rowHint}>Clear overrides when entering a new zone.</Text>
          </View>
          <Switch value={overrideKillOnZone} onValueChange={updateOverride} trackColor={{ false: colors.borderFocus, true: colors.primary }} thumbColor="#fff" />
        </View>
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Preset Apply Routing</Text>
        <Text style={s.sectionHint}>
          Experimental. Board mode uses preset_apply for manual applies when the preset is synced;
          zone triggers always resolve on the phone. Direct WLED skips BLE for zone GPS only.
        </Text>
        {(['legacy', 'board', 'wledDirect'] as const).map(mode => (
          <TouchableOpacity
            key={mode}
            style={[s.row, presetApplyMode === mode && { borderColor: colors.primary }]}
            onPress={() => updateApplyMode(mode)}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>{APPLY_MODE_META[mode].label}</Text>
              <Text style={s.rowHint}>{APPLY_MODE_META[mode].hint}</Text>
            </View>
            {presetApplyMode === mode ? <Text style={{ color: colors.primary }}>✓</Text> : null}
          </TouchableOpacity>
        ))}
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Auto-use direct WLED when on StrollerNet</Text>
            <Text style={s.rowHint}>
              For zone GPS applies when mode is Legacy. Ignored in Board mode.
            </Text>
          </View>
          <Switch
            value={autoWledDirect}
            onValueChange={updateAutoWledDirect}
            trackColor={{ false: colors.borderFocus, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Recall State</Text>
        <Text style={s.sectionHint}>Controls which preset properties are applied. Memory uses the capture-time setting.</Text>
        {(Object.keys(recallState) as (keyof RecallState)[]).map(key => (
          <View key={key} style={s.recallRow}>
            <Text style={s.rowLabel}>{key.charAt(0).toUpperCase() + key.slice(1)}</Text>
            <View style={s.recallBtns}>
              {OPTIONS.map(option => (
                <TouchableOpacity key={option} style={[s.recallBtn, recallState[key] === option && { backgroundColor: colors.primary, borderColor: colors.primary }]} onPress={() => updateRecall(key, option)}>
                  <Text style={[s.recallBtnText, recallState[key] === option && { color: '#fff' }]}>{LABELS[option]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
