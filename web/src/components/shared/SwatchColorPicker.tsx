import { useState } from 'react';
import { Group, Stack, Text, TextInput } from '@mantine/core';
import { ColorCell } from './ColorCell';
import { AppButton } from './styles';
import { generateId, normalizeHex } from '../../lib/utils';

/**
 * Pick a color from a preset-local swatch library, or enter a bespoke hex.
 * value: { mode: 'swatch', swatchId } | { mode: 'custom', value: hex } | null
 */
export function SwatchColorPicker({
  value,
  colorLibrary = [],
  onChange,
  onSaveToLibrary,
}) {
  const [showCustom, setShowCustom] = useState(value?.mode === 'custom');
  const lib = colorLibrary || [];

  const resolvedHex = (() => {
    if (!value) return '#ffffff';
    if (value.mode === 'custom' && value.value) return value.value;
    if (value.mode === 'swatch' && value.swatchId) {
      return lib.find((c) => c.id === value.swatchId)?.hex || '#ffffff';
    }
    return '#ffffff';
  })();

  const pickSwatch = (swatch) => {
    setShowCustom(false);
    onChange({ mode: 'swatch', swatchId: swatch.id });
  };

  const openCustom = () => {
    setShowCustom(true);
    onChange({ mode: 'custom', value: normalizeHex(resolvedHex) || '#ffffff' });
  };

  const saveToLibrary = () => {
    if (!onSaveToLibrary || value?.mode !== 'custom' || !value.value) return;
    const hex = normalizeHex(value.value);
    if (!hex) return;
    const id = generateId();
    onSaveToLibrary({ id, name: '', hex });
    onChange({ mode: 'swatch', swatchId: id });
    setShowCustom(false);
  };

  return (
    <Stack gap={6}>
      <Group gap={4} wrap="wrap">
        {lib.map((swatch) => {
          const selected = value?.mode === 'swatch' && value.swatchId === swatch.id;
          return (
            <button
              key={swatch.id}
              type="button"
              title={swatch.name || swatch.hex}
              onClick={() => pickSwatch(swatch)}
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                padding: 0,
                cursor: 'pointer',
                background: swatch.hex,
                border: selected ? '2px solid var(--primary)' : '1px solid var(--border)',
                boxShadow: selected ? '0 0 0 1px var(--primary)' : undefined,
              }}
            />
          );
        })}
        <AppButton
          type="button"
          size="compact-xs"
          variant={value?.mode === 'custom' || showCustom ? 'primary' : 'default'}
          onClick={openCustom}
        >
          Custom…
        </AppButton>
      </Group>

      {value?.mode === 'swatch' && (
        <Text size="xs" c="dimmed">
          {lib.find((c) => c.id === value.swatchId)?.name || 'Swatch'}
          {' · '}
          <Text component="span" ff="monospace">{resolvedHex}</Text>
        </Text>
      )}

      {(showCustom || value?.mode === 'custom') && (
        <Stack gap={4}>
          <ColorCell
            color={resolvedHex}
            onChange={(hex) => {
              setShowCustom(true);
              onChange({ mode: 'custom', value: hex });
            }}
          />
          <Group gap={4} wrap="nowrap">
            <TextInput
              size="xs"
              value={value?.mode === 'custom' ? (value.value || '') : resolvedHex}
              placeholder="#rrggbb"
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (!raw) {
                  onChange({ mode: 'custom', value: '' });
                  return;
                }
                if (/^#?[0-9a-fA-F]{6}$/.test(raw)) {
                  onChange({
                    mode: 'custom',
                    value: `#${raw.replace(/^#/, '').toLowerCase()}`,
                  });
                }
              }}
              styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
              style={{ flex: 1 }}
            />
            {onSaveToLibrary && value?.mode === 'custom' && value.value && (
              <AppButton type="button" size="compact-xs" variant="default" onClick={saveToLibrary}>
                Save to library
              </AppButton>
            )}
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
