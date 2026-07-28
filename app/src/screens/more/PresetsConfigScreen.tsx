import React from 'react';
import { ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { RecallState, RecallValue, useAppStore } from '../../stores/store';
import { bleService } from '../../services/BLEService';
import { useTheme } from '../../utils/theme';
import { moreStyles } from './moreStyles';

const OPTIONS: RecallValue[] = ['always', 'never', 'memory'];
const LABELS: Record<RecallValue, string> = { always: 'Always', never: 'Never', memory: 'Memory' };

export default function PresetsConfigScreen() {
  const { colors } = useTheme();
  const s = moreStyles(colors);
  const { overrideKillOnZone, setOverrideKillOnZone, recallState, setRecallState, saveToStorage } = useAppStore();
  const updateOverride = (value: boolean) => {
    setOverrideKillOnZone(value);
    void bleService.sendOverrideMode(value);
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
