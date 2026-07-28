import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import IconRefresh from '@tabler/icons-react-native/dist/esm/icons/IconRefresh';
import { useBLE } from '../hooks/useBLE';
import { useAppStore } from '../stores/store';
import { bleService } from '../services/BLEService';
import { useTheme } from '../utils/theme';
import { moreStyles } from './more/moreStyles';

type BoardRule = { id: string; name: string; prio: number; enabled: boolean };
type SortMode = 'priority' | 'az' | 'za';

export default function RulesScreen() {
  const { colors } = useTheme();
  const s = moreStyles(colors);
  const { isConnected } = useBLE();
  const { rulesPaused, setRulesPaused } = useAppStore();
  const [rules, setRules] = useState<BoardRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<SortMode>('priority');
  const [showDisabled, setShowDisabled] = useState(true);

  const refresh = useCallback(() => {
    if (!bleService.isConnected()) return;
    setLoading(true);
    void bleService.sendListRules();
  }, []);

  useEffect(() => bleService.onMessage(msg => {
    if (msg.type === 'rules_summary' && Array.isArray(msg.rules)) {
      setRules((msg.rules as Record<string, unknown>[]).map(rule => ({
        id: String(rule.id ?? ''),
        name: String(rule.name ?? rule.id ?? ''),
        prio: Number(rule.prio ?? 0),
        enabled: rule.enabled !== false,
      })).filter(rule => rule.id));
      setLoading(false);
    }
    if (msg.type === 'ack' && msg.action === 'set_rule_enabled' && msg.ok) {
      const id = String(msg.ruleId ?? '');
      setRules(prev => prev.map(rule => rule.id === id ? { ...rule, enabled: msg.enabled !== false } : rule));
    }
  }), []);

  useFocusEffect(useCallback(() => {
    if (isConnected) refresh();
    else setRules([]);
  }, [isConnected, refresh]));

  const visibleRules = useMemo(() => rules
    .filter(rule => showDisabled || rule.enabled)
    .sort((a, b) => sort === 'priority'
      ? a.prio - b.prio || a.name.localeCompare(b.name)
      : sort === 'az' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)), [rules, showDisabled, sort]);

  return (
    <FlatList
      style={s.container}
      contentContainerStyle={s.content}
      data={visibleRules}
      keyExtractor={rule => rule.id}
      ListHeaderComponent={
        <>
          <View style={s.section}>
            <Text style={s.sectionTitle}>Rules</Text>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowLabel}>Stop all rules</Text>
                <Text style={s.rowHint}>Pause board rule execution without changing individual rule settings.</Text>
              </View>
              <Switch value={rulesPaused} onValueChange={setRulesPaused} trackColor={{ false: colors.borderFocus, true: colors.primary }} thumbColor="#fff" />
            </View>
          </View>
          <View style={s.section}>
            <View style={s.row}>
              <Text style={[s.sectionTitle, { flex: 1 }]}>Board Rules</Text>
              {loading && <ActivityIndicator size="small" color={colors.primary} />}
              <TouchableOpacity onPress={refresh} disabled={!isConnected || loading}><IconRefresh size={18} color={colors.primary} /></TouchableOpacity>
            </View>
            <View style={s.recallBtns}>
              {(['priority', 'az', 'za'] as SortMode[]).map(option => (
                <TouchableOpacity key={option} style={[s.recallBtn, sort === option && { backgroundColor: colors.primary, borderColor: colors.primary }]} onPress={() => setSort(option)}>
                  <Text style={[s.recallBtnText, sort === option && { color: '#fff' }]}>{option === 'priority' ? 'Priority' : option === 'az' ? 'A→Z' : 'Z→A'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.row}>
              <Text style={s.rowLabel}>Hide disabled</Text>
              <Switch
                value={!showDisabled}
                onValueChange={(hide) => setShowDisabled(!hide)}
                trackColor={{ false: colors.borderFocus, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
            {!isConnected && <Text style={s.rowHint}>Connect to the board to manage rules.</Text>}
          </View>
        </>
      }
      ListEmptyComponent={!loading && isConnected ? <Text style={[s.rowHint, { textAlign: 'center' }]}>No matching rules on board.</Text> : null}
      renderItem={({ item }) => (
        <View style={[s.section, { marginTop: 0 }]}>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>{item.name || item.id}</Text>
              <Text style={s.rowHint}>prio {item.prio} · {item.id}</Text>
            </View>
            <Switch value={item.enabled} onValueChange={enabled => {
              setRules(prev => prev.map(rule => rule.id === item.id ? { ...rule, enabled } : rule));
              void bleService.sendSetRuleEnabled(item.id, enabled);
            }} trackColor={{ false: colors.borderFocus, true: colors.primary }} thumbColor="#fff" />
          </View>
        </View>
      )}
    />
  );
}
