import { useState } from 'react';
import { Button, Paper, Stack, Text, TextInput } from '@mantine/core';
import { SearchableSelect } from '../shared/SearchableSelect';

export function MbEffectField({ label, hint, mapping, presets, onChange, compact }) {
  const [showSlots, setShowSlots] = useState(false);
  const setPreset = (presetId) => onChange({ ...mapping, presetId });
  const setSlots = (v) => {
    const colorSlots = v.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n) && n >= 0 && n <= 31);
    onChange({ ...mapping, colorSlots });
  };
  const presetOpts = presets.map((p) => ({ value: p.id, label: p.name, searchText: p.name }));
  return (
    <Paper p={compact ? 'xs' : 'sm'} mb={compact ? 'xs' : 'sm'} bg="var(--surface2)">
      <Stack gap="xs">
        <Text fw={600} size="sm">{label}</Text>
        {hint && <Text size="xs" c="dimmed">{hint}</Text>}
        <SearchableSelect
          value={mapping.presetId || ''}
          onChange={setPreset}
          placeholder="Use default preset"
          options={presetOpts}
        />
        <Button
          variant="subtle"
          size="compact-xs"
          color="gray"
          onClick={() => setShowSlots((s) => !s)}
        >
          {showSlots ? '▾ Hide color overrides' : '▸ Optional MB color overrides'}
        </Button>
        {showSlots && (
          <TextInput
            value={(mapping.colorSlots || []).join(',')}
            placeholder="palette indices 0–31"
            onChange={(e) => setSlots(e.target.value)}
            styles={{ input: { fontFamily: 'monospace' } }}
            size="xs"
          />
        )}
      </Stack>
    </Paper>
  );
}
