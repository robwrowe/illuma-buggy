import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Alert, Modal, ScrollView, Pressable,
} from 'react-native';
import {
  MbMappingConfig, MbEffectMapping, MbSegmentId, WledSegRef,
  MB_COLOR_NAMES, MB_SEGMENT_META, MB_ANIMATION_META, MB_PATTERN_META,
  SW_ANIMATION_META, DEFAULT_MB_MAPPING,
  MB_PAL_OFF, MB_PAL_UNIQUE, MB_PAL_RANDOM,
  defaultRandomPaletteIndices, mbPaletteEligibleForRandom,
} from '../utils/mbConfig';
import { useAppStore } from '../stores/store';
import { bleService } from '../services/BLEService';
import { mbMappingToBlePayload } from '../utils/mbConfig';
import {
  buildSegmentHighlightPreview, buildFiveCornerPreview,
  MB_SEGMENT_SIM_COMMAND, SIM_FIVE_CORNERS,
  findMbSegIdConflicts, centerMatchesRegion,
} from '../utils/mbSegmentPreview';
import {
  formatWledSegLabel, formatWledSegSelectionSummary, toggleSnapshotSelection,
  pruneRefsToSnapshot, defaultNewSegRef, updateRefAt, removeRefAt, appendSegRef,
  parseSegRefFields, isValidSegRef,
} from '../utils/mbSegmentAssign';
import {
  buildPresetLayoutPayload, fetchWledSegmentsFromDevice, WledSegmentDef,
} from '../utils/segmentLayouts';

type Colors = ReturnType<typeof import('../utils/theme').useTheme>['colors'];
type BleTab = 'sw' | 'mb' | 'colors' | 'segments';

const BLE_TABS: { id: BleTab; label: string }[] = [
  { id: 'sw', label: 'Starlight' },
  { id: 'mb', label: 'MagicBand' },
  { id: 'colors', label: 'MB Colors' },
  { id: 'segments', label: 'Segments' },
];

export function PresetPickerModal({
  visible, title, presets, selectedId, onSelect, onClose, colors, emptyLabel = 'Use default preset',
}: {
  visible: boolean;
  title: string;
  presets: { id: string; name: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  colors: Colors;
  emptyLabel?: string;
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
  const { mbMapping, setMbMapping, presets, saveToStorage, customSegmentLayouts } = useAppStore();
  const [tab, setTab] = useState<BleTab>('sw');
  const [defaultPickerOpen, setDefaultPickerOpen] = useState(false);
  const [segSnapshots, setSegSnapshots] = useState<Partial<Record<MbSegmentId, WledSegmentDef[]>>>({});
  const [segCaptureId, setSegCaptureId] = useState<MbSegmentId | null>(null);
  const [segSnapshotErr, setSegSnapshotErr] = useState('');

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

  const setEffect = (
    kind: 'animations' | 'patterns' | 'swAnimations',
    key: string,
    patch: Partial<MbEffectMapping>,
  ) => {
    const block = { ...mbMapping[kind], [key]: { ...mbMapping[kind][key as keyof typeof mbMapping.animations], ...patch } };
    push({ ...mbMapping, [kind]: block as MbMappingConfig[typeof kind] });
  };

  const setSegRefs = (segId: MbSegmentId, refs: WledSegRef[]) => {
    push({ ...mbMapping, segments: { ...mbMapping.segments, [segId]: refs } });
  };

  const previewSegment = (segId: MbSegmentId) => {
    if (!isConnected) {
      Alert.alert('Not connected', 'Connect to IllumaBuggy to preview on the strip.');
      return;
    }
    bleService.sendWledRaw(buildSegmentHighlightPreview(mbMapping.segments, segId));
  };

  const previewFiveCorners = () => {
    if (!isConnected) {
      Alert.alert('Not connected', 'Connect to IllumaBuggy to preview on the strip.');
      return;
    }
    bleService.sendWledRaw(buildFiveCornerPreview(mbMapping.segments));
  };

  const applyDefaultLayout = () => {
    if (!isConnected) {
      Alert.alert('Not connected', 'Connect to IllumaBuggy to apply a preset layout.');
      return;
    }
    const preset = presets.find(p => p.id === mbMapping.defaultPresetId);
    if (!preset) {
      Alert.alert('No default preset', 'Set a default zone preset on the Starlight or MagicBand tab first.');
      return;
    }
    const payload = buildPresetLayoutPayload(preset, customSegmentLayouts);
    if (!payload) {
      Alert.alert('No segment layout', 'Link a segment layout to that preset (Palettes tab) or save segments in the preset.');
      return;
    }
    bleService.sendWledRaw(payload);
  };

  const captureSegSnapshot = async (segId: MbSegmentId) => {
    if (!isConnected) {
      Alert.alert('Not connected', 'Connect to IllumaBuggy to read WLED segments from the board.');
      return;
    }
    setSegCaptureId(segId);
    setSegSnapshotErr('');
    try {
      const segments = await fetchWledSegmentsFromDevice();
      if (!segments.length) throw new Error('No active segments in WLED state');
      setSegSnapshots(prev => ({ ...prev, [segId]: segments }));
      const pruned = pruneRefsToSnapshot(segments, mbMapping.segments[segId]);
      if (pruned.length !== mbMapping.segments[segId].length
        || pruned.some((r, i) => r.id !== mbMapping.segments[segId][i]?.id)) {
        setSegRefs(segId, pruned);
      }
    } catch (e) {
      setSegSnapshotErr(e instanceof Error ? e.message : 'Could not read WLED segments');
    } finally {
      setSegCaptureId(null);
    }
  };

  const s = styles(colors);
  const defaultName = mbMapping.defaultPresetId
    ? (presets.find(p => p.id === mbMapping.defaultPresetId)?.name ?? mbMapping.defaultPresetId)
    : 'Not set';
  const segIdConflicts = findMbSegIdConflicts(mbMapping.segments);
  const centerDupInner = centerMatchesRegion(mbMapping.segments, 'inner');

  return (
    <>
      <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 10, lineHeight: 18 }}>
        Wand and MB effects use the same presets as GPS zones. Sync presets to the board on connect.
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
            Animations
          </Text>
          {MB_ANIMATION_META.filter(a => a.key !== 'wand').map(({ key, label }) => (
            <EffectRow key={key} label={label}
              mapping={mbMapping.animations[key]}
              presets={presets}
              onChange={m => setEffect('animations', key, m)}
              colors={colors} />
          ))}
          <Text style={{ color: colors.textSecondary, fontWeight: '600', fontSize: 12, marginTop: 12, marginBottom: 8, textTransform: 'uppercase' }}>
            Patterns (E909)
          </Text>
          {MB_PATTERN_META.map(({ key, label }) => (
            <EffectRow key={key} label={`${key} — ${label}`}
              mapping={mbMapping.patterns[key]}
              presets={presets}
              onChange={m => setEffect('patterns', key, m)}
              colors={colors} />
          ))}
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

      {tab === 'segments' && (
        <>
          <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 8, lineHeight: 18 }}>
            Per region: assign WLED segments manually (id + start/stop %) or Capture from the strip and tick segments to add.
          </Text>
          <TouchableOpacity
            onPress={applyDefaultLayout}
            disabled={!isConnected}
            style={{
              alignSelf: 'flex-start', marginBottom: 10, paddingHorizontal: 14, paddingVertical: 8,
              borderRadius: 8, backgroundColor: isConnected ? colors.surface : colors.border,
              borderWidth: 1, borderColor: colors.border,
            }}>
            <Text style={{ color: isConnected ? colors.textPrimary : colors.textMuted, fontWeight: '600', fontSize: 13 }}>
              Apply default preset layout
            </Text>
          </TouchableOpacity>
          {segSnapshotErr ? (
            <Text style={{ color: colors.danger, fontSize: 12, marginBottom: 8 }}>{segSnapshotErr}</Text>
          ) : null}
          {(segIdConflicts.length > 0 || centerDupInner) && (
            <View style={{
              marginBottom: 10, padding: 10, borderRadius: 8,
              backgroundColor: colors.danger + '18', borderWidth: 1, borderColor: colors.danger,
            }}>
              <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12, marginBottom: 4 }}>
                Segment id conflict
              </Text>
              {centerDupInner && (
                <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginBottom: 4 }}>
                  Center uses the same segment ids as Inner — for E909 center, map the band center LED to its own WLED segment (often a single small range), not the inner ring.
                </Text>
              )}
              {segIdConflicts.map(c => (
                <Text key={c.id} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginBottom: 2 }}>
                  Seg #{c.id} has different ranges ({c.ranges.join(' vs ')}) in {c.regions.join(', ')} — WLED only keeps one range per id.
                </Text>
              ))}
            </View>
          )}
          {MB_SEGMENT_META.map(({ id, label, hint }) => (
            <MbSegmentAssignEditor
              key={id}
              label={label}
              hint={hint}
              simCommand={MB_SEGMENT_SIM_COMMAND[id]}
              snapshot={segSnapshots[id] ?? []}
              captureLoading={segCaptureId === id}
              onCapture={() => captureSegSnapshot(id)}
              canCapture={isConnected}
              refs={mbMapping.segments[id]}
              onChange={refs => setSegRefs(id, refs)}
              onTest={() => previewSegment(id)}
              canTest={isConnected}
              colors={colors}
            />
          ))}
          <View style={s.previewAllRow}>
            <TouchableOpacity style={[s.testBtn, !isConnected && s.testBtnDisabled]}
              onPress={previewFiveCorners} disabled={!isConnected}>
              <Text style={s.testBtnText}>Preview 5 corners</Text>
            </TouchableOpacity>
            <Text style={s.simHint}>WandSim: {SIM_FIVE_CORNERS}</Text>
          </View>
        </>
      )}

      <TouchableOpacity style={s.resetBtn} onPress={() => push(JSON.parse(JSON.stringify(DEFAULT_MB_MAPPING)))}>
        <Text style={s.link}>Reset BLE mapping to defaults</Text>
      </TouchableOpacity>
    </>
  );
}

function MbSegmentAssignEditor({
  label, hint, simCommand, snapshot, captureLoading, onCapture, canCapture,
  refs, onChange, onTest, canTest, colors,
}: {
  label: string;
  hint: string;
  simCommand: string;
  snapshot: WledSegmentDef[];
  captureLoading: boolean;
  onCapture: () => void;
  canCapture: boolean;
  refs: WledSegRef[];
  onChange: (refs: WledSegRef[]) => void;
  onTest: () => void;
  canTest: boolean;
  colors: Colors;
}) {
  const summary = formatWledSegSelectionSummary(refs);
  const hasSnapshot = snapshot.length > 0;
  const inputStyle = {
    backgroundColor: colors.background, borderRadius: 6, borderWidth: 1,
    borderColor: colors.borderFocus, color: colors.textPrimary,
    padding: 6, fontSize: 12, fontFamily: 'monospace' as const, textAlign: 'center' as const,
  };

  const patchRef = (index: number, field: keyof WledSegRef, raw: string) => {
    const cur = refs[index];
    if (!cur) return;
    const idStr = field === 'id' ? raw : String(cur.id);
    const startStr = field === 'start' ? raw : String(cur.start);
    const stopStr = field === 'stop' ? raw : String(cur.stop);
    const parsed = parseSegRefFields(idStr, startStr, stopStr);
    if (parsed) onChange(updateRefAt(refs, index, parsed));
    else onChange(updateRefAt(refs, index, {
      id: field === 'id' ? parseInt(raw, 10) || 0 : cur.id,
      start: field === 'start' ? parseInt(raw, 10) || 0 : cur.start,
      stop: field === 'stop' ? parseInt(raw, 10) || 0 : cur.stop,
    }));
  };

  return (
    <View style={{
      marginBottom: 12, padding: 10, borderRadius: 8,
      borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.textPrimary, fontWeight: '600', fontSize: 13 }}>{label}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>{hint}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 2, fontFamily: 'monospace' }}>WandSim: {simCommand}</Text>
          <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '600', marginTop: 6, fontFamily: 'monospace' }}>
            → {summary}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TouchableOpacity onPress={onCapture} disabled={!canCapture || captureLoading}
            style={{
              backgroundColor: canCapture ? colors.surface : colors.border,
              borderWidth: 1, borderColor: colors.borderFocus,
              borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4,
              opacity: captureLoading ? 0.6 : 1,
            }}>
            <Text style={{ color: colors.textPrimary, fontSize: 12, fontWeight: '600' }}>
              {captureLoading ? '…' : hasSnapshot ? '↻' : 'Capture'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onTest} disabled={!canTest}
            style={{ backgroundColor: canTest ? colors.primary : colors.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>Test</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', marginBottom: 6 }}>Assigned segments</Text>
      {refs.length === 0 ? (
        <Text style={{ color: colors.textMuted, fontSize: 11, marginBottom: 8 }}>No segments — add manually or capture from WLED.</Text>
      ) : refs.map((ref, index) => (
        <View key={`${ref.id}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Text style={{ color: colors.textMuted, fontSize: 10, width: 22 }}>id</Text>
          <TextInput style={[inputStyle, { width: 36 }]} value={String(ref.id)} keyboardType="number-pad"
            onChangeText={v => patchRef(index, 'id', v)} />
          <Text style={{ color: colors.textMuted, fontSize: 10 }}>start</Text>
          <TextInput style={[inputStyle, { width: 44 }]} value={String(ref.start)} keyboardType="number-pad"
            onChangeText={v => patchRef(index, 'start', v)} />
          <Text style={{ color: colors.textMuted, fontSize: 10 }}>stop</Text>
          <TextInput style={[inputStyle, { width: 44 }]} value={String(ref.stop)} keyboardType="number-pad"
            onChangeText={v => patchRef(index, 'stop', v)} />
          {!isValidSegRef(ref) ? (
            <Text style={{ color: colors.danger, fontSize: 10, flex: 1 }}>invalid</Text>
          ) : (
            <Text style={{ color: colors.textMuted, fontSize: 10, flex: 1, fontFamily: 'monospace' }}>LED</Text>
          )}
          <TouchableOpacity onPress={() => onChange(removeRefAt(refs, index))}
            style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
            <Text style={{ color: colors.danger, fontSize: 16, fontWeight: '700' }}>×</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity onPress={() => onChange(appendSegRef(refs, defaultNewSegRef(refs)))}
        style={{ alignSelf: 'flex-start', marginBottom: hasSnapshot ? 10 : 0, paddingVertical: 4 }}>
        <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '600' }}>+ Add segment</Text>
      </TouchableOpacity>

      {hasSnapshot && (
        <>
          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', marginBottom: 4, marginTop: 4 }}>
            From capture
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 10, fontFamily: 'monospace', marginBottom: 8, lineHeight: 15 }}>
            {snapshot.map(formatWledSegLabel).join(' · ')}
          </Text>
          {snapshot.map(seg => {
            const checked = refs.some(r => r.id === seg.id);
            return (
              <TouchableOpacity
                key={seg.id}
                onPress={() => onChange(toggleSnapshotSelection(snapshot, refs, seg.id))}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 8,
                  marginBottom: 4, borderRadius: 6,
                  backgroundColor: checked ? colors.primary + '22' : colors.surface,
                  borderWidth: 1, borderColor: checked ? colors.primary : colors.border,
                }}>
                <View style={{
                  width: 18, height: 18, borderRadius: 4, borderWidth: 2,
                  borderColor: checked ? colors.primary : colors.borderFocus,
                  backgroundColor: checked ? colors.primary : 'transparent',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {checked && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text>}
                </View>
                <Text style={{
                  color: checked ? colors.primary : colors.textSecondary,
                  fontSize: 12, fontFamily: 'monospace', flex: 1,
                }}>
                  {formatWledSegLabel(seg)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </>
      )}
    </View>
  );
}

const styles = (c: Colors) => ({
  colorRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: c.border },
  swatch: { width: 28, height: 28, borderRadius: 6, borderWidth: 1, borderColor: c.border },
  label: { color: c.textPrimary, fontSize: 13 },
  hexInput: { backgroundColor: c.background, borderRadius: 6, borderWidth: 1, borderColor: c.borderFocus, color: c.textPrimary, padding: 6, fontSize: 11, width: 88, fontFamily: 'monospace' as const },
  link: { color: c.primary, fontSize: 13, fontWeight: '600' as const },
  resetBtn: { marginTop: 16, marginBottom: 8 },
  previewAllRow: { marginTop: 4, marginBottom: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.border, gap: 6 },
  testBtn: { alignSelf: 'flex-start' as const, backgroundColor: c.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  testBtnDisabled: { opacity: 0.45 },
  testBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' as const },
  simHint: { color: c.textMuted, fontSize: 10, fontFamily: 'monospace' as const },
});
