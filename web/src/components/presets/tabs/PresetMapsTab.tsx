import { Group, Paper, Stack, Text, TextInput } from '@mantine/core';
import { SegmentMapEditor } from '../../ble/SegmentMapEditor';
import { Field } from '../../shared/Field';
import { SearchableSelect } from '../../shared/SearchableSelect';
import { SegmentBar } from '../../shared/SegmentBar';
import { AppButton } from '../../shared/styles';
import { customSegmentMapFromWledSegs } from '../../../lib/ble/mbMapping';
import { summarizeLayout } from '../../../lib/wled/capture';
import {
  blankCustomSegmentMap,
  CUSTOM_SEGMENT_MAP_ID,
  PRESET_LEDMAP_OPTS,
  resolvePresetSegmentMap,
  segmentMapPreview,
} from '../presetModel';

export function PresetMapsTab({
  sel,
  setSel,
  segmentMaps,
  wledEffects,
  wledPalettes,
  wledIp,
  onWledIpChange,
  onOpenMapEditor,
}) {
  const activeMap = resolvePresetSegmentMap(sel, segmentMaps);
  const linkedLedmap = activeMap?.ledmap ?? 0;
  const isCustom = sel.segmentMapId === CUSTOM_SEGMENT_MAP_ID;

  const selectNone = () => setSel((s) => ({
    ...s,
    segmentMapId: '',
    customSegmentMap: null,
    segmentOverrides: {},
    segmentSourceMode: 'global',
    global: { ...s.global, seg: undefined },
    memory: { ...s.memory, segments: false },
  }));

  const selectShared = (mapId) => setSel((s) => ({
    ...s,
    segmentMapId: mapId,
    memory: { ...s.memory, segments: true },
    segmentOverrides: {},
    segmentSourceMode: 'global',
    global: { ...s.global, seg: undefined },
  }));

  const selectCustom = () => setSel((s) => {
    const fromInline = !s.segmentMapId && s.global?.seg?.length
      ? customSegmentMapFromWledSegs(s.global.seg)
      : null;
    return {
      ...s,
      segmentMapId: CUSTOM_SEGMENT_MAP_ID,
      customSegmentMap: fromInline || s.customSegmentMap || blankCustomSegmentMap(),
      memory: { ...s.memory, segments: true },
      segmentOverrides: fromInline ? {} : (s.segmentOverrides || {}),
      segmentSourceMode: s.segmentSourceMode || 'global',
      global: { ...s.global, seg: undefined },
    };
  });

  const customPreview = isCustom && sel.customSegmentMap
    ? segmentMapPreview(sel.customSegmentMap)
    : null;

  return (
    <Stack gap="sm" maw={720}>
      <Text size="sm" c="dimmed">
        Choose the LED remap and segment layout for this preset. Shared maps are edited in
        Settings / &quot;Edit segment maps…&quot;; a custom map lives only on this preset.
        Import from WLED creates a custom map.
      </Text>

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
          Sent every time this preset fires. Leave as inherit unless this preset needs a
          different remap than its segment map.
        </Text>
      </Field>

      <AppButton
        type="button"
        variant="default"
        size="compact-sm"
        onClick={onOpenMapEditor}
        style={{ alignSelf: 'flex-start' }}
      >
        Edit segment maps…
      </AppButton>

      <Paper
        p="sm"
        radius="md"
        bg={!sel.segmentMapId ? 'var(--primary-dim)' : 'var(--surface2)'}
        style={{ border: '1px solid var(--border)', cursor: 'pointer' }}
        onClick={selectNone}
      >
        <Group gap="sm" wrap="nowrap">
          <Text size="sm" style={{ flex: 1 }}>None (single segment only)</Text>
          {!sel.segmentMapId && (
            <Text c="var(--primary)">✓</Text>
          )}
        </Group>
      </Paper>

      <Paper
        p="sm"
        radius="md"
        bg={isCustom ? 'var(--primary-dim)' : 'var(--surface2)'}
        style={{ border: '1px solid var(--border)', cursor: 'pointer' }}
        onClick={selectCustom}
      >
        <Group gap="sm" mb={customPreview ? 6 : 0} wrap="nowrap">
          <Text size="sm" fw={600} style={{ flex: 1 }}>Custom (this preset only)</Text>
          {isCustom && <Text c="var(--primary)">✓</Text>}
        </Group>
        {customPreview && (
          <>
            <SegmentBar segments={customPreview.segments} />
            <Text size="xs" c="dimmed" mt={4} ff="monospace">{summarizeLayout(customPreview)}</Text>
          </>
        )}
      </Paper>

      {segmentMaps.length === 0 && (
        <Text size="sm" c="dimmed">No shared segment maps yet — open the editor above to create one.</Text>
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
            onClick={() => selectShared(map.id)}
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

      {isCustom && (
        <Stack gap="sm" mt="sm">
          <Text size="sm" fw={600}>Edit custom map</Text>
          <Group gap="sm" wrap="wrap" align="center">
            <Text size="xs" fw={600} c="dimmed">WLED IP</Text>
            <TextInput
              value={wledIp || ''}
              onChange={(e) => onWledIpChange?.(e.target.value)}
              placeholder="4.3.2.1"
              w={140}
              styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
            />
            <Text size="xs" c="dimmed">Import / replace from live strip</Text>
          </Group>
          <SegmentMapEditor
            singleMapMode
            mb={{ segmentMaps: [sel.customSegmentMap || blankCustomSegmentMap()], rules: [] }}
            presets={[]}
            wledIp={wledIp}
            effectOptions={wledEffects}
            paletteOptions={wledPalettes}
            onChange={(next) => {
              const map = (next.segmentMaps || [])[0];
              if (!map) return;
              setSel((s) => ({
                ...s,
                customSegmentMap: {
                  ...map,
                  id: 'custom',
                  name: map.name || '(custom to this preset)',
                },
              }));
            }}
          />
        </Stack>
      )}
    </Stack>
  );
}
