import { ActionIcon, Button, Group, Paper, Stack, Text, TextInput } from '@mantine/core';
import { AppButton } from '../shared/styles';
import { MB_PAL_OFF, MB_PAL_RANDOM, MB_PAL_UNIQUE, defaultRandomPaletteIndices, mbPaletteEligibleForRandom } from '../../lib/ble/mbConstants';
import { DEFAULT_MB_MAPPING } from '../../lib/ble/mbMapping';
import { generateId } from '../../lib/utils';

export function RandomPoolEditor({ randomPool, paletteColors, onChange }) {
  const pool = randomPool || DEFAULT_MB_MAPPING.randomPool;
  const poolSet = new Set(pool.paletteIndices || []);
  const selectable = Array.from({ length: MB_PAL_RANDOM }, (_, i) => i).filter(mbPaletteEligibleForRandom);

  const togglePalette = (idx) => {
    const next = new Set(poolSet);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    onChange({ ...pool, paletteIndices: [...next].sort((a, b) => a - b) });
  };

  const setCustom = (id, patch) => {
    onChange({
      ...pool,
      custom: (pool.custom || []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  };

  const removeCustom = (id) => {
    onChange({ ...pool, custom: (pool.custom || []).filter((c) => c.id !== id) });
  };

  const addCustom = () => {
    onChange({
      ...pool,
      custom: [...(pool.custom || []), { id: generateId(), name: 'Custom', hex: '#ff6600' }],
    });
  };

  const resetPool = () => {
    onChange({ paletteIndices: defaultRandomPaletteIndices(), custom: [] });
  };

  return (
    <Paper p="sm" mb="md" withBorder bg="var(--surface2)">
      <Stack gap="xs">
        <Text fw={700} size="sm">Random pool (palette {MB_PAL_RANDOM})</Text>
        <Text size="xs" c="dimmed" lh={1.5}>
          When the band sends “random”, the board picks uniformly from enabled palettes and custom colors below.
          Off ({MB_PAL_OFF}) and unique ({MB_PAL_UNIQUE}) are always excluded.
        </Text>
        <Group gap={6}>
          {selectable.map((idx) => {
            const on = poolSet.has(idx);
            return (
              <Button
                key={idx}
                size="compact-xs"
                variant={on ? 'light' : 'default'}
                color={on ? 'violet' : 'gray'}
                onClick={() => togglePalette(idx)}
                leftSection={(
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      display: 'inline-block',
                      background: paletteColors[idx] || '#888',
                      border: '1px solid var(--border)',
                    }}
                  />
                )}
              >
                {idx}
              </Button>
            );
          })}
        </Group>
        <Text size="xs" fw={600} c="dimmed" mt="xs">Custom random-only colors</Text>
        {(pool.custom || []).length === 0 ? (
          <Text size="xs" c="dimmed">None — add colors not tied to an MB palette slot.</Text>
        ) : (pool.custom || []).map((c) => (
          <Group key={c.id} gap="xs" align="center">
            <div style={{ width: 28, height: 28, borderRadius: 4, background: c.hex, border: '1px solid var(--border)', flexShrink: 0 }} />
            <TextInput
              value={c.name}
              onChange={(e) => setCustom(c.id, { name: e.target.value })}
              placeholder="Name"
              size="xs"
              style={{ flex: 1 }}
            />
            <TextInput
              value={c.hex}
              onChange={(e) => {
                const h = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
                if (/^#[0-9a-fA-F]{6}$/.test(h)) setCustom(c.id, { hex: h });
              }}
              w={88}
              size="xs"
              styles={{ input: { fontFamily: 'monospace' } }}
            />
            <ActionIcon variant="light" color="red" size="sm" onClick={() => removeCustom(c.id)}>×</ActionIcon>
          </Group>
        ))}
        <Group gap="md">
          <Button variant="subtle" size="compact-sm" onClick={addCustom}>+ Add custom</Button>
          <Button variant="subtle" size="compact-sm" color="gray" onClick={resetPool}>Reset pool</Button>
        </Group>
        {pool.paletteIndices.length === 0 && (pool.custom || []).length === 0 && (
          <Text size="xs" c="red">Pool is empty — random will fall back to defaults on the board.</Text>
        )}
      </Stack>
    </Paper>
  );
}
