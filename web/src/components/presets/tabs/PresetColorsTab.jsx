import { Checkbox, SimpleGrid, Stack, Text } from '@mantine/core';
import { ColorCell } from '../../shared/ColorCell';
import { Field } from '../../shared/Field';
import { AppButton } from '../../shared/styles';
import { MAX_EFFECT_COLORS, hexListToWledCol, wledColToHexList } from '../../../lib/utils';

export function PresetColorsTab({ sel, setSel, setMemory, savedColors, onSaveColor }) {
  const effectHexes = wledColToHexList(sel.global.col);
  const setEffectHexes = (hexes) => {
    const col = hexListToWledCol(hexes);
    setSel((s) => ({
      ...s,
      global: { ...s.global, col },
      memory: { ...s.memory, color: hexes.length > 0 ? true : s.memory.color },
    }));
  };

  return (
    <Stack gap="sm" maw={520}>
      <Text size="sm" c="dimmed" lh={1.5}>
        Effect colors (WLED <Text component="code" ff="monospace" span>col</Text>). Used for solid, dual, triple, and similar effects.
        Honored when Settings → Recall State includes color (or preset memory has color checked).
      </Text>
      {effectHexes.length === 0 && (
        <Text size="sm" c="dimmed">No effect colors set — add one for effects that use custom RGB instead of a palette.</Text>
      )}
      <SimpleGrid cols={2} spacing="sm">
        {effectHexes.map((hex, i) => (
          <Stack key={i} gap={6}>
            <Text size="xs" fw={700} c="dimmed">Color {i + 1}</Text>
            <ColorCell
              color={hex}
              savedColors={savedColors}
              onSaveColor={onSaveColor}
              onRemove={effectHexes.length > 1 ? () => {
                setEffectHexes(effectHexes.filter((_, j) => j !== i));
              } : null}
              onChange={(nc) => {
                const next = [...effectHexes];
                next[i] = nc;
                setEffectHexes(next);
              }}
            />
          </Stack>
        ))}
      </SimpleGrid>
      {effectHexes.length < MAX_EFFECT_COLORS && (
        <AppButton
          type="button"
          variant="default"
          size="compact-sm"
          onClick={() => setEffectHexes([...effectHexes, '#ffffff'])}
          style={{ alignSelf: 'flex-start' }}
        >
          + Add color ({effectHexes.length}/{MAX_EFFECT_COLORS})
        </AppButton>
      )}
      {effectHexes.length > 0 && (
        <AppButton
          type="button"
          variant="danger"
          size="compact-sm"
          onClick={() => setEffectHexes([])}
          style={{ alignSelf: 'flex-start' }}
        >
          Clear all colors
        </AppButton>
      )}
      <Field label="Remember color at recall">
        <Checkbox
          label='Include in preset when global recall is "memory"'
          checked={sel.memory.color}
          onChange={(e) => setMemory('color', e.target.checked)}
        />
      </Field>
    </Stack>
  );
}
