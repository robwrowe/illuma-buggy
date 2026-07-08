import { useEffect, useState } from 'react';
import { Group, Stack, Text, TextInput } from '@mantine/core';
import { byteToBitString, parseBitStringToByte } from '../../lib/ble/wandSimClient';

export function WandLabByteBitsEditor({ byteIndex, byteValue, onChange }) {
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (byteIndex == null || byteValue == null) {
      setDraft('');
      return;
    }
    setDraft(byteToBitString(byteValue));
  }, [byteIndex, byteValue]);

  const commit = (bits) => {
    const val = parseBitStringToByte(bits);
    if (val != null) onChange(byteIndex, val);
  };

  const handleChange = (e) => {
    const clean = e.target.value.replace(/[^01]/g, '').slice(0, 8);
    setDraft(clean);
    if (clean.length === 8) commit(clean);
  };

  const handleBlur = () => {
    if (!draft.length) return;
    const padded = draft.padStart(8, '0');
    setDraft(padded);
    commit(padded);
  };

  if (byteIndex == null) return null;

  const hex = (byteValue & 0xff).toString(16).padStart(2, '0').toUpperCase();

  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed" fw={600} tt="uppercase">
        Byte {byteIndex} bits
      </Text>
      <Group gap="sm" align="flex-end" wrap="wrap">
        <TextInput
          label="Binary (MSB → LSB)"
          description="Type 0/1 — hex updates when 8 bits are entered (or on blur)"
          value={draft}
          onChange={handleChange}
          onBlur={handleBlur}
          size="xs"
          ff="monospace"
          placeholder="10100000"
          maw={160}
        />
        <Text size="xs" ff="monospace" c="dimmed" pb={6}>
          = 0x{hex} ({byteValue & 0xff})
        </Text>
      </Group>
    </Stack>
  );
}
