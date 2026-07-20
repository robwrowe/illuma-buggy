import {
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Slider,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { SearchableSelect } from '../shared/SearchableSelect';
import {
  createEmptySegmentOverride,
  extractDrivenKeysForSegment,
  normalizeSegmentOverrides,
} from '../../lib/ble/mbMapping';
import { BLEND_MODE_SELECT_OPTS } from '../../lib/ble/mbConstants';

const MODE_OPTS = [
  { label: 'Default', value: 'default' },
  { label: 'Stored', value: 'stored' },
  { label: 'Custom', value: 'custom' },
];

const PROP_COLS = [
  { key: 'fx', label: 'Effect' },
  { key: 'pal', label: 'Palette' },
  { key: 'sx', label: 'Speed' },
  { key: 'ix', label: 'Intensity' },
  { key: 'blend', label: 'Blend' },
  { key: 'colors.0', label: 'Color 1', colorSlot: 0 },
  { key: 'colors.1', label: 'Color 2', colorSlot: 1 },
  { key: 'colors.2', label: 'Color 3', colorSlot: 2 },
];

function getPropEntry(ov, key) {
  if (key.startsWith('colors.')) {
    const slot = Number(key.slice(7));
    return ov?.colors?.[slot] || { mode: 'stored' };
  }
  return ov?.[key] || { mode: 'stored' };
}

function setPropEntry(ov, key, entry) {
  const next = { ...createEmptySegmentOverride(), ...ov };
  if (key.startsWith('colors.')) {
    const slot = Number(key.slice(7));
    const colors = [...(next.colors || [{ mode: 'stored' }, { mode: 'stored' }, { mode: 'stored' }])];
    colors[slot] = entry;
    next.colors = colors;
  } else {
    next[key] = entry;
  }
  return next;
}

function PropCell({
  propKey,
  label,
  colorSlot,
  entry,
  extracted,
  storedSeg,
  effectOptions,
  paletteOptions,
  onChange,
}) {
  const mode = extracted ? 'extract' : (entry?.mode || 'stored');
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

  if (extracted) {
    return (
      <Stack gap={2}>
        <Text size="xs" fw={600} c="dimmed">{label}</Text>
        <Text size="xs" c="violet">Extracted</Text>
        <Text size="xs" c="dimmed">set via extract target</Text>
      </Stack>
    );
  }

  const setMode = (nextMode) => {
    if (nextMode === 'custom') {
      let value;
      if (propKey === 'fx') value = storedSeg?.fx >= 0 ? storedSeg.fx : 0;
      else if (propKey === 'pal') value = storedSeg?.pal >= 0 ? storedSeg.pal : 0;
      else if (propKey === 'sx') value = storedSeg?.sx ?? 128;
      else if (propKey === 'ix') value = storedSeg?.ix ?? 128;
      else if (propKey === 'blend') value = storedSeg?.blend || 'top';
      else if (colorSlot !== undefined) value = storedSeg?.colors?.[colorSlot] || '#ffffff';
      onChange({ mode: 'custom', value });
    } else {
      onChange({ mode: nextMode });
    }
  };

  return (
    <Stack gap={4}>
      <Text size="xs" fw={600} c="dimmed">{label}</Text>
      <SegmentedControl
        size="xs"
        fullWidth
        value={mode === 'extract' ? 'stored' : mode}
        onChange={setMode}
        data={MODE_OPTS}
        styles={{ root: { flexWrap: 'wrap' }, label: { fontSize: 10, paddingInline: 4 } }}
      />
      {mode === 'custom' && propKey === 'fx' && (
        <SearchableSelect
          value={entry?.value !== undefined && entry.value !== null ? String(entry.value) : ''}
          onChange={(v) => onChange({ mode: 'custom', value: v === '' ? 0 : parseInt(v, 10) })}
          options={fxOpts}
          placeholder="Effect"
          allowEmpty
        />
      )}
      {mode === 'custom' && propKey === 'pal' && (
        <SearchableSelect
          value={entry?.value !== undefined && entry.value !== null ? String(entry.value) : ''}
          onChange={(v) => onChange({ mode: 'custom', value: v === '' ? 0 : parseInt(v, 10) })}
          options={palOpts}
          placeholder="Palette"
          allowEmpty
        />
      )}
      {mode === 'custom' && (propKey === 'sx' || propKey === 'ix') && (
        <Slider
          min={0}
          max={255}
          size="xs"
          value={Number.isFinite(entry?.value) ? entry.value : 128}
          onChange={(v) => onChange({ mode: 'custom', value: v })}
        />
      )}
      {mode === 'custom' && propKey === 'blend' && (
        <SearchableSelect
          value={entry?.value || 'top'}
          onChange={(blend) => onChange({ mode: 'custom', value: blend })}
          options={BLEND_MODE_SELECT_OPTS}
          allowEmpty={false}
        />
      )}
      {mode === 'custom' && colorSlot !== undefined && (
        <Group gap={4} wrap="nowrap">
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 3,
              flexShrink: 0,
              background: entry?.value || 'transparent',
              border: '1px solid var(--border)',
            }}
          />
          <TextInput
            size="xs"
            value={entry?.value || ''}
            placeholder="#rrggbb"
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (!raw) {
                onChange({ mode: 'custom', value: '' });
              } else if (/^#?[0-9a-fA-F]{6}$/.test(raw)) {
                const hex = `#${raw.replace(/^#/, '').toLowerCase()}`;
                onChange({ mode: 'custom', value: hex });
              }
            }}
            styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
          />
        </Group>
      )}
      {mode === 'stored' && (
        <Text size="xs" c="dimmed">
          map
          {propKey === 'fx' && (storedSeg?.fx >= 0 ? ` · fx ${storedSeg.fx}` : ' · Solid')}
          {propKey === 'pal' && (storedSeg?.pal >= 0 ? ` · pal ${storedSeg.pal}` : ' · —')}
          {propKey === 'sx' && ` · ${storedSeg?.sx ?? 128}`}
          {propKey === 'ix' && ` · ${storedSeg?.ix ?? 128}`}
          {propKey === 'blend' && ` · ${storedSeg?.blend || 'top'}`}
          {colorSlot !== undefined && (storedSeg?.colors?.[colorSlot] ? ` · ${storedSeg.colors[colorSlot]}` : ' · —')}
        </Text>
      )}
      {mode === 'default' && (
        <Text size="xs" c="dimmed">rule.effect / Solid</Text>
      )}
    </Stack>
  );
}

/**
 * Per-segment property source table for a rule.
 * Modes: Default (rule.effect), Stored (segment map), Custom (rule-only), Extracted (via extract targets).
 */
export function SegmentOverrideTable({
  segments = [],
  segmentOverrides = {},
  extracts = [],
  effectOptions = [],
  paletteOptions = [],
  onChange,
}) {
  const overrides = normalizeSegmentOverrides(segmentOverrides);

  if (!segments.length) return null;

  const setSegOverride = (segId, nextOv) => {
    const all = { ...overrides, [segId]: nextOv };
    onChange(normalizeSegmentOverrides(all));
  };

  return (
    <Paper p="sm" withBorder bg="var(--surface2)">
      <Text size="sm" fw={700} mb={4}>Per-segment sources</Text>
      <Text size="xs" c="dimmed" mb="sm">
        Choose where each property comes from for this rule only. Custom values stay on the rule —
        they do not edit the shared segment map. Extracted fields are set via extract targets below.
      </Text>
      <Stack gap="sm">
        {segments.map((seg) => {
          const driven = extractDrivenKeysForSegment(extracts, seg.id, seg.maskAssignment || '');
          const ov = overrides[seg.id] || createEmptySegmentOverride();
          return (
            <Paper key={seg.id} p="xs" withBorder bg="var(--bg)">
              <Group justify="space-between" mb="xs" wrap="wrap">
                <Text size="xs" fw={700} ff="monospace">
                  {seg.id}
                  <Text span size="xs" c="dimmed" ff="monospace"> · {seg.start}-{seg.stop}</Text>
                </Text>
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="sm">
                {PROP_COLS.map((col) => {
                  const extracted = driven.has(col.key);
                  const entry = getPropEntry(ov, col.key);
                  return (
                    <PropCell
                      key={col.key}
                      propKey={col.key}
                      label={col.label}
                      colorSlot={col.colorSlot}
                      entry={entry}
                      extracted={extracted}
                      storedSeg={seg}
                      effectOptions={effectOptions}
                      paletteOptions={paletteOptions}
                      onChange={(nextEntry) => {
                        if (extracted) return;
                        setSegOverride(seg.id, setPropEntry(ov, col.key, nextEntry));
                      }}
                    />
                  );
                })}
              </SimpleGrid>
            </Paper>
          );
        })}
      </Stack>
    </Paper>
  );
}
