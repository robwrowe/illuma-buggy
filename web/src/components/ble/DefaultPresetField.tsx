import { Stack, Text } from '@mantine/core';
import { SearchableSelect } from '../shared/SearchableSelect';
import { AppCard } from '../shared/styles';

export function DefaultPresetField({ mb, presets, onChange }) {
  const presetOpts = presets.map((p) => ({ value: p.id, label: p.name, searchText: p.name }));
  return (
    <AppCard p="sm">
      <Stack gap="xs">
        <Text fw={700} size="sm">
          Default zone preset
        </Text>
        <Text size="xs" c="dimmed" lh={1.45}>
          Same presets as GPS zones. Used for any BLE Data effect without its own preset. Must exist
          on the board — sync with <strong>📡 Board</strong>.
        </Text>
        <SearchableSelect
          value={mb.defaultPresetId || ''}
          onChange={(id) => onChange({ defaultPresetId: id })}
          placeholder="Select a preset…"
          options={presetOpts}
        />
      </Stack>
    </AppCard>
  );
}
