import { Checkbox, Group, Paper, Stack, Text } from '@mantine/core';
import { SegmentOverrideTable } from '../../ble/SegmentOverrideTable';
import { Field } from '../../shared/Field';
import { SearchableSelect } from '../../shared/SearchableSelect';
import { SegmentBar } from '../../shared/SegmentBar';
import { AppButton } from '../../shared/styles';
import { formatSegLabel, summarizeLayout } from '../../../lib/wled/capture';
import { PRESET_LEDMAP_OPTS, segmentMapPreview } from '../presetModel';

export function PresetSegmentsTab({
  sel,
  setSel,
  setMemory,
  segmentMaps,
  wledEffects,
  wledPalettes,
  onOpenMapEditor,
}) {
  const linkedLedmap = segmentMaps.find((m) => m.id === sel.segmentMapId)?.ledmap ?? 0;

  return (
    <Stack gap="sm" maw={720}>
      <Text size="sm" c="dimmed">
        Linked map applies when recall includes segments (Settings → Recall State).
        Edit maps here or in Settings → Segment Maps — both edit the same store.
        With a map linked, per-segment sources mirror BLE Data rules (stored / default / custom).
      </Text>
      <AppButton
        type="button"
        variant="default"
        size="compact-sm"
        onClick={onOpenMapEditor}
        style={{ alignSelf: 'flex-start' }}
      >
        Edit segment maps…
      </AppButton>
      {sel.global.seg?.length > 0 && !sel.segmentMapId && (
        <Paper p="sm" radius="md" bg="var(--primary-dim)" style={{ border: '1px solid var(--primary)' }}>
          <Group gap="sm" mb={6} wrap="nowrap">
            <Text size="sm" fw={600} style={{ flex: 1 }}>Inline layout (imported)</Text>
            <AppButton
              type="button"
              variant="danger"
              size="compact-xs"
              onClick={() => setSel((s) => ({
                ...s,
                global: { ...s.global, seg: undefined },
                memory: { ...s.memory, segments: false },
              }))}
            >
              Clear
            </AppButton>
          </Group>
          <SegmentBar segments={sel.global.seg} />
          <Text size="xs" c="dimmed" mt={4} ff="monospace">
            {sel.global.seg.map((s) => {
              const fxPart = s.fx != null ? `fx:${s.fx}` : `fx:${sel.global.fx ?? '-'}`;
              const palPart = s.pal != null ? `pal:${s.pal}` : `pal:${sel.global.pal ?? '-'}`;
              return `${formatSegLabel(s)} · ${fxPart} · ${palPart}`;
            }).join(' · ')}
          </Text>
        </Paper>
      )}
      <Paper
        p="sm"
        radius="md"
        bg={!sel.segmentMapId && !sel.global.seg?.length ? 'var(--primary-dim)' : 'var(--surface2)'}
        style={{ border: '1px solid var(--border)', cursor: 'pointer' }}
        onClick={() => setSel((s) => ({
          ...s,
          segmentMapId: '',
          segmentOverrides: {},
          segmentSourceMode: 'global',
          global: { ...s.global, seg: undefined },
          memory: { ...s.memory, segments: false },
        }))}
      >
        <Group gap="sm" wrap="nowrap">
          <Text size="sm" style={{ flex: 1 }}>None (single segment only)</Text>
          {!sel.segmentMapId && !sel.global.seg?.length && (
            <Text c="var(--primary)">✓</Text>
          )}
        </Group>
      </Paper>
      {segmentMaps.length === 0 && (
        <Text size="sm" c="dimmed">No segment maps yet — open the editor above to create one.</Text>
      )}
      {segmentMaps.map((map) => {
        const preview = segmentMapPreview(map);
        return (
          <Paper
            key={map.id}
            p="sm"
            radius="md"
            bg={sel.segmentMapId === map.id ? 'var(--primary-dim)' : 'var(--surface2)'}
            style={{ border: '1px solid var(--border)', cursor: 'pointer' }}
            onClick={() => setSel((s) => ({
              ...s,
              segmentMapId: map.id,
              memory: { ...s.memory, segments: true },
              segmentOverrides: {},
              segmentSourceMode: 'global',
              global: { ...s.global, seg: undefined },
            }))}
          >
            <Group gap="sm" mb={6} wrap="nowrap">
              <Text size="sm" fw={600} style={{ flex: 1 }}>{map.name}</Text>
              {sel.segmentMapId === map.id && (
                <Text c="var(--primary)">✓</Text>
              )}
            </Group>
            <SegmentBar segments={preview.segments} />
            <Text size="xs" c="dimmed" mt={4} ff="monospace">{summarizeLayout(preview)}</Text>
          </Paper>
        );
      })}
      <Field label="LED map override">
        <SearchableSelect
          value={sel.ledmap == null ? '' : String(sel.ledmap)}
          onChange={(v) => setSel((s) => ({
            ...s,
            ledmap: (v === '' || v == null) ? null : Number(v),
          }))}
          placeholder={`Use segment map's ledmap (${linkedLedmap})`}
          options={[
            {
              value: '',
              label: `Use segment map's ledmap (${linkedLedmap})`,
              searchText: 'inherit segment map default',
            },
            ...PRESET_LEDMAP_OPTS,
          ]}
        />
        <Text size="xs" c="dimmed" mt={4}>
          Sent every time this preset fires, so the board&apos;s ledmap always matches
          what&apos;s shown here even if it was changed elsewhere. Leave as inherit
          unless this preset needs a different remap than its segment map.
        </Text>
      </Field>
      {sel.segmentMapId && (
        <SegmentOverrideTable
          segments={segmentMaps.find((m) => m.id === sel.segmentMapId)?.segments || []}
          segmentOverrides={sel.segmentOverrides || {}}
          segmentSourceMode={sel.segmentSourceMode || 'global'}
          extracts={[]}
          effectOptions={wledEffects}
          paletteOptions={wledPalettes}
          onChange={(patch) => setSel((s) => ({ ...s, ...patch }))}
        />
      )}
      {(sel.segmentMapId || sel.global.seg?.length > 0) && (
        <Field label="Remember segments at recall">
          <Checkbox
            checked={sel.memory.segments}
            onChange={(e) => setMemory('segments', e.target.checked)}
          />
        </Field>
      )}
    </Stack>
  );
}
