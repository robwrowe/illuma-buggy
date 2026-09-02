import { Checkbox, Stack, Text } from '@mantine/core';
import { SegmentOverrideTable } from '../../ble/SegmentOverrideTable';
import { Field } from '../../shared/Field';
import { CUSTOM_SEGMENT_MAP_ID, resolvePresetSegmentMap } from '../presetModel';

export function PresetSegmentsTab({
  sel,
  setSel,
  setMemory,
  segmentMaps,
  wledEffects,
  wledPalettes,
}) {
  const activeMap = resolvePresetSegmentMap(sel, segmentMaps);
  const hasMap = !!sel.segmentMapId && !!activeMap;

  return (
    <Stack gap="sm" maw={720}>
      <Text size="sm" c="dimmed">
        Per-segment sources for the map selected on the Maps tab
        {sel.segmentMapId === CUSTOM_SEGMENT_MAP_ID
          ? ' (custom to this preset)'
          : activeMap
            ? ` (“${activeMap.name}”)`
            : ''}
        . Choose stored / default / custom for each property.
      </Text>

      {!hasMap && (
        <Text size="sm" c="dimmed">
          No segment map linked. Pick one on the Maps tab (or Import from WLED) to configure
          per-segment overrides.
        </Text>
      )}

      {hasMap && (
        <SegmentOverrideTable
          segments={activeMap.segments || []}
          segmentOverrides={sel.segmentOverrides || {}}
          segmentSourceMode={sel.segmentSourceMode || 'global'}
          extracts={[]}
          effectOptions={wledEffects}
          paletteOptions={wledPalettes}
          colorLibrary={sel.colorLibrary || []}
          onSaveToLibrary={(entry) => setSel((s) => ({
            ...s,
            colorLibrary: [...(s.colorLibrary || []), entry],
          }))}
          onChange={(patch) => setSel((s) => ({ ...s, ...patch }))}
        />
      )}

      {hasMap && (
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
