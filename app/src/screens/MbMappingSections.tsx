import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Alert, Modal, ScrollView, Pressable, Switch,
} from 'react-native';
import {
  MbMappingConfig, MbEffectMapping, MbEffectClassMapping,
  MB_COLOR_NAMES, MB_ANIMATION_META, MB_PATTERN_META,
  MB_EFFECT_CLASS_META, TIER2_OPCODE_OPTIONS, SW_ANIMATION_META, DEFAULT_MB_MAPPING,
  MB_PAL_OFF, MB_PAL_UNIQUE, MB_PAL_RANDOM,
  defaultRandomPaletteIndices, mbPaletteEligibleForRandom,
} from '../utils/mbConfig';
import type { MbEffectClassKey } from '../utils/mbConfig';
import { summarizeTier2FromSessions } from '../utils/tier2Packets';
import { useAppStore } from '../stores/store';
import { bleService } from '../services/BLEService';
import { mbMappingEssentialPayload } from '../utils/bleBoardSync';

type Colors = ReturnType<typeof import('../utils/theme').useTheme>['colors'];
type BleTab = 'sw' | 'mb' | 'colors';

const BLE_TABS: { id: BleTab; label: string }[] = [
  { id: 'sw', label: 'Starlight' },
  { id: 'mb', label: 'MB Effects' },
  { id: 'colors', label: 'MB Colors' },
];

export function PresetPickerModal({
  visible, title, presets, selectedId, onSelect, onClose, colors, emptyLabel = 'Use default preset',
  extraOptions,
}: {
  visible: boolean;
  title: string;
  presets: { id: string; name: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  colors: Colors;
  emptyLabel?: string;
  extraOptions?: { id: string; label: string }[];
}) {
  const [q, setQ] = useState('');
  const filtered = presets.filter(p =>
    p.name.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        onPress={onClose}>
        <Pressable style={{ backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70%' }}
          onPress={e => e.stopPropagation()}>
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 16 }}>{title}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>Same presets as GPS zones</Text>
            <TextInput
              style={{
                marginTop: 10, backgroundColor: colors.background, borderRadius: 8,
                borderWidth: 1, borderColor: colors.borderFocus, color: colors.textPrimary,
                padding: 10, fontSize: 14,
              }}
              placeholder="Search presets…"
              placeholderTextColor={colors.textMuted}
              value={q}
              onChangeText={setQ}
              autoCapitalize="none"
            />
          </View>
          <ScrollView style={{ paddingHorizontal: 8 }}>
            <TouchableOpacity
              style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}
              onPress={() => { onSelect(''); onClose(); }}>
              <Text style={{ color: !selectedId ? colors.primary : colors.textSecondary, fontWeight: !selectedId ? '600' : '400' }}>
                {emptyLabel}
              </Text>
            </TouchableOpacity>
            {(extraOptions ?? []).map(opt => (
              <TouchableOpacity key={opt.id}
                style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}
                onPress={() => { onSelect(opt.id); onClose(); }}>
                <Text style={{ color: selectedId === opt.id ? colors.primary : colors.textPrimary, fontWeight: selectedId === opt.id ? '600' : '400' }}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
            {filtered.map(p => (
              <TouchableOpacity key={p.id}
                style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}
                onPress={() => { onSelect(p.id); onClose(); }}>
                <Text style={{ color: selectedId === p.id ? colors.primary : colors.textPrimary, fontWeight: selectedId === p.id ? '600' : '400' }}>
                  {p.name}
                </Text>
              </TouchableOpacity>
            ))}
            {filtered.length === 0 && (
              <Text style={{ color: colors.textMuted, padding: 16, textAlign: 'center' }}>No presets — create some on the Presets tab</Text>
            )}
          </ScrollView>
          <TouchableOpacity onPress={onClose} style={{ padding: 16, alignItems: 'center' }}>
            <Text style={{ color: colors.textMuted }}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function EffectClassRow({
  label, description, badge, tier, mapping, presets, onChange, colors, showColorToggle,
}: {
  label: string;
  description: string;
  badge: string;
  tier: 1 | 2;
  mapping: MbEffectClassMapping;
  presets: { id: string; name: string }[];
  onChange: (m: MbEffectClassMapping) => void;
  colors: Colors;
  showColorToggle: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const presetName = mapping.presetId
    ? (presets.find(p => p.id === mapping.presetId)?.name ?? mapping.presetId)
    : 'Default preset';
  const badgeColor = tier === 1
    ? (badge.includes('Partial') ? colors.warning ?? '#cc8800' : colors.success ?? '#22aa44')
    : colors.textMuted;

  return (
    <View style={{
      marginBottom: 10, padding: 12, backgroundColor: colors.background,
      borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 14, flex: 1 }}>{label}</Text>
        <Text style={{ color: badgeColor, fontSize: 10, fontWeight: '600', marginLeft: 8 }}>{badge}</Text>
      </View>
      <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4, lineHeight: 16 }}>{description}</Text>
      <TouchableOpacity onPress={() => setPickerOpen(true)} style={{ marginTop: 10 }}>
        <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>{presetName} ›</Text>
      </TouchableOpacity>
      {showColorToggle && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 }}>
          <Switch
            value={mapping.useMbColors}
            onValueChange={v => onChange({ ...mapping, useMbColors: v })}
            trackColor={{ false: colors.border, true: colors.primary }}
          />
          <Text style={{ color: colors.textSecondary, fontSize: 12, flex: 1 }}>
            {mapping.useMbColors ? 'Use MagicBand+ colors' : "Always use preset's own colors"}
          </Text>
        </View>
      )}
      <PresetPickerModal
        visible={pickerOpen}
        title={label}
        presets={presets}
        selectedId={mapping.presetId}
        onSelect={id => onChange({ ...mapping, presetId: id })}
        onClose={() => setPickerOpen(false)}
        colors={colors}
      />
    </View>
  );
}

function EffectRow({
  label, hint, mapping, presets, onChange, colors,
}: {
  label: string;
  hint?: string;
  mapping: MbEffectMapping;
  presets: { id: string; name: string }[];
  onChange: (m: MbEffectMapping) => void;
  colors: Colors;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showSlots, setShowSlots] = useState(false);
  const presetName = mapping.presetId
    ? (presets.find(p => p.id === mapping.presetId)?.name ?? mapping.presetId)
    : 'Default preset';

  return (
    <View style={{
      marginBottom: 8, padding: 10, backgroundColor: colors.background,
      borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    }}>
      <Text style={{ color: colors.textPrimary, fontWeight: '600', fontSize: 13 }}>{label}</Text>
      {hint ? <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>{hint}</Text> : null}
      <TouchableOpacity onPress={() => setPickerOpen(true)} style={{ marginTop: 8 }}>
        <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>{presetName} ›</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setShowSlots(v => !v)}>
        <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 6 }}>
          {showSlots ? '▾ Hide color overrides' : '▸ Optional MB color overrides'}
        </Text>
      </TouchableOpacity>
      {showSlots && (
        <TextInput
          style={{
            marginTop: 4, backgroundColor: colors.background, borderRadius: 6,
            borderWidth: 1, borderColor: colors.borderFocus, color: colors.textPrimary,
            padding: 8, fontSize: 12, fontFamily: 'monospace',
          }}
          placeholder="palette indices 0–31"
          placeholderTextColor={colors.textMuted}
          value={mapping.colorSlots.join(',')}
          onChangeText={v => {
            const colorSlots = v.split(',').map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n) && n >= 0 && n <= 31);
            onChange({ ...mapping, colorSlots });
          }}
        />
      )}
      <PresetPickerModal
        visible={pickerOpen}
        title={label}
        presets={presets}
        selectedId={mapping.presetId}
        onSelect={id => onChange({ ...mapping, presetId: id })}
        onClose={() => setPickerOpen(false)}
        colors={colors}
      />
    </View>
  );
}

function RandomPoolEditor({
  randomPool, paletteColors, themeColors, onChange,
}: {
  randomPool: MbMappingConfig['randomPool'];
  paletteColors: string[];
  themeColors: Colors;
  onChange: (pool: MbMappingConfig['randomPool']) => void;
}) {
  const poolSet = new Set(randomPool.paletteIndices);
  const selectable = Array.from({ length: MB_PAL_RANDOM }, (_, i) => i).filter(mbPaletteEligibleForRandom);

  const togglePalette = (idx: number) => {
    const next = new Set(poolSet);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    onChange({ ...randomPool, paletteIndices: [...next].sort((a, b) => a - b) });
  };

  const setCustom = (id: string, patch: Partial<{ name: string; hex: string }>) => {
    onChange({
      ...randomPool,
      custom: randomPool.custom.map(c => c.id === id ? { ...c, ...patch } : c),
    });
  };

  const removeCustom = (id: string) => {
    onChange({ ...randomPool, custom: randomPool.custom.filter(c => c.id !== id) });
  };

  const addCustom = () => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    onChange({
      ...randomPool,
      custom: [...randomPool.custom, { id, name: 'Custom', hex: '#ff6600' }],
    });
  };

  const resetPool = () => {
    onChange({ paletteIndices: defaultRandomPaletteIndices(), custom: [] });
  };

  const chipStyle = (on: boolean) => ({
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, marginRight: 6, marginBottom: 6,
    borderWidth: 1,
    borderColor: on ? themeColors.primary : themeColors.border,
    backgroundColor: on ? themeColors.primary + '22' : themeColors.background,
  });

  return (
    <View style={{
      marginBottom: 16, padding: 12, borderRadius: 8,
      borderWidth: 1, borderColor: themeColors.border, backgroundColor: themeColors.surfaceAlt,
    }}>
      <Text style={{ color: themeColors.textPrimary, fontWeight: '700', fontSize: 14 }}>
        Random pool (palette {MB_PAL_RANDOM})
      </Text>
      <Text style={{ color: themeColors.textMuted, fontSize: 11, marginTop: 4, marginBottom: 10, lineHeight: 16 }}>
        When the band sends “random”, the board picks uniformly from enabled palettes and custom colors below.
        Off ({MB_PAL_OFF}) and unique ({MB_PAL_UNIQUE}) are always excluded.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {selectable.map(idx => {
          const on = poolSet.has(idx);
          return (
            <TouchableOpacity key={idx} onPress={() => togglePalette(idx)} style={chipStyle(on)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{
                  width: 14, height: 14, borderRadius: 3,
                  backgroundColor: paletteColors[idx] ?? '#888',
                  borderWidth: 1, borderColor: themeColors.border,
                }} />
                <Text style={{ color: on ? themeColors.primary : themeColors.textSecondary, fontSize: 11, fontWeight: on ? '600' : '400' }}>
                  {idx}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={{ color: themeColors.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 12, marginBottom: 6 }}>
        Custom random-only colors
      </Text>
      {randomPool.custom.length === 0 ? (
        <Text style={{ color: themeColors.textMuted, fontSize: 11, marginBottom: 8 }}>None — add colors not tied to an MB palette slot.</Text>
      ) : randomPool.custom.map(c => (
        <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <View style={[styles(themeColors).swatch, { backgroundColor: c.hex }]} />
          <TextInput
            style={{ flex: 1, ...styles(themeColors).hexInput, width: undefined }}
            value={c.name}
            onChangeText={name => setCustom(c.id, { name })}
            placeholder="Name"
            placeholderTextColor={themeColors.textMuted}
          />
          <TextInput
            style={styles(themeColors).hexInput}
            value={c.hex}
            onChangeText={hex => {
              const h = hex.startsWith('#') ? hex : `#${hex}`;
              if (/^#[0-9a-fA-F]{6}$/.test(h)) setCustom(c.id, { hex: h });
            }}
            autoCapitalize="none"
          />
          <TouchableOpacity onPress={() => removeCustom(c.id)}>
            <Text style={{ color: themeColors.danger, fontSize: 18, fontWeight: '700' }}>×</Text>
          </TouchableOpacity>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
        <TouchableOpacity onPress={addCustom}>
          <Text style={{ color: themeColors.primary, fontWeight: '600', fontSize: 13 }}>+ Add custom</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={resetPool}>
          <Text style={{ color: themeColors.textMuted, fontSize: 13 }}>Reset pool</Text>
        </TouchableOpacity>
      </View>
      {randomPool.paletteIndices.length === 0 && randomPool.custom.length === 0 && (
        <Text style={{ color: themeColors.danger, fontSize: 11, marginTop: 8 }}>
          Pool is empty — random will fall back to defaults on the board.
        </Text>
      )}
    </View>
  );
}

export function MbMappingSections({ colors, isConnected }: { colors: Colors; isConnected: boolean }) {
  const {
    mbMapping, setMbMapping, presets, saveToStorage, customSegmentLayouts, recallState,
    bleCaptureSessions, bleCaptureBuffer, bleCaptureActive,
  } = useAppStore();
  const [tab, setTab] = useState<BleTab>('sw');
  const [defaultPickerOpen, setDefaultPickerOpen] = useState(false);
  const [showLegacyMb, setShowLegacyMb] = useState(false);
  const [showTier2Review, setShowTier2Review] = useState(true);
  const [opcodePickerKey, setOpcodePickerKey] = useState<string | null>(null);

  const mappingBlePayload = (config: MbMappingConfig) =>
    mbMappingEssentialPayload(config, presets, recallState, customSegmentLayouts);

  const push = (next: MbMappingConfig) => {
    setMbMapping(next);
    if (isConnected) bleService.sendMbMappingConfig(mappingBlePayload(next));
    saveToStorage();
  };

  const setColor = (idx: number, hex: string) => {
    const colorsArr = [...mbMapping.colors];
    colorsArr[idx] = hex.startsWith('#') ? hex : `#${hex}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(colorsArr[idx])) return;
    push({ ...mbMapping, colors: colorsArr });
  };

  const setEffect = (
    kind: 'animations' | 'patterns' | 'swAnimations',
    key: string,
    patch: Partial<MbEffectMapping>,
  ) => {
    const block = { ...mbMapping[kind], [key]: { ...mbMapping[kind][key as keyof typeof mbMapping.animations], ...patch } };
    push({ ...mbMapping, [kind]: block as MbMappingConfig[typeof kind] });
  };

  const setEffectClass = (key: MbEffectClassKey, patch: Partial<MbEffectClassMapping>) => {
    const ec = mbMapping.effectClasses!;
    push({
      ...mbMapping,
      effectClasses: { ...ec, [key]: { ...ec[key], ...patch } },
    });
  };

  const setUnclassifiedOpcode = (opcode: string, patch: Partial<MbEffectClassMapping>) => {
    const ec = mbMapping.effectClasses!;
    const prev = ec.unclassifiedOpcodes[opcode] ?? { presetId: '', useMbColors: false };
    push({
      ...mbMapping,
      effectClasses: {
        ...ec,
        unclassifiedOpcodes: { ...ec.unclassifiedOpcodes, [opcode]: { ...prev, ...patch } },
      },
    });
  };

  const tier2Summaries = summarizeTier2FromSessions(
    bleCaptureActive
      ? [{ id: 'live', name: 'Live', startedAt: 0, endedAt: 0, durationSec: 0,
          packets: bleCaptureBuffer.map(p => ({ ...p, receivedAt: p.receivedAt ?? Date.now() })) },
        ...bleCaptureSessions]
      : bleCaptureSessions,
  );

  const s = styles(colors);
  const defaultName = mbMapping.defaultPresetId
    ? (presets.find(p => p.id === mbMapping.defaultPresetId)?.name ?? mbMapping.defaultPresetId)
    : '— none —';

  return (
    <>
          <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 10, lineHeight: 18 }}>
            Wand and MB effects use the same presets as GPS zones. Rules and segment maps are authored in the web tool and pushed with Board sync / connect.
          </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        {BLE_TABS.map(t => (
          <TouchableOpacity key={t.id} onPress={() => setTab(t.id)}
            style={{
              paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, marginRight: 6,
              backgroundColor: tab === t.id ? colors.primary + '22' : colors.background,
              borderWidth: 1, borderColor: tab === t.id ? colors.primary : colors.border,
            }}>
            <Text style={{ color: tab === t.id ? colors.primary : colors.textSecondary, fontWeight: '600', fontSize: 13 }}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {(tab === 'sw' || tab === 'mb') && (
        <View style={{
          marginBottom: 12, padding: 12, borderRadius: 8,
          backgroundColor: colors.primary + '18', borderWidth: 1, borderColor: colors.primary,
        }}>
          <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>Default zone preset</Text>
          <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4, marginBottom: 8 }}>
            Used when an effect has no preset assigned
          </Text>
          <TouchableOpacity onPress={() => setDefaultPickerOpen(true)}>
            <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 14 }}>{defaultName} ›</Text>
          </TouchableOpacity>
          <PresetPickerModal
            visible={defaultPickerOpen}
            title="Default zone preset"
            presets={presets}
            selectedId={mbMapping.defaultPresetId}
            onSelect={id => push({ ...mbMapping, defaultPresetId: id })}
            onClose={() => setDefaultPickerOpen(false)}
            colors={colors}
          />
        </View>
      )}

      {tab === 'sw' && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {SW_ANIMATION_META.map(({ key, label, hint }) => (
            <View key={key} style={{ width: '48%' }}>
              <EffectRow label={label} hint={hint}
                mapping={mbMapping.swAnimations[key]}
                presets={presets}
                onChange={m => setEffect('swAnimations', key, m)}
                colors={colors} />
            </View>
          ))}
        </View>
      )}

      {tab === 'mb' && (
        <>
          <Text style={{ color: colors.textSecondary, fontWeight: '600', fontSize: 12, marginBottom: 8, textTransform: 'uppercase' }}>
            MagicBand+ Effect Mapping
          </Text>
          {MB_EFFECT_CLASS_META.map(({ key, label, description, badge, tier }) => (
            <EffectClassRow
              key={key}
              label={label}
              description={description}
              badge={badge}
              tier={tier}
              mapping={mbMapping.effectClasses![key]}
              presets={presets}
              onChange={m => setEffectClass(key, m)}
              colors={colors}
              showColorToggle={tier === 1}
            />
          ))}

          <Text style={{ color: colors.textSecondary, fontWeight: '600', fontSize: 12, marginTop: 8, marginBottom: 6, textTransform: 'uppercase' }}>
            Per-opcode overrides (Tier 2)
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 11, marginBottom: 8, lineHeight: 16 }}>
            Narrow unclassified mapping to a specific opcode when you want a different preset than the catch-all above.
          </Text>
          {TIER2_OPCODE_OPTIONS.map(opcode => {
            const mapping = mbMapping.effectClasses!.unclassifiedOpcodes[opcode]
              ?? { presetId: '', useMbColors: false };
            const presetName = mapping.presetId
              ? (presets.find(p => p.id === mapping.presetId)?.name ?? mapping.presetId)
              : '—';
            return (
              <View key={opcode} style={{
                flexDirection: 'row', alignItems: 'center', marginBottom: 6, paddingVertical: 6,
                borderBottomWidth: 1, borderBottomColor: colors.border,
              }}>
                <Text style={{ color: colors.textPrimary, fontWeight: '600', fontSize: 13, width: 56 }}>{opcode}</Text>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => setOpcodePickerKey(opcode)}>
                  <Text style={{ color: mapping.presetId ? colors.primary : colors.textMuted, fontSize: 13 }}>
                    {presetName} ›
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
          <PresetPickerModal
            visible={opcodePickerKey !== null}
            title={opcodePickerKey ? `${opcodePickerKey} preset` : 'Opcode preset'}
            presets={presets}
            selectedId={opcodePickerKey ? (mbMapping.effectClasses!.unclassifiedOpcodes[opcodePickerKey]?.presetId ?? '') : ''}
            onSelect={id => {
              if (opcodePickerKey) setUnclassifiedOpcode(opcodePickerKey, { presetId: id });
              setOpcodePickerKey(null);
            }}
            onClose={() => setOpcodePickerKey(null)}
            colors={colors}
            emptyLabel="Use unclassified default"
          />

          <TouchableOpacity onPress={() => setShowTier2Review(v => !v)} style={{ marginTop: 12 }}>
            <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '600' }}>
              {showTier2Review ? '▾' : '▸'} Recent unclassified packets ({tier2Summaries.length})
            </Text>
          </TouchableOpacity>
          {showTier2Review && (
            <View style={{ marginTop: 8, marginBottom: 8 }}>
              {tier2Summaries.length === 0 ? (
                <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                  No Tier 2 packets in capture sessions yet — record a parade on the Capture tab.
                </Text>
              ) : tier2Summaries.map(row => (
                <View key={row.signature} style={{
                  padding: 8, marginBottom: 6, borderRadius: 6,
                  backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
                }}>
                  <Text style={{ color: colors.textPrimary, fontWeight: '600', fontSize: 12 }}>
                    {row.opcode} · ×{row.count}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 2 }} numberOfLines={1}>
                    {row.hex}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 2 }}>{row.reason}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 10 }}>
                    Last: {new Date(row.lastSeen).toLocaleString()}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity onPress={() => setShowLegacyMb(v => !v)} style={{ marginTop: 8 }}>
            <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '600' }}>
              {showLegacyMb ? '▾' : '▸'} Legacy per-opcode mapping (advanced)
            </Text>
          </TouchableOpacity>
          {showLegacyMb && (
            <>
              {MB_ANIMATION_META.filter(a => a.key !== 'wand').map(({ key, label }) => (
                <EffectRow key={key} label={label}
                  mapping={mbMapping.animations[key]}
                  presets={presets}
                  onChange={m => setEffect('animations', key, m)}
                  colors={colors} />
              ))}
              {MB_PATTERN_META.map(({ key, label }) => (
                <EffectRow key={`pat-${key}`} label={`${key} — ${label}`}
                  mapping={mbMapping.patterns[key]}
                  presets={presets}
                  onChange={m => setEffect('patterns', key, m)}
                  colors={colors} />
              ))}
            </>
          )}
        </>
      )}

      {tab === 'colors' && (
        <>
          <RandomPoolEditor
            randomPool={mbMapping.randomPool}
            paletteColors={mbMapping.colors}
            themeColors={colors}
            onChange={randomPool => push({ ...mbMapping, randomPool })}
          />
          {MB_COLOR_NAMES.map((name, idx) => (
            <View key={idx} style={s.colorRow}>
              <View style={[s.swatch, { backgroundColor: mbMapping.colors[idx] }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{idx} · {name}</Text>
                {idx === MB_PAL_RANDOM && (
                  <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 2 }}>
                    Resolved at runtime from random pool above
                  </Text>
                )}
              </View>
              {idx === MB_PAL_RANDOM ? (
                <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'monospace' }}>—</Text>
              ) : (
                <TextInput style={s.hexInput} value={mbMapping.colors[idx]}
                  onChangeText={v => setColor(idx, v)} autoCapitalize="none" />
              )}
            </View>
          ))}
        </>
      )}

      <TouchableOpacity style={s.resetBtn} onPress={() => push(JSON.parse(JSON.stringify(DEFAULT_MB_MAPPING)))}>
        <Text style={s.link}>Reset BLE mapping to defaults</Text>
      </TouchableOpacity>
    </>
  );
}

const styles = (c: Colors) => ({
  colorRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: c.border },
  swatch: { width: 28, height: 28, borderRadius: 6, borderWidth: 1, borderColor: c.border },
  label: { color: c.textPrimary, fontSize: 13 },
  hexInput: { backgroundColor: c.background, borderRadius: 6, borderWidth: 1, borderColor: c.borderFocus, color: c.textPrimary, padding: 6, fontSize: 11, width: 88, fontFamily: 'monospace' as const },
  link: { color: c.primary, fontSize: 13, fontWeight: '600' as const },
  resetBtn: { marginTop: 16, marginBottom: 8 },
});
