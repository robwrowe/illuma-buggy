import { Checkbox, Group, NumberInput, Stack, Text } from '@mantine/core';
import { Field } from '../shared/Field';
import { decodeTimingByte, encodeTimingByte } from '../../lib/ble/e9Decode';

export function TimingByteFields({ byteValue, onChange }) {
  const decoded = decodeTimingByte(byteValue);
  const hex = (Number(byteValue) & 0xff).toString(16).padStart(2, '0').toUpperCase();

  const patch = (next) => {
    onChange(encodeTimingByte({
      t: decoded.t,
      fadeBits: decoded.fadeBits,
      scaler: decoded.scaler,
      extended: decoded.extended,
      ...next,
    }));
  };

  return (
    <Stack gap={6}>
      <Text size="sm" ff="monospace" fw={600}>
        0x{hex}
      </Text>
      <Group gap={6} align="flex-start" wrap="wrap" grow>
        <Field label="On time" style={{ marginBottom: 0, flex: '1 1 72px' }}>
          <NumberInput
            size="xs"
            min={0}
            max={15}
            step={1}
            clampBehavior="strict"
            allowDecimal={false}
            value={decoded.t}
            onChange={(v) => patch({ t: Math.max(0, Math.min(15, Number(v) || 0)) })}
          />
        </Field>
        <Field label="Fade time" style={{ marginBottom: 0, flex: '1 1 72px' }}>
          <NumberInput
            size="xs"
            min={0}
            max={3}
            step={1}
            clampBehavior="strict"
            allowDecimal={false}
            value={decoded.fadeBits}
            onChange={(v) => patch({ fadeBits: Math.max(0, Math.min(3, Number(v) || 0)) })}
          />
        </Field>
      </Group>
      <Group gap="xs">
        <Checkbox
          size="xs"
          label="3×"
          checked={decoded.scaler}
          onChange={(e) => patch({ scaler: e.currentTarget.checked })}
        />
        <Checkbox
          size="xs"
          label="Ext"
          checked={decoded.extended}
          onChange={(e) => patch({ extended: e.currentTarget.checked })}
        />
      </Group>
      <Text size="xs" c="dimmed">
        On time is bits 3–0 (0–15). Fade time is bits 5–4 (0–3). 3× is bit 6, Ext is bit 7.
      </Text>
    </Stack>
  );
}
