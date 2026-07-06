import { useState } from 'react';
import { Button, Group, Stack, TextInput } from '@mantine/core';
import { ColorCell } from './ColorCell';
import { AppButton } from './styles';

export const PALETTE_SWATCHES = [
  '#ff0000', '#ff4400', '#ff8800', '#ffcc00', '#ffff00', '#aaff00',
  '#00ff00', '#00ff88', '#00ffff', '#0088ff', '#0044ff', '#6600ff',
  '#aa00ff', '#ff00ff', '#ff0088', '#ffffff', '#cccccc', '#888888',
  '#444444', '#000000', '#ff6666', '#66ff66', '#6666ff', '#ffaa44',
];

export function ColorInput({ value, onChange, savedColors, onSaveColor }) {
  const [showPicker, setShowPicker] = useState(false);
  const library = savedColors || [];

  if (showPicker) {
    return (
      <Stack gap="xs" mt={4}>
        <ColorCell color={value} onChange={onChange} savedColors={savedColors} onSaveColor={onSaveColor} />
        <AppButton variant="default" fullWidth size="compact-xs" onClick={() => setShowPicker(false)}>Done</AppButton>
      </Stack>
    );
  }

  return (
    <Stack gap={4} style={{ minWidth: 0 }}>
      <Group gap={4} align="center" wrap="nowrap">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setShowPicker(true)}
          style={{ width: 24, height: 24, borderRadius: 4, background: value, border: '1px solid var(--border)', cursor: 'pointer', flexShrink: 0 }}
        />
        <TextInput
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#?[0-9a-fA-F]{6}$/.test(v)) onChange(v.startsWith('#') ? v : `#${v}`);
          }}
          w={88}
          size="xs"
          styles={{ input: { fontFamily: 'monospace' } }}
        />
        <Button variant="default" size="compact-xs" onClick={() => setShowPicker(true)} title="Full picker">⋯</Button>
        {onSaveColor && (
          <Button variant="default" size="compact-xs" onClick={() => onSaveColor(value)} title="Save to library">★</Button>
        )}
      </Group>
      {library.length > 0 && (
        <Group gap={2}>
          {library.map((sc) => (
            <div
              key={sc.id}
              title={sc.name}
              onClick={() => onChange(sc.hex)}
              style={{ width: 14, height: 14, borderRadius: 2, background: sc.hex, cursor: 'pointer', border: '1px solid #ffffff22' }}
            />
          ))}
        </Group>
      )}
    </Stack>
  );
}
