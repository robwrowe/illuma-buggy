import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal, ScrollView, Pressable,
} from 'react-native';
import {
  MbMappingConfig,
  MB_COLOR_NAMES, DEFAULT_MB_MAPPING,
  MB_PAL_OFF, MB_PAL_UNIQUE, MB_PAL_RANDOM,
  defaultRandomPaletteIndices, mbPaletteEligibleForRandom,
} from '../utils/mbConfig';
import { useAppStore } from '../stores/store';
import { bleService } from '../services/BLEService';
import { mbMappingEssentialPayload } from '../utils/bleBoardSync';

type Colors = ReturnType<typeof import('../utils/theme').useTheme>['colors'];
type BleTab = 'colors';

const BLE_TABS: { id: BleTab; label: string }[] = [
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
  } = useAppStore();
  const [tab, setTab] = useState<BleTab>('colors');
  const [defaultPickerOpen, setDefaultPickerOpen] = useState(false);

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

  const s = styles(colors);
  const defaultName = mbMapping.defaultPresetId
    ? (presets.find(p => p.id === mbMapping.defaultPresetId)?.name ?? mbMapping.defaultPresetId)
    : '— none —';

  return (
    <>
      <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 10, lineHeight: 18 }}>
        Rules and segment maps are authored in the web tool. Default preset + MB color table push with Board sync / connect.
      </Text>

      <View style={{
        marginBottom: 12, padding: 12, borderRadius: 8,
        backgroundColor: colors.primary + '18', borderWidth: 1, borderColor: colors.primary,
      }}>
        <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>Default zone preset</Text>
        <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4, marginBottom: 8 }}>
          Used when a rule has no preset assigned
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
