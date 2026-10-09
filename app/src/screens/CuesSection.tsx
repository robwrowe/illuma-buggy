/**
 * Park cue list and editor. Rows are sentences from describeCue().
 */

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Switch, Modal, ScrollView, Alert,
} from 'react-native';
import { useAppStore } from '../stores/store';
import { useTheme } from '../utils/theme';
import {
  describeCue, cueWarnings, type CueAnchor, type ShowCue,
} from '../utils/showCues';
import { getParkDaySchedule } from '../services/parkShowtimesCache';
import { parkDateString } from '../utils/showCues';
import { testCueNow } from '../services/cueExecutor';
import type { ParkShowBinding } from '../utils/showBindings';

function newId(): string {
  return `cue_${Date.now().toString(36)}`;
}

function blankCue(parkId: string, bindingId?: string): ShowCue {
  return {
    id: newId(),
    parkId,
    label: bindingId ? 'Exit music' : 'Cue',
    enabled: true,
    anchor: bindingId
      ? { type: 'show', bindingId, point: 'end' }
      : { type: 'parkClose', which: 'latest' },
    fromSec: 0,
    toSec: bindingId ? 240 : 600,
    conditions: [],
    priority: 0,
    action: { type: 'black', fadeSec: null },
    onEnd: 'release',
  };
}

export function CuesSection({
  parkId,
  bindings,
  prefillBindingId,
}: {
  parkId: string;
  bindings: ParkShowBinding[];
  prefillBindingId?: string | null;
}) {
  const { colors } = useTheme();
  const s = styles(colors);
  const cues = useAppStore((st) => st.cues);
  const setCues = useAppStore((st) => st.setCues);
  const saveToStorage = useAppStore((st) => st.saveToStorage);
  const presets = useAppStore((st) => st.presets);
  const zones = useAppStore((st) => st.zones);
  const tz = useAppStore((st) => st.parks.find((p) => p.id === parkId)?.timezone) || 'America/New_York';
  const [editing, setEditing] = useState<ShowCue | null>(null);

  const parkCues = cues.filter((c) => c.parkId === parkId);
  const schedule = getParkDaySchedule(parkDateString(Date.now(), tz));
  const party = schedule?.ticketed.find((t) => t.kind === 'event');

  const saveAll = (next: ShowCue[]) => {
    setCues(next);
    saveToStorage();
  };

  const openNew = (kind: 'exit' | 'close' | 'before' | 'show') => {
    const cue = blankCue(parkId, kind === 'show' ? prefillBindingId ?? bindings[0]?.id : undefined);
    if (kind === 'close') {
      cue.label = 'Kiss goodnight';
      cue.anchor = { type: 'parkClose', which: 'latest' };
      cue.toSec = 600;
    } else if (kind === 'before') {
      cue.label = 'Before show';
      cue.anchor = { type: 'show', bindingId: prefillBindingId ?? bindings[0]?.id ?? '', point: 'start' };
      cue.fromSec = -1800;
      cue.toSec = -1770;
    } else if (kind === 'exit') {
      cue.label = 'Exit music';
      cue.fromSec = 0;
      cue.toSec = 240;
    }
    setEditing(cue);
  };

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Cues</Text>
      <Text style={s.hint}>
        A cue is an anchor, a window, and a look. Existing pre/live/post still run when no cue is active.
      </Text>
      {party ? (
        <Text style={s.hint}>
          Tonight: Special Ticketed Event {new Date(party.openMs).toLocaleTimeString()}–{new Date(party.closeMs).toLocaleTimeString()}
        </Text>
      ) : null}
      {parkCues.length === 0 ? <Text style={s.hint}>No cues for this park.</Text> : null}
      {parkCues.map((cue) => {
        const anchor = cue.anchor;
        const action = cue.action;
        const bindingName = anchor.type === 'show'
          ? bindings.find((b) => b.id === anchor.bindingId)?.name
          : undefined;
        const preset = action.type === 'preset' ? presets.find((p) => p.id === action.presetId) : undefined;
        const zoneNames = cue.conditions.filter((c) => c.type === 'zone').flatMap((c) => c.type === 'zone' ? c.zoneIds : [])
          .map((id) => zones.find((z) => z.id === id)?.name ?? id);
        const warnings = cueWarnings(cue, {
          bindingIds: bindings.map((b) => b.id),
          zoneIds: zones.map((z) => z.id),
          presetIds: presets.map((p) => p.id),
        });
        const unresolved = (cue.anchor.type === 'parkClose' || cue.anchor.type === 'parkOpen') && !schedule;
        return (
          <TouchableOpacity key={cue.id} style={s.card} onPress={() => setEditing(cue)}>
            <Text style={s.line}>{describeCue(cue, { binding: bindingName, preset: preset?.name, zones: zoneNames })}</Text>
            {!cue.enabled ? <Text style={s.warn}>Disabled</Text> : null}
            {warnings.map((w) => <Text key={w} style={s.warn}>{w}</Text>)}
            {unresolved ? <Text style={s.warn}>No schedule for today</Text> : null}
          </TouchableOpacity>
        );
      })}
      <View style={s.row}>
        <TouchableOpacity style={s.chip} onPress={() => openNew('exit')}><Text style={s.chipText}>Exit music</Text></TouchableOpacity>
        <TouchableOpacity style={s.chip} onPress={() => openNew('close')}><Text style={s.chipText}>Park close</Text></TouchableOpacity>
        <TouchableOpacity style={s.chip} onPress={() => openNew('before')}><Text style={s.chipText}>Before show</Text></TouchableOpacity>
      </View>
      {editing ? (
        <CueEditor
          cue={editing}
          bindings={bindings}
          onClose={() => setEditing(null)}
          onSave={(cue) => {
            const next = cues.some((c) => c.id === cue.id)
              ? cues.map((c) => (c.id === cue.id ? cue : c))
              : [...cues, cue];
            saveAll(next);
            setEditing(null);
          }}
          onDelete={() => {
            saveAll(cues.filter((c) => c.id !== editing.id));
            setEditing(null);
          }}
        />
      ) : null}
    </View>
  );
}

function CueEditor({
  cue, bindings, onClose, onSave, onDelete,
}: {
  cue: ShowCue;
  bindings: ParkShowBinding[];
  onClose: () => void;
  onSave: (cue: ShowCue) => void;
  onDelete: () => void;
}) {
  const { colors } = useTheme();
  const s = styles(colors);
  const presets = useAppStore((st) => st.presets);
  const zones = useAppStore((st) => st.zones.filter((z) => z.parkId === cue.parkId || !z.parkId));
  const [draft, setDraft] = useState<ShowCue>(cue);
  const [offsetMin, setOffsetMin] = useState(String(Math.round(draft.fromSec / 60)));
  const [durMin, setDurMin] = useState(draft.toSec == null ? '' : String(Math.round((draft.toSec - draft.fromSec) / 60)));

  const commitTimes = (next: ShowCue): ShowCue => {
    const fromMin = Number(offsetMin);
    const fromSec = Number.isFinite(fromMin) ? Math.round(fromMin * 60) : next.fromSec;
    if (durMin.trim() === '') return { ...next, fromSec, toSec: null };
    const dur = Number(durMin);
    const toSec = Number.isFinite(dur) ? fromSec + Math.round(dur * 60) : next.toSec;
    return { ...next, fromSec, toSec };
  };

  const setAnchor = (anchor: CueAnchor) => setDraft({ ...draft, anchor });

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, gap: 8 }}>
        <Text style={s.sectionTitle}>Edit cue</Text>
        <Text style={s.hint}>Label</Text>
        <TextInput style={s.input} value={draft.label} onChangeText={(label) => setDraft({ ...draft, label })} />
        <Text style={s.hint}>When</Text>
        <View style={s.row}>
          {(['clock', 'parkClose', 'parkOpen', 'show'] as const).map((type) => (
            <TouchableOpacity key={type} style={s.chip} onPress={() => {
              if (type === 'clock') setAnchor({ type: 'clock', time: '21:30' });
              else if (type === 'parkClose') setAnchor({ type: 'parkClose', which: 'latest' });
              else if (type === 'parkOpen') setAnchor({ type: 'parkOpen', which: 'earliest' });
              else setAnchor({ type: 'show', bindingId: bindings[0]?.id ?? '', point: 'end' });
            }}>
              <Text style={s.chipText}>{type === 'parkClose' ? 'Park close' : type === 'parkOpen' ? 'Park open' : type === 'clock' ? 'Clock' : 'A show'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {draft.anchor.type === 'clock' ? (
          <TextInput
            style={s.input}
            value={draft.anchor.time}
            placeholder="HH:mm"
            onChangeText={(time) => setAnchor({ type: 'clock', time, days: draft.anchor.type === 'clock' ? draft.anchor.days : undefined })}
          />
        ) : null}
        {draft.anchor.type === 'show' ? (
          <View>
            {bindings.map((b) => (
              <TouchableOpacity key={b.id} onPress={() => setAnchor({ type: 'show', bindingId: b.id, point: draft.anchor.type === 'show' ? draft.anchor.point : 'end' })}>
                <Text style={s.line}>{draft.anchor.type === 'show' && draft.anchor.bindingId === b.id ? '● ' : '○ '}{b.name}</Text>
              </TouchableOpacity>
            ))}
            <View style={s.row}>
              {(['start', 'live', 'end'] as const).map((point) => (
                <TouchableOpacity key={point} style={s.chip} onPress={() => {
                  if (draft.anchor.type !== 'show') return;
                  setAnchor({ ...draft.anchor, point });
                }}>
                  <Text style={s.chipText}>{point}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}
        <Text style={s.hint}>Offset (minutes, negative = before)</Text>
        <TextInput style={s.input} keyboardType="numbers-and-punctuation" value={offsetMin} onChangeText={setOffsetMin} />
        <Text style={s.hint}>Duration (minutes, blank = until next cue)</Text>
        <TextInput style={s.input} keyboardType="numbers-and-punctuation" value={durMin} onChangeText={setDurMin} />
        <Text style={s.hint}>Action</Text>
        <TouchableOpacity style={s.chip} onPress={() => setDraft({ ...draft, action: { type: 'black', fadeSec: null } })}>
          <Text style={s.chipText}>{draft.action.type === 'black' ? '● Black' : 'Black'}</Text>
        </TouchableOpacity>
        {presets.map((p) => (
          <TouchableOpacity key={p.id} onPress={() => setDraft({ ...draft, action: { type: 'preset', presetId: p.id } })}>
            <Text style={s.line}>{draft.action.type === 'preset' && draft.action.presetId === p.id ? '● ' : '○ '}{p.name}</Text>
          </TouchableOpacity>
        ))}
        <Text style={s.hint}>Only if inside a zone (tap to toggle)</Text>
        {zones.map((z) => {
          const zoneCond = draft.conditions.find((c) => c.type === 'zone');
          const on = zoneCond?.type === 'zone' && zoneCond.zoneIds.includes(z.id);
          return (
            <TouchableOpacity key={z.id} onPress={() => {
              const ids = new Set(zoneCond?.type === 'zone' ? zoneCond.zoneIds : []);
              if (ids.has(z.id)) ids.delete(z.id); else ids.add(z.id);
              const rest = draft.conditions.filter((c) => c.type !== 'zone');
              const next = ids.size
                ? [...rest, { type: 'zone' as const, zoneIds: [...ids], match: 'inside' as const }]
                : rest;
              setDraft({ ...draft, conditions: next, priority: ids.size ? Math.max(draft.priority, 10) : draft.priority });
            }}>
              <Text style={s.line}>{on ? '● ' : '○ '}{z.name}</Text>
            </TouchableOpacity>
          );
        })}
        <View style={s.switchRow}>
          <Text style={s.line}>Release when done</Text>
          <Switch value={draft.onEnd === 'release'} onValueChange={(v) => setDraft({ ...draft, onEnd: v ? 'release' : 'hold' })} />
        </View>
        <View style={s.switchRow}>
          <Text style={s.line}>Enabled</Text>
          <Switch value={draft.enabled} onValueChange={(enabled) => setDraft({ ...draft, enabled })} />
        </View>
        <TouchableOpacity style={s.chip} onPress={() => {
          void testCueNow(commitTimes(draft)).then((ok) => {
            Alert.alert('Test cue', ok ? 'Sent' : 'Board not connected');
          });
        }}>
          <Text style={s.chipText}>Test now</Text>
        </TouchableOpacity>
        <View style={s.row}>
          <TouchableOpacity style={s.chip} onPress={() => onSave(commitTimes(draft))}><Text style={s.chipText}>Save</Text></TouchableOpacity>
          <TouchableOpacity style={s.chip} onPress={onDelete}><Text style={s.chipText}>Delete</Text></TouchableOpacity>
          <TouchableOpacity style={s.chip} onPress={onClose}><Text style={s.chipText}>Cancel</Text></TouchableOpacity>
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = (c: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  section: { marginBottom: 16 },
  sectionTitle: { color: c.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 8 },
  hint: { color: c.textMuted, fontSize: 12, marginBottom: 6 },
  card: { backgroundColor: c.surface, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: c.border },
  line: { color: c.textPrimary, fontSize: 13 },
  warn: { color: c.danger, fontSize: 11, marginTop: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  chipText: { color: c.textPrimary, fontSize: 12, fontWeight: '600' },
  input: {
    backgroundColor: c.surface, borderRadius: 8, borderWidth: 1, borderColor: c.border,
    color: c.textPrimary, padding: 8, fontSize: 14,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
});
