/**
 * Assign pre/live/post presets to park parades & fireworks; configure timing defaults.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Switch, ActivityIndicator, Alert,
} from 'react-native';
import Slider from '@react-native-community/slider';
import IconPlus from '@tabler/icons-react-native/dist/esm/icons/IconPlus';
import IconTrash from '@tabler/icons-react-native/dist/esm/icons/IconTrash';
import IconPencil from '@tabler/icons-react-native/dist/esm/icons/IconPencil';
import IconRefresh from '@tabler/icons-react-native/dist/esm/icons/IconRefresh';

import { useTheme } from '../utils/theme';
import { useAppStore } from '../stores/store';
import { PresetPickerModal } from './MbMappingSections';
import { listParkShows } from '../services/themeParksApi';
import {
  inferShowKind,
  normalizeShowBinding,
  type ParkShowBinding,
  type ShowKind,
} from '../utils/showBindings';
import { generateId } from '../utils/utils';

type PhaseKey = 'pre' | 'live' | 'post';
type PickerTarget = { bindingId: string; phase: PhaseKey } | null;

const PHASE_LABELS: Record<PhaseKey, string> = {
  pre: 'Pre-show',
  live: 'In-show',
  post: 'Post-show',
};

function presetLabel(presets: { id: string; name: string }[], id: string, kind: ShowKind, phase: PhaseKey): string {
  if (!id) return '—';
  if (id === '__BLACK__') return 'Black (strip off)';
  const p = presets.find(x => x.id === id);
  return p?.name ?? id.slice(0, 8);
}

export default function ShowsScreen() {
  const { colors } = useTheme();
  const s = styles(colors);
  const {
    parks, presets, zones, showBindings, showSettings, setShowSettings, saveToStorage,
    upsertShowBinding, removeShowBinding,
  } = useAppStore();

  const [selectedParkId, setSelectedParkId] = useState<string | null>(parks[0]?.id ?? null);
  const [apiShows, setApiShows] = useState<{ id: string; name: string }[]>([]);
  const [loadingShows, setLoadingShows] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerTarget>(null);
  const [showBriDraft, setShowBriDraft] = useState<string | null>(null);

  const selectedPark = parks.find(p => p.id === selectedParkId) ?? null;
  const parkBindings = showBindings.filter(b => b.parkId === selectedParkId);
  const parkZones = zones.filter(z => z.parkId === selectedParkId && z.enabled);

  const loadApiShows = useCallback(async () => {
    const entityId = selectedPark?.themeParksApiEntityId;
    if (!entityId) {
      setApiShows([]);
      return;
    }
    setLoadingShows(true);
    try {
      const list = await listParkShows(entityId);
      setApiShows(list.map(e => ({ id: e.id, name: e.name })));
    } catch {
      Alert.alert('Shows', 'Could not load show list from themeparks.wiki');
      setApiShows([]);
    } finally {
      setLoadingShows(false);
    }
  }, [selectedPark?.themeParksApiEntityId]);

  useEffect(() => {
    loadApiShows();
  }, [loadApiShows]);

  const assignShow = (entityId: string, name: string) => {
    if (!selectedParkId) return;
    const existing = showBindings.find(b => b.parkId === selectedParkId && b.entityId === entityId);
    if (existing) {
      setEditingId(existing.id);
      return;
    }
    const binding = normalizeShowBinding({
      id: generateId(),
      parkId: selectedParkId,
      entityId,
      name,
      kind: inferShowKind(name),
      presets: { pre: '', live: '', post: '' },
    }, showSettings);
    if (!binding) return;
    upsertShowBinding(binding);
    saveToStorage();
    setEditingId(binding.id);
  };

  const updateBinding = (id: string, patch: Partial<ParkShowBinding>) => {
    const cur = showBindings.find(b => b.id === id);
    if (!cur) return;
    const next = normalizeShowBinding({ ...cur, ...patch }, showSettings);
    if (!next) return;
    upsertShowBinding(next);
    saveToStorage();
  };

  const filteredApi = apiShows.filter(sh =>
    sh.name.toLowerCase().includes(search.toLowerCase()),
  );

  const pickScopeZone = (bindingId: string) => {
    const b = showBindings.find(x => x.id === bindingId);
    if (!b) return;
    const buttons: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }[] = [
      {
        text: 'Entire park',
        onPress: () => updateBinding(bindingId, { scopeZoneId: null }),
      },
      ...parkZones.map(z => ({
        text: z.name,
        onPress: () => updateBinding(bindingId, { scopeZoneId: z.id }),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ];
    Alert.alert('Show location', 'Where should automation run?', buttons);
  };

  const scopeLabel = (binding: ParkShowBinding) => {
    if (!binding.scopeZoneId) return 'Entire park';
    return parkZones.find(z => z.id === binding.scopeZoneId)?.name ?? 'Zone';
  };

  const editing = editingId ? showBindings.find(b => b.id === editingId) : null;
  const pickerBinding = picker ? showBindings.find(b => b.id === picker.bindingId) : null;

  return (
    <View style={s.wrap}>
      <ScrollView contentContainerStyle={s.content}>

        {/* Default timing */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Default timing</Text>
          <Text style={s.hint}>Applied when adding a new show binding.</Text>
          {([
            ['defaultPreLeadSec', 'Pre-show lead (sec)', 60],
            ['defaultPostDelaySec', 'Post-show delay (sec)', 30],
            ['defaultHomeVisibleBeforeMin', 'Home visible before (min)', 15],
            ['defaultHomeVisibleAfterMin', 'Home visible after (min)', 10],
            ['defaultParadeDurationMin', 'Default parade duration (min)', 5],
            ['defaultFireworksDurationMin', 'Default fireworks duration (min)', 5],
          ] as const).map(([key, label, step]) => (
            <View key={key} style={s.numRow}>
              <Text style={s.rowLabel}>{label}</Text>
              <TextInput
                style={s.numInput}
                keyboardType="number-pad"
                value={String(showSettings[key])}
                onChangeText={(v) => {
                  const n = parseInt(v, 10);
                  if (!isNaN(n)) {
                    setShowSettings({ [key]: n });
                    saveToStorage();
                  }
                }}
              />
            </View>
          ))}
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Show brightness</Text>
          <Text style={s.hint}>
            At nighttime (below your solar threshold in Settings → Brightness), entering live
            applies this brightness — manual Start or auto live for fireworks.
          </Text>
          <View style={s.switchRow}>
            <Text style={s.rowLabel}>Auto brightness at live</Text>
            <Switch
              value={showSettings.showAutoBrightness}
              onValueChange={(v) => {
                setShowSettings({ showAutoBrightness: v });
                saveToStorage();
              }}
              trackColor={{ false: colors.borderFocus, true: colors.primary }}
            />
          </View>
          <View style={s.numRow}>
            <Text style={s.rowLabel}>Night show brightness (0–255)</Text>
            <TextInput
              style={s.numInput}
              keyboardType="number-pad"
              editable={showSettings.showAutoBrightness}
              selectTextOnFocus
              value={showBriDraft ?? String(showSettings.showNightBrightness)}
              onChangeText={(v) => {
                setShowBriDraft(v);
                const n = parseInt(v, 10);
                if (!isNaN(n)) {
                  setShowSettings({ showNightBrightness: Math.min(255, Math.max(0, n)) });
                }
              }}
              onBlur={() => {
                setShowBriDraft(null);
                saveToStorage();
              }}
              onSubmitEditing={() => {
                setShowBriDraft(null);
                saveToStorage();
              }}
            />
          </View>
          <Slider
            minimumValue={0}
            maximumValue={255}
            step={1}
            value={showSettings.showNightBrightness}
            disabled={!showSettings.showAutoBrightness}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.borderFocus}
            thumbTintColor={colors.primary}
            onValueChange={(v) => {
              const n = Math.round(v);
              setShowSettings({ showNightBrightness: n });
            }}
            onSlidingComplete={() => saveToStorage()}
          />
        </View>

        {/* Park picker */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Park</Text>
          {parks.length === 0 ? (
            <Text style={s.hint}>
              Add a park in the web config tool (Parks tab) with a themeparks.wiki entity ID, then import or sync.
            </Text>
          ) : (
            <View style={s.parkRow}>
              {parks.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={[s.parkChip, selectedParkId === p.id && s.parkChipActive]}
                  onPress={() => { setSelectedParkId(p.id); setEditingId(null); }}
                >
                  <Text style={[s.parkChipText, selectedParkId === p.id && { color: colors.primary }]}>
                    {p.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {selectedPark && !selectedPark.themeParksApiEntityId && (
            <Text style={[s.hint, { color: colors.warning }]}>
              This park has no themeparks.wiki API ID — show search will not work.
            </Text>
          )}
        </View>

        {selectedParkId && (
          <>
            {/* Assigned bindings */}
            <View style={s.section}>
              <View style={s.rowBetween}>
                <Text style={s.sectionTitle}>Assigned shows</Text>
                <TouchableOpacity onPress={loadApiShows} disabled={loadingShows}>
                  {loadingShows
                    ? <ActivityIndicator size="small" color={colors.primary} />
                    : <IconRefresh size={18} color={colors.primary} />}
                </TouchableOpacity>
              </View>
              {parkBindings.length === 0 ? (
                <Text style={s.hint}>No shows assigned yet — search below.</Text>
              ) : (
                parkBindings.map(b => (
                  <TouchableOpacity
                    key={b.id}
                    style={[s.bindingCard, editingId === b.id && s.bindingCardActive]}
                    onPress={() => setEditingId(editingId === b.id ? null : b.id)}
                  >
                    <View style={s.rowBetween}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.bindingName}>{b.name}</Text>
                        <Text style={s.hint}>{b.kind} · {scopeLabel(b)} · {b.durationMin}m · pre {b.preLeadSec}s · post +{b.postDelaySec}s</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => {
                          Alert.alert('Remove show', `Remove "${b.name}"?`, [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Remove', style: 'destructive', onPress: () => {
                              removeShowBinding(b.id);
                              saveToStorage();
                              if (editingId === b.id) setEditingId(null);
                            }},
                          ]);
                        }}
                      >
                        <IconTrash size={18} color={colors.danger} />
                      </TouchableOpacity>
                    </View>
                    {editingId === b.id && (
                      <View style={s.editBlock}>
                        <TouchableOpacity style={s.phaseRow} onPress={() => pickScopeZone(b.id)}>
                          <Text style={s.rowLabel}>Location</Text>
                          <Text style={s.phaseValue}>{scopeLabel(b)}</Text>
                          <IconPencil size={14} color={colors.textMuted} />
                        </TouchableOpacity>
                        {(['pre', 'live', 'post'] as PhaseKey[]).map(phase => (
                          <TouchableOpacity
                            key={phase}
                            style={s.phaseRow}
                            onPress={() => setPicker({ bindingId: b.id, phase })}
                          >
                            <Text style={s.rowLabel}>{PHASE_LABELS[phase]}</Text>
                            <Text style={s.phaseValue}>
                              {presetLabel(presets, b.presets[phase], b.kind, phase)}
                            </Text>
                            <IconPencil size={14} color={colors.textMuted} />
                          </TouchableOpacity>
                        ))}
                        <View style={s.switchRow}>
                          <Text style={s.rowLabel}>Disable auto pre/post (all instances)</Text>
                          <Switch
                            value={b.autoPrePostDisabled}
                            onValueChange={(v) => updateBinding(b.id, { autoPrePostDisabled: v, autoStartDisabled: v })}
                            trackColor={{ false: colors.borderFocus, true: colors.primary }}
                          />
                        </View>
                        {b.kind === 'fireworks' && (
                          <View style={s.switchRow}>
                            <Text style={s.rowLabel}>Disable auto live (all instances)</Text>
                            <Switch
                              value={b.autoLiveDisabled}
                              onValueChange={(v) => updateBinding(b.id, { autoLiveDisabled: v })}
                              trackColor={{ false: colors.borderFocus, true: colors.primary }}
                            />
                          </View>
                        )}
                        {([
                          ['durationMin', 'Show duration (min)'],
                          ['preLeadSec', 'Pre lead (sec)'],
                          ['postDelaySec', 'Post delay (sec)'],
                          ['homeVisibleBeforeMin', 'Home before (min)'],
                          ['homeVisibleAfterMin', 'Home after (min)'],
                        ] as const).map(([key, label]) => (
                          <View key={key} style={s.numRow}>
                            <Text style={s.rowLabel}>{label}</Text>
                            <TextInput
                              style={s.numInput}
                              keyboardType="number-pad"
                              value={String(b[key])}
                              onChangeText={(v) => {
                                const n = parseInt(v, 10);
                                if (!isNaN(n)) updateBinding(b.id, { [key]: n });
                              }}
                            />
                          </View>
                        ))}
                      </View>
                    )}
                  </TouchableOpacity>
                ))
              )}
            </View>

            {/* Search & add */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>Search park shows</Text>
              <TextInput
                style={s.search}
                placeholder="Filter parades & fireworks…"
                placeholderTextColor={colors.textMuted}
                value={search}
                onChangeText={setSearch}
              />
              {filteredApi.map(sh => {
                const assigned = parkBindings.some(b => b.entityId === sh.id);
                return (
                  <TouchableOpacity
                    key={sh.id}
                    style={s.searchRow}
                    onPress={() => assignShow(sh.id, sh.name)}
                  >
                    <Text style={s.searchName}>{sh.name}</Text>
                    {assigned
                      ? <Text style={s.assignedBadge}>Assigned</Text>
                      : <IconPlus size={16} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
              {!loadingShows && filteredApi.length === 0 && (
                <Text style={s.hint}>No matching shows — check API ID or refresh.</Text>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <PresetPickerModal
        visible={!!picker && !!pickerBinding}
        title={picker ? `${PHASE_LABELS[picker.phase]} preset` : ''}
        presets={presets}
        selectedId={pickerBinding && picker ? pickerBinding.presets[picker.phase] : ''}
        emptyLabel={
          picker?.phase === 'live' && pickerBinding?.kind === 'fireworks'
            ? 'Black (strip off)'
            : 'None'
        }
        extraOptions={
          picker?.phase === 'live' && pickerBinding?.kind === 'fireworks'
            ? [{ id: '__BLACK__', label: 'Black (strip off)' }]
            : undefined
        }
        onSelect={(id) => {
          if (!picker || !pickerBinding) return;
          const presetsNext = { ...pickerBinding.presets, [picker.phase]: id };
          if (picker.phase === 'live' && pickerBinding.kind === 'fireworks' && !id) {
            presetsNext.live = '__BLACK__';
          }
          updateBinding(picker.bindingId, { presets: presetsNext });
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
        colors={colors}
      />
    </View>
  );
}

const styles = (c: ReturnType<typeof import('../utils/theme').useTheme>['colors']) => StyleSheet.create({
  wrap:             { flex: 1 },
  content:          { padding: 16, gap: 8, paddingBottom: 40 },
  section:          { marginBottom: 16 },
  sectionTitle:     { color: c.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 8 },
  hint:             { color: c.textMuted, fontSize: 12, marginBottom: 6 },
  rowBetween:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel:         { color: c.textSecondary, fontSize: 13, flex: 1 },
  parkRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  parkChip:         { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.border },
  parkChipActive:   { borderColor: c.primary, backgroundColor: c.primaryDim },
  parkChipText:     { color: c.textPrimary, fontSize: 13, fontWeight: '600' },
  bindingCard:      { backgroundColor: c.surface, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: c.border },
  bindingCardActive:{ borderColor: c.primary },
  bindingName:      { color: c.textPrimary, fontWeight: '600', fontSize: 14 },
  editBlock:        { marginTop: 10, gap: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 },
  phaseRow:         { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  phaseValue:       { color: c.primary, fontSize: 13, fontWeight: '600' },
  switchRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  numRow:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  numInput:         {
    width: 72, textAlign: 'right', backgroundColor: c.background, borderRadius: 8,
    borderWidth: 1, borderColor: c.borderFocus, color: c.textPrimary, padding: 8, fontSize: 13,
  },
  search:           {
    backgroundColor: c.surface, borderRadius: 10, borderWidth: 1, borderColor: c.border,
    color: c.textPrimary, padding: 10, fontSize: 14, marginBottom: 8,
  },
  searchRow:        {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border,
  },
  searchName:       { color: c.textPrimary, fontSize: 14, flex: 1 },
  assignedBadge:    { color: c.textMuted, fontSize: 11, fontWeight: '600' },
});
