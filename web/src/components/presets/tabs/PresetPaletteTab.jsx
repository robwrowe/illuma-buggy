import { Box, NumberInput, Stack, Text, TextInput } from '@mantine/core';
import { Field } from '../../shared/Field';
import { SearchableSelect } from '../../shared/SearchableSelect';
import { paletteSelectValue } from '../../../lib/utils';

export function PresetPaletteTab({
  sel,
  setGlobal,
  wledPalettes,
  paletteOptions,
  onApplyPalettePick,
}) {
  return (
    <Stack gap="sm" maw={520}>
      <Field label="Color palette">
        <SearchableSelect
          value={paletteSelectValue(sel.global)}
          onChange={onApplyPalettePick}
          placeholder="— Select palette —"
          maxListHeight={320}
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
          <Text size="sm" c="dimmed">Manual override</Text>
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
  );
}
