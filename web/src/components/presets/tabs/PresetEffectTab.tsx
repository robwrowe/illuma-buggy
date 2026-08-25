import {
  Box,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  SimpleGrid,
  Slider,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { Field } from '../../shared/Field';
import { SearchableSelect } from '../../shared/SearchableSelect';
import { SwatchColorPicker } from '../../shared/SwatchColorPicker';
import { AppButton } from '../../shared/styles';
import { MAX_EFFECT_COLORS, paletteSelectValue } from '../../../lib/utils';

const PARAM_SLIDERS = [
  { k: 'sx', label: 'Speed', max: 255 },
  { k: 'ix', label: 'Intensity', max: 255 },
  { k: 'c1', label: 'Custom 1', max: 255 },
  { k: 'c2', label: 'Custom 2', max: 255 },
  { k: 'c3', label: 'Custom 3', max: 31 },
];

const PARAM_OPTS = [
  { k: 'o1', label: 'Option 1' },
  { k: 'o2', label: 'Option 2' },
  { k: 'o3', label: 'Option 3' },
];

const MEMORY_KEYS = ['effect', 'palette', 'parameters', 'color'];

export function PresetEffectTab({
  sel,
  setSel,
  setGlobal,
  setMemory,
  wledEffects,
  wledPalettes,
  effectFilter,
  onEffectFilterChange,
  filteredEffects,
  paletteOptions,
  onApplyPalettePick,
}) {
  const colorRefs = Array.isArray(sel.global?.colorRefs) ? sel.global.colorRefs : [];
  const colorLibrary = sel.colorLibrary || [];

  const setColorRefs = (next) => {
    setSel((s) => ({
      ...s,
      global: { ...s.global, colorRefs: next },
      memory: {
        ...s.memory,
        color: next.length > 0 ? true : s.memory.color,
      },
    }));
  };

  const saveSwatchToLibrary = (entry) => {
    setSel((s) => ({
      ...s,
      colorLibrary: [...(s.colorLibrary || []), entry],
    }));
  };

  return (
    <Stack gap="md" maw={560}>
      <Text size="sm" fw={600}>Global Effect</Text>

      {/* ── Effect ── */}
      <Stack gap="sm">
        <Text size="sm" fw={600} c="dimmed">Effect</Text>
        {sel.global.fx != null && sel.global.fx !== '' && (
          <Paper p="sm" radius="md" bg="var(--primary-dim)" style={{ border: '1px solid var(--border)' }}>
            <Text size="xs" c="dimmed" mb={2}>Selected</Text>
            <Text size="sm" fw={600}>
              {sel.global.fxName || 'Unnamed effect'}
              <Text component="span" fw={400} c="dimmed" ml={6}>#{sel.global.fx}</Text>
            </Text>
          </Paper>
        )}
        {wledEffects.length > 0 ? (
          <>
            <Field label={`Filter effects (${filteredEffects.length} of ${wledEffects.length})`}>
              <TextInput
                value={effectFilter}
                onChange={(e) => onEffectFilterChange(e.target.value)}
                placeholder="Type to filter by name or ID…"
              />
            </Field>
            <ScrollArea.Autosize mah={240} style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
              {filteredEffects.length === 0 && (
                <Text p="md" size="sm" c="dimmed" ta="center">No effects match</Text>
              )}
              {filteredEffects.map((eff) => (
                <Box
                  key={eff.id}
                  onClick={() => setSel((s) => ({
                    ...s,
                    global: { ...s.global, fx: eff.id, fxName: eff.name },
                  }))}
                  p="sm"
                  style={{
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                    background: sel.global.fx === eff.id ? 'var(--primary-dim)' : 'transparent',
                    color: sel.global.fx === eff.id ? 'var(--primary)' : 'var(--text)',
                  }}
                >
                  <Text size="sm" component="span">{eff.name}</Text>
                  <Text size="xs" c="dimmed" component="span" ml={6}>#{eff.id}</Text>
                </Box>
              ))}
            </ScrollArea.Autosize>
            {sel.global.fx != null && sel.global.fx !== '' && (
              <AppButton
                type="button"
                variant="default"
                size="compact-sm"
                onClick={() => setSel((s) => ({
                  ...s,
                  global: { ...s.global, fx: undefined, fxName: '' },
                }))}
                style={{ alignSelf: 'flex-start' }}
              >
                Clear selection
              </AppButton>
            )}
          </>
        ) : (
          <Text size="xs" c="dimmed">
            Use WLED Connect in the left panel to fetch the effect list.
          </Text>
        )}
        <Box component="details">
          <Box component="summary" style={{ cursor: 'pointer', userSelect: 'none' }}>
            <Text size="sm" c="dimmed">Manual effect override</Text>
          </Box>
          <Stack gap="sm" mt="sm">
            <Field label="Effect name">
              <TextInput
                value={sel.global.fxName || ''}
                onChange={(e) => setGlobal('fxName', e.target.value)}
                placeholder="e.g. Rainbow"
              />
            </Field>
            <Field label="Effect ID">
              <NumberInput
                value={sel.global.fx ?? ''}
                onChange={(v) => setGlobal('fx', v === '' || v == null ? undefined : parseInt(String(v), 10))}
                placeholder="0"
                hideControls
              />
            </Field>
          </Stack>
        </Box>
      </Stack>

      {/* ── Palette ── */}
      <Stack gap="sm">
        <Text size="sm" fw={600} c="dimmed">Palette</Text>
        <Field label="Color palette">
          <SearchableSelect
            value={paletteSelectValue(sel.global)}
            onChange={onApplyPalettePick}
            placeholder="— Select palette —"
            maxListHeight={280}
            options={paletteOptions}
          />
        </Field>
        {sel.global.pal != null && sel.global.pal !== '' && (
          <Text size="sm" c="dimmed">
            {sel.global.palName || 'Unnamed palette'} · ID {sel.global.pal}
          </Text>
        )}
        {wledPalettes.length === 0 && (
          <Text size="xs" c="dimmed">
            Connect to WLED to load palette names from the controller catalog.
          </Text>
        )}
        <Box component="details">
          <Box component="summary" style={{ cursor: 'pointer', userSelect: 'none' }}>
            <Text size="sm" c="dimmed">Manual palette override</Text>
          </Box>
          <Stack gap="sm" mt="sm">
            <Field label="Palette name">
              <TextInput
                value={sel.global.palName || ''}
                onChange={(e) => setGlobal('palName', e.target.value)}
                placeholder="e.g. Rainbow"
              />
            </Field>
            <Field label="Palette ID">
              <NumberInput
                value={sel.global.pal ?? ''}
                onChange={(v) => setGlobal('pal', v === '' || v == null ? undefined : parseInt(String(v), 10))}
                placeholder="0"
                hideControls
              />
            </Field>
          </Stack>
        </Box>
      </Stack>

      {/* ── Params ── */}
      <Stack gap="sm">
        <Text size="sm" fw={600} c="dimmed">Parameters</Text>
        <SimpleGrid cols={2} spacing="md">
          {PARAM_SLIDERS.map(({ k, label, max }) => (
            <Field key={k} label={`${label}: ${sel.global[k] ?? 128}`}>
              <Slider
                min={0}
                max={max}
                value={sel.global[k] ?? 128}
                onChange={(v) => setGlobal(k, v)}
                size="xs"
              />
            </Field>
          ))}
          {PARAM_OPTS.map(({ k, label }) => (
            <Field key={k} label={label}>
              <Checkbox
                checked={sel.global[k] || false}
                onChange={(e) => setGlobal(k, e.target.checked)}
              />
            </Field>
          ))}
        </SimpleGrid>
      </Stack>

      {/* ── Effect colors ── */}
      <Stack gap="sm">
        <Text size="sm" fw={600} c="dimmed">Effect colors</Text>
        <Text size="sm" c="dimmed" lh={1.5}>
          Pick from this preset&apos;s color library, or enter a custom hex.
          Manage named swatches on the Colors tab.
        </Text>
        {colorRefs.length === 0 && (
          <Text size="sm" c="dimmed">No effect colors set.</Text>
        )}
        <SimpleGrid cols={2} spacing="sm">
          {colorRefs.map((ref, i) => (
            <Stack key={i} gap={6}>
              <Group justify="space-between" align="center">
                <Text size="xs" fw={700} c="dimmed">Color {i + 1}</Text>
                {colorRefs.length > 1 && (
                  <AppButton
                    type="button"
                    variant="danger"
                    size="compact-xs"
                    onClick={() => setColorRefs(colorRefs.filter((_, j) => j !== i))}
                  >
                    Remove
                  </AppButton>
                )}
              </Group>
              <SwatchColorPicker
                value={ref}
                colorLibrary={colorLibrary}
                onChange={(next) => {
                  const updated = [...colorRefs];
                  updated[i] = next;
                  setColorRefs(updated);
                }}
                onSaveToLibrary={saveSwatchToLibrary}
              />
            </Stack>
          ))}
        </SimpleGrid>
        {colorRefs.length < MAX_EFFECT_COLORS && (
          <AppButton
            type="button"
            variant="default"
            size="compact-sm"
            onClick={() => setColorRefs([...colorRefs, { mode: 'custom', value: '#ffffff' }])}
            style={{ alignSelf: 'flex-start' }}
          >
            + Add color ({colorRefs.length}/{MAX_EFFECT_COLORS})
          </AppButton>
        )}
        {colorRefs.length > 0 && (
          <AppButton
            type="button"
            variant="danger"
            size="compact-sm"
            onClick={() => setColorRefs([])}
            style={{ alignSelf: 'flex-start' }}
          >
            Clear all colors
          </AppButton>
        )}
      </Stack>

      {/* ── Combined recall memory ── */}
      <Stack gap="xs">
        <Text size="sm" fw={600} c="dimmed">Remember at recall</Text>
        {MEMORY_KEYS.map((k) => (
          <Checkbox
            key={k}
            label={k.charAt(0).toUpperCase() + k.slice(1)}
            checked={!!sel.memory[k]}
            onChange={(e) => setMemory(k, e.target.checked)}
          />
        ))}
      </Stack>
    </Stack>
  );
}
