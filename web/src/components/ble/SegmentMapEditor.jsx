import { useState } from 'react';
import {
  Checkbox,
  CloseButton,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Slider,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { Field } from '../shared/Field';
import { SearchableSelect } from '../shared/SearchableSelect';
import { SectionHead } from '../shared/SectionHead';
import { AppButton, AppCard } from '../shared/styles';
import { MB_SEGMENT_META, BLEND_MODE_SELECT_OPTS } from '../../lib/ble/mbConstants';
import {
  createEmptySegment,
  createEmptySegmentMap,
  mergeImportedSegmentsIntoMap,
  normalizeMbMapping,
  normalizeSegment,
  normalizeSegmentMap,
  wledSegmentToSegmentMapSegment,
} from '../../lib/ble/mbMapping';
import { fetchWledSegmentsFromIp } from '../../lib/wled/capture';
const MASK_OPTS = [
  { value: 'ignore', label: 'ignore', searchText: 'ignore' },
  ...MB_SEGMENT_META.map((s) => ({
    value: s.id,
    label: s.label,
    searchText: `${s.id} ${s.label}`,
  })),
];

function PresetVarRows({ vars, onChange }) {
  const entries = Object.entries(vars || {});
  const setEntry = (i, key, value) => {
    const next = {};
    entries.forEach(([k, v], idx) => {
      if (idx === i) {
        if (key.trim()) next[key.trim()] = value;
      } else if (k) {
        next[k] = v;
      }
    });
    onChange(next);
  };
  const removeEntry = (i) => {
    const next = {};
    entries.forEach(([k, v], idx) => {
      if (idx !== i && k) next[k] = v;
    });
    onChange(next);
  };
  return (
    <Stack gap="xs">
      {entries.map(([k, v], i) => (
        <Group key={i} gap="xs" wrap="nowrap" align="flex-end" grow>
          <Field label="Key">
            <TextInput
              value={k}
              onChange={(e) => setEntry(i, e.target.value, v)}
              styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
            />
          </Field>
          <Field label="Value">
            <TextInput
              value={String(v ?? '')}
              onChange={(e) => setEntry(i, k, e.target.value)}
              styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
            />
          </Field>
          <AppButton variant="danger" size="compact-xs" onClick={() => removeEntry(i)}>×</AppButton>
        </Group>
      ))}
      <AppButton
        size="compact-xs"
        variant="default"
        onClick={() => onChange({ ...(vars || {}), [`var${entries.length + 1}`]: '' })}
      >
        Add variable
      </AppButton>
    </Stack>
  );
}

function SegmentRowEditor({ segment, presets, effectOptions = [], paletteOptions = [], onChange, onDelete }) {
  const seg = normalizeSegment(segment);
  const set = (patch) => onChange({ ...seg, ...patch });
  const presetOpts = (presets || []).map((p) => ({
    value: p.id,
    label: p.name,
    searchText: p.name,
  }));
  const fxOpts = (effectOptions || []).map((e) => ({
    value: String(e.id),
    label: e.name,
    searchText: `${e.id} ${e.name}`,
  }));
  const palOpts = (paletteOptions || []).map((p) => ({
    value: String(p.id),
    label: p.name,
    searchText: `${p.id} ${p.name}`,
  }));

  return (
    <Paper p="sm" withBorder bg="var(--surface2)">
      <Group justify="space-between" mb="xs" wrap="wrap">
        <Text size="xs" fw={700} ff="monospace">{seg.id}</Text>
        <AppButton variant="danger" size="compact-xs" onClick={onDelete}>Delete</AppButton>
      </Group>

      <Group gap={6} align="center" wrap="wrap" mb="xs">
        <Text size="xs" c="dimmed">wled id</Text>
        <NumberInput
          w={52}
          size="xs"
          value={seg.wledSegId}
          onChange={(v) => set({ wledSegId: Math.max(0, parseInt(v, 10) || 0) })}
          hideControls
          styles={{ input: { textAlign: 'center', fontFamily: 'monospace' } }}
        />
        <Text size="xs" c="dimmed">start</Text>
        <NumberInput
          w={52}
          size="xs"
          value={seg.start}
          onChange={(v) => set({ start: Math.max(0, parseInt(v, 10) || 0) })}
          hideControls
          styles={{ input: { textAlign: 'center', fontFamily: 'monospace' } }}
        />
        <Text size="xs" c="dimmed">stop</Text>
        <NumberInput
          w={52}
          size="xs"
          value={seg.stop}
          onChange={(v) => set({ stop: Math.max(0, parseInt(v, 10) || 0) })}
          hideControls
          styles={{ input: { textAlign: 'center', fontFamily: 'monospace' } }}
        />
      </Group>

      <SimpleGrid cols={3} spacing="xs" mb="xs">
        {['grp', 'spc', 'of'].map((f) => (
          <Field key={f} label={f}>
            <NumberInput
              size="xs"
              value={seg[f]}
              onChange={(v) => set({ [f]: f === 'grp' ? Math.max(1, parseInt(v, 10) || 1) : (parseInt(v, 10) || 0) })}
              hideControls
              styles={{ input: { textAlign: 'center', fontFamily: 'monospace' } }}
            />
          </Field>
        ))}
      </SimpleGrid>

      <Group gap="md" mb="xs">
        <Checkbox label="rev" size="xs" checked={!!seg.rev} onChange={(e) => set({ rev: e.target.checked })} />
        <Checkbox label="mi" size="xs" checked={!!seg.mi} onChange={(e) => set({ mi: e.target.checked })} />
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mb="xs">
        <Field label="Blend">
          <SearchableSelect
            value={seg.blend || 'top'}
            onChange={(blend) => set({ blend })}
            options={BLEND_MODE_SELECT_OPTS}
            allowEmpty={false}
          />
        </Field>
        <Field label="Mask assignment">
          <SearchableSelect
            value={seg.maskAssignment || 'all'}
            onChange={(maskAssignment) => set({ maskAssignment })}
            options={MASK_OPTS}
            allowEmpty={false}
          />
        </Field>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mb="xs">
        <Field label="Effect">
          <SearchableSelect
            value={seg.fx >= 0 ? String(seg.fx) : ''}
            onChange={(v) => set({ fx: v === '' ? -1 : parseInt(v, 10) })}
            options={fxOpts}
            placeholder="(use rule fx)"
            allowEmpty
          />
          {seg.fx >= 0 && (
            <Text size="xs" c="dimmed" mt={4}>
              Overrides the rule&apos;s effect for this segment. Leave blank to use the rule&apos;s fx.
            </Text>
          )}
        </Field>
        <Field label="Palette">
          <SearchableSelect
            value={seg.pal >= 0 ? String(seg.pal) : ''}
            onChange={(v) => set({ pal: v === '' ? -1 : parseInt(v, 10) })}
            options={palOpts}
            placeholder="(none)"
            allowEmpty
          />
        </Field>
      </SimpleGrid>

      <SimpleGrid cols={2} spacing="xs" mb="xs">
        <Stack gap={2}>
          <Text size="xs" c="dimmed">sx</Text>
          <Slider min={0} max={255} value={seg.sx ?? 128} onChange={(v) => set({ sx: v })} size="xs" />
        </Stack>
        <Stack gap={2}>
          <Text size="xs" c="dimmed">ix</Text>
          <Slider min={0} max={255} value={seg.ix ?? 128} onChange={(v) => set({ ix: v })} size="xs" />
        </Stack>
      </SimpleGrid>

      <Field label="Preset (optional)">
        <SearchableSelect
          value={seg.presetId || ''}
          onChange={(presetId) => set({ presetId })}
          placeholder="(none)"
          options={presetOpts}
          allowEmpty
        />
      </Field>

      <Text size="xs" fw={600} c="dimmed" mt="xs" mb={4}>Colors (col0–col2, empty = untouched)</Text>
      <SimpleGrid cols={3} spacing="xs" mb="xs">
        {[0, 1, 2].map((i) => (
          <Field key={i} label={`col${i}`}>
            <Group gap={4} wrap="nowrap">
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 3,
                  flexShrink: 0,
                  background: seg.colors[i] || 'transparent',
                  border: '1px solid var(--border)',
                }}
              />
              <TextInput
                size="xs"
                value={seg.colors[i] || ''}
                placeholder="#rrggbb"
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  const colors = [...seg.colors];
                  if (!raw) {
                    colors[i] = '';
                    set({ colors });
                  } else if (/^#?[0-9a-fA-F]{6}$/.test(raw)) {
                    colors[i] = raw.startsWith('#') ? `#${raw.replace(/^#/, '').toLowerCase()}` : `#${raw.toLowerCase()}`;
                    set({ colors });
                  }
                }}
                styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
                style={{ flex: 1, minWidth: 0 }}
              />
              <CloseButton
                size="sm"
                aria-label={`Clear col${i}`}
                title="Clear"
                disabled={!seg.colors[i]}
                onClick={() => {
                  const colors = [...seg.colors];
                  colors[i] = '';
                  set({ colors });
                }}
              />
            </Group>
          </Field>
        ))}
      </SimpleGrid>

      <Text size="xs" fw={600} c="dimmed" mt="xs" mb={4}>Preset variables</Text>
      <PresetVarRows
        vars={seg.presetVariables}
        onChange={(presetVariables) => set({ presetVariables })}
      />
    </Paper>
  );
}

export function SegmentMapEditor({
  mb,
  presets = [],
  wledIp = '',
  effectOptions = [],
  paletteOptions = [],
  onChange,
  onPresetsChange,
}) {
  const mapping = normalizeMbMapping(mb);
  const maps = mapping.segmentMaps || [];
  const [selectedId, setSelectedId] = useState(maps[0]?.id || null);
  const selected = maps.find((m) => m.id === selectedId) || maps[0] || null;
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState('');
  const [importMsg, setImportMsg] = useState('');

  const setMaps = (nextMaps) => {
    onChange({ ...mapping, segmentMaps: nextMaps.map(normalizeSegmentMap) });
  };

  const updateMap = (id, patch) => {
    setMaps(maps.map((m) => (m.id === id ? normalizeSegmentMap({ ...m, ...patch }) : m)));
  };

  const addMap = () => {
    const map = createEmptySegmentMap({ name: `Map ${maps.length + 1}` });
    setMaps([...maps, map]);
    setSelectedId(map.id);
  };

  const duplicateMap = (map) => {
    const copy = normalizeSegmentMap({
      ...JSON.parse(JSON.stringify(map)),
      id: undefined,
      name: `${map.name || 'Map'} copy`,
      segments: (map.segments || []).map((s) => ({ ...s, id: undefined })),
    });
    setMaps([...maps, copy]);
    setSelectedId(copy.id);
  };

  const deleteMap = (id) => {
    const inUseByRules = (mapping.rules || []).filter((r) => r.segmentMapId === id);
    const inUseByPresets = (presets || []).filter((p) => p.segmentMapId === id);
    if (inUseByRules.length || inUseByPresets.length) {
      const names = [
        ...inUseByRules.map((r) => `rule "${r.name}"`),
        ...inUseByPresets.map((p) => `preset "${p.name}"`),
      ].join(', ');
      if (!window.confirm(
        `This map is used by ${names}. Deleting it will leave those references pointing at ` +
        `nothing (rules fall back to single-segment mode; presets fall back to no segment data). ` +
        `Delete anyway?`,
      )) return;
    }
    const next = maps.filter((m) => m.id !== id);
    onChange({
      ...mapping,
      segmentMaps: next.map(normalizeSegmentMap),
      rules: (mapping.rules || []).map((r) => (
        r.segmentMapId === id ? { ...r, segmentMapId: '' } : r
      )),
    });
    if (inUseByPresets.length && onPresetsChange) {
      onPresetsChange(
        (presets || []).map((p) => (
          p.segmentMapId === id ? { ...p, segmentMapId: undefined } : p
        )),
      );
    }
    if (selectedId === id) setSelectedId(next[0]?.id || null);
  };

  const importFromWled = async () => {
    if (!selected) return;
    setImportErr('');
    setImportMsg('');
    setImporting(true);
    try {
      const ip = (wledIp || '').trim();
      if (!ip) throw new Error('Enter a WLED IP above');
      localStorage.setItem('wled-ip', ip);
      const rawSegs = await fetchWledSegmentsFromIp(ip);
      const imported = rawSegs.map(wledSegmentToSegmentMapSegment);
      const { segments, updated, added } = mergeImportedSegmentsIntoMap(selected.segments, imported);
      updateMap(selected.id, { segments });
      setImportMsg(
        updated || added
          ? `${updated} updated, ${added} added`
          : `${imported.length} segment${imported.length === 1 ? '' : 's'} imported`,
      );
    } catch (e) {
      setImportErr(e?.message || 'Could not read WLED state');
    } finally {
      setImporting(false);
    }
  };

  const replaceFromWled = async () => {
    if (!selected) return;
    if (!window.confirm('Replace all segments in this map with the live WLED strip? Mask assignments and presets will be lost.')) {
      return;
    }
    setImportErr('');
    setImportMsg('');
    setImporting(true);
    try {
      const ip = (wledIp || '').trim();
      if (!ip) throw new Error('Enter a WLED IP above');
      localStorage.setItem('wled-ip', ip);
      const rawSegs = await fetchWledSegmentsFromIp(ip);
      const imported = rawSegs.map(wledSegmentToSegmentMapSegment);
      updateMap(selected.id, { segments: imported.length ? imported : [createEmptySegment()] });
      setImportMsg(`Replaced with ${imported.length} segment${imported.length === 1 ? '' : 's'}`);
    } catch (e) {
      setImportErr(e?.message || 'Could not read WLED state');
    } finally {
      setImporting(false);
    }
  };

  const canImport = !!(wledIp || '').trim() && !!selected && !importing;

  return (
    <Stack gap="md">
      <Text size="xs" c="dimmed" lh={1.5}>
        Shareable segment maps referenced by rules and presets via{' '}
        <code style={{ fontFamily: 'monospace' }}>segmentMapId</code>.
        Mask assignment links a segment to MB region extracts; <strong>ignore</strong> excludes it from mask fan-out.
        Leave segment Effect blank (<code style={{ fontFamily: 'monospace' }}>fx: -1</code>) to use the rule&apos;s effect.
      </Text>

      <Group gap="xs" wrap="wrap">
        <AppButton size="compact-sm" variant="primary" onClick={addMap}>Add map</AppButton>
        <Text size="xs" c="dimmed">{maps.length} map{maps.length === 1 ? '' : 's'}</Text>
      </Group>

      {maps.length === 0 ? (
        <Paper p="sm" withBorder>
          <Text size="sm" c="dimmed">No segment maps yet. Create one, then select it from a rule.</Text>
        </Paper>
      ) : (
        <Group gap={6} wrap="wrap">
          {maps.map((m) => (
            <AppButton
              key={m.id}
              size="compact-sm"
              variant={m.id === selected?.id ? 'primary' : 'default'}
              onClick={() => setSelectedId(m.id)}
            >
              {m.name || m.id}
            </AppButton>
          ))}
        </Group>
      )}

      {selected && (
        <AppCard>
          <SectionHead>Edit map</SectionHead>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mb="sm">
            <Field label="Name">
              <TextInput
                value={selected.name || ''}
                onChange={(e) => updateMap(selected.id, { name: e.target.value })}
              />
            </Field>
            <Field label="Id">
              <TextInput value={selected.id} disabled styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }} />
            </Field>
          </SimpleGrid>
          <Group gap="xs" mb="md" wrap="wrap">
            <AppButton size="compact-xs" variant="default" onClick={() => duplicateMap(selected)}>
              Duplicate
            </AppButton>
            <AppButton size="compact-xs" variant="danger" onClick={() => deleteMap(selected.id)}>
              Delete map
            </AppButton>
          </Group>

          <SectionHead>Segments</SectionHead>
          <Group gap="xs" mb="sm" wrap="wrap">
            <AppButton
              size="compact-sm"
              variant="primary"
              disabled={!canImport}
              onClick={importFromWled}
            >
              {importing ? 'Importing…' : '↻ Import from WLED'}
            </AppButton>
            <AppButton
              size="compact-sm"
              variant="default"
              disabled={!canImport}
              onClick={replaceFromWled}
            >
              Replace from WLED
            </AppButton>
            <AppButton
              size="compact-sm"
              variant="default"
              onClick={() => updateMap(selected.id, {
                segments: [...(selected.segments || []), createEmptySegment()],
              })}
            >
              Add segment
            </AppButton>
          </Group>
          {importErr && <Text size="xs" c="red" mb="xs">{importErr}</Text>}
          {importMsg && !importErr && <Text size="xs" c="dimmed" mb="xs">{importMsg}</Text>}

          <Stack gap="sm">
            {(selected.segments || []).map((seg, i) => (
              <SegmentRowEditor
                key={seg.id || i}
                segment={seg}
                presets={presets}
                effectOptions={effectOptions}
                paletteOptions={paletteOptions}
                onChange={(next) => {
                  const segments = [...(selected.segments || [])];
                  segments[i] = next;
                  updateMap(selected.id, { segments });
                }}
                onDelete={() => {
                  const segments = (selected.segments || []).filter((_, j) => j !== i);
                  updateMap(selected.id, { segments: segments.length ? segments : [createEmptySegment()] });
                }}
              />
            ))}
          </Stack>
        </AppCard>
      )}
    </Stack>
  );
}
