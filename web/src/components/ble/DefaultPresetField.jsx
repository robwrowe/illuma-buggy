import { Paper, Stack, Text } from '@mantine/core';
import { SearchableSelect } from '../shared/SearchableSelect';

export function DefaultPresetField({ mb, presets, onChange }) {
  const presetOpts = presets.map((p) => ({ value: p.id, label: p.name, searchText: p.name }));
  return (
    <Paper p="sm" mb="md" withBorder style={{ borderColor: 'var(--primary)', background: 'var(--primary-dim)' }}>
      <Stack gap="xs">
        <Text fw={700} size="sm" c="violet">Default zone preset</Text>
        <Text size="xs" c="dimmed" lh={1.45}>
          Same presets as GPS zones. Used for any wand/MB effect without its own preset. Must exist on the board — sync with <strong>📡 Board</strong>.
        </Text>
        <SearchableSelect
          value={mb.defaultPresetId || ''}
          onChange={(id) => onChange({ defaultPresetId: id })}
          placeholder="Select a preset…"
          options={presetOpts}
        />
      </Stack>
    </Paper>
  );
}
