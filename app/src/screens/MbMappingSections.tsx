import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import {
  MbMappingConfig, MbEffectMapping, MbSegmentId, WledSegRef,
  MB_COLOR_NAMES, MB_SEGMENT_META, MB_ANIMATION_META, MB_PATTERN_META,
  DEFAULT_MB_MAPPING,
} from '../utils/mbConfig';
import { useAppStore } from '../stores/store';
import { bleService } from '../services/BLEService';
import { mbMappingToBlePayload } from '../utils/mbConfig';

type Colors = ReturnType<typeof import('../utils/theme').useTheme>['colors'];

export function MbMappingSections({ colors, isConnected }: { colors: Colors; isConnected: boolean }) {
  const { mbMapping, setMbMapping, presets, saveToStorage } = useAppStore();
  const [expanded, setExpanded] = useState<'colors' | 'anim' | 'pat' | 'seg' | null>('colors');

  const push = (next: MbMappingConfig) => {
    setMbMapping(next);
    if (isConnected) bleService.sendMbMappingConfig(mbMappingToBlePayload(next));
    saveToStorage();
  };

  const setColor = (idx: number, hex: string) => {
    const colorsArr = [...mbMapping.colors];
    colorsArr[idx] = hex.startsWith('#') ? hex : `#${hex}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(colorsArr[idx])) return;
    push({ ...mbMapping, colors: colorsArr });
  };

  const pickPreset = (title: string, current: string, onPick: (id: string) => void) => {
    Alert.alert(title, 'Empty = built-in segment colors', [
      { text: 'Built-in', onPress: () => onPick('') },
      ...presets.slice(0, 10).map(p => ({
        text: p.name,
        onPress: () => onPick(p.id),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const setEffect = (
    kind: 'animations' | 'patterns',
    key: string,
    patch: Partial<MbEffectMapping>,
  ) => {
    const block = { ...mbMapping[kind], [key]: { ...mbMapping[kind][key as keyof typeof mbMapping.animations], ...patch } };
    push({ ...mbMapping, [kind]: block as MbMappingConfig[typeof kind] });
  };

  const setSegRefs = (segId: MbSegmentId, refs: WledSegRef[]) => {
    push({ ...mbMapping, segments: { ...mbMapping.segments, [segId]: refs } });
  };

  const s = styles(colors);

  return (
    <>
      <SectionToggle title="MB → WLED Colors (32)" open={expanded === 'colors'}
        onPress={() => setExpanded(expanded === 'colors' ? null : 'colors')} colors={colors} />
      {expanded === 'colors' && MB_COLOR_NAMES.map((name, idx) => (
        <View key={idx} style={s.colorRow}>
          <View style={[s.swatch, { backgroundColor: mbMapping.colors[idx] }]} />
          <View style={{ flex: 1 }}>
            <Text style={s.label}>{idx} · {name}</Text>
          </View>
          <TextInput style={s.hexInput} value={mbMapping.colors[idx]}
            onChangeText={v => setColor(idx, v)} autoCapitalize="none" />
        </View>
      ))}

      <SectionToggle title="MB Animations → Preset" open={expanded === 'anim'}
        onPress={() => setExpanded(expanded === 'anim' ? null : 'anim')} colors={colors} />
      {expanded === 'anim' && MB_ANIMATION_META.map(({ key, label }) => {
        const m = mbMapping.animations[key];
        const presetName = m.presetId ? (presets.find(p => p.id === m.presetId)?.name ?? m.presetId) : 'Built-in';
        return (
          <View key={key} style={s.effectRow}>
            <Text style={s.label}>{label}</Text>
            <TouchableOpacity onPress={() => pickPreset(label, m.presetId, id => setEffect('animations', key, { presetId: id }))}>
              <Text style={s.link}>{presetName}</Text>
            </TouchableOpacity>
            <TextInput style={s.slotsInput} placeholder="color slots 0-31"
              value={m.colorSlots.join(',')}
              onChangeText={v => {
                const colorSlots = v.split(',').map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n) && n >= 0 && n <= 31);
                setEffect('animations', key, { colorSlots });
              }} />
          </View>
        );
      })}

      <SectionToggle title="MB Patterns (E909) → Preset" open={expanded === 'pat'}
        onPress={() => setExpanded(expanded === 'pat' ? null : 'pat')} colors={colors} />
      {expanded === 'pat' && MB_PATTERN_META.map(({ key, label }) => {
        const m = mbMapping.patterns[key];
        const presetName = m.presetId ? (presets.find(p => p.id === m.presetId)?.name ?? m.presetId) : 'Built-in';
        return (
          <View key={key} style={s.effectRow}>
            <Text style={s.label}>{key} — {label}</Text>
            <TouchableOpacity onPress={() => pickPreset(label, m.presetId, id => setEffect('patterns', key, { presetId: id }))}>
              <Text style={s.link}>{presetName}</Text>
            </TouchableOpacity>
            <TextInput style={s.slotsInput} placeholder="color slots"
              value={m.colorSlots.join(',')}
              onChangeText={v => {
                const colorSlots = v.split(',').map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n) && n >= 0 && n <= 31);
                setEffect('patterns', key, { colorSlots });
              }} />
          </View>
        );
      })}

      <SectionToggle title="MB Segments → WLED Segments" open={expanded === 'seg'}
        onPress={() => setExpanded(expanded === 'seg' ? null : 'seg')} colors={colors} />
      {expanded === 'seg' && MB_SEGMENT_META.map(({ id, label, hint }) => (
        <SegEditor key={id} label={label} hint={hint} refs={mbMapping.segments[id]}
          onChange={refs => setSegRefs(id, refs)} colors={colors} />
      ))}

      <TouchableOpacity style={s.resetBtn} onPress={() => push(JSON.parse(JSON.stringify(DEFAULT_MB_MAPPING)))}>
        <Text style={s.link}>Reset MB mapping to defaults</Text>
      </TouchableOpacity>
    </>
  );
}

function SectionToggle({ title, open, onPress, colors }: { title: string; open: boolean; onPress: () => void; colors: Colors }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text style={{ color: colors.textPrimary, fontWeight: '600', fontSize: 14 }}>{open ? '▼' : '▶'} {title}</Text>
    </TouchableOpacity>
  );
}

function SegEditor({ label, hint, refs, onChange, colors }: {
  label: string; hint: string; refs: WledSegRef[];
  onChange: (refs: WledSegRef[]) => void; colors: Colors;
}) {
  const input = {
    backgroundColor: colors.background, borderRadius: 6, borderWidth: 1, borderColor: colors.borderFocus,
    color: colors.textPrimary, padding: 6, fontSize: 12, width: 52, textAlign: 'right' as const,
  };
  const update = (i: number, field: keyof WledSegRef, val: string) => {
    const n = parseInt(val, 10);
    if (isNaN(n)) return;
    const next = refs.map((r, j) => j === i ? { ...r, [field]: n } : r);
    onChange(next);
  };
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: colors.textPrimary, fontWeight: '500', fontSize: 13 }}>{label}</Text>
      <Text style={{ color: colors.textMuted, fontSize: 11, marginBottom: 4 }}>{hint}</Text>
      {refs.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <Text style={{ color: colors.textMuted, fontSize: 11 }}>id</Text>
          <TextInput style={input} value={String(r.id)} keyboardType="number-pad"
            onChangeText={v => update(i, 'id', v)} />
          <Text style={{ color: colors.textMuted, fontSize: 11 }}>start</Text>
          <TextInput style={input} value={String(r.start)} keyboardType="number-pad"
            onChangeText={v => update(i, 'start', v)} />
          <Text style={{ color: colors.textMuted, fontSize: 11 }}>stop</Text>
          <TextInput style={input} value={String(r.stop)} keyboardType="number-pad"
            onChangeText={v => update(i, 'stop', v)} />
          {refs.length > 1 && (
            <TouchableOpacity onPress={() => onChange(refs.filter((_, j) => j !== i))}>
              <Text style={{ color: colors.danger, fontSize: 12 }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
      <TouchableOpacity onPress={() => onChange([...refs, { id: refs.length, start: 0, stop: 10 }])}>
        <Text style={{ color: colors.primary, fontSize: 12 }}>+ WLED segment</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = (c: Colors) => ({
  colorRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: c.border },
  swatch: { width: 28, height: 28, borderRadius: 6, borderWidth: 1, borderColor: c.border },
  label: { color: c.textPrimary, fontSize: 13 },
  hexInput: { backgroundColor: c.background, borderRadius: 6, borderWidth: 1, borderColor: c.borderFocus, color: c.textPrimary, padding: 6, fontSize: 11, width: 88, fontFamily: 'monospace' as const },
  effectRow: { marginBottom: 10, gap: 4 },
  link: { color: c.primary, fontSize: 13, fontWeight: '600' as const },
  slotsInput: { backgroundColor: c.background, borderRadius: 6, borderWidth: 1, borderColor: c.borderFocus, color: c.textPrimary, padding: 8, fontSize: 12 },
  resetBtn: { marginTop: 8, marginBottom: 8 },
});
