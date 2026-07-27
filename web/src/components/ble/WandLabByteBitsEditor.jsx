import { useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Group,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { Field } from '../shared/Field';
import { SearchableSelect } from '../shared/SearchableSelect';
import { mbPaletteOptions } from '../../lib/ble/mbConstants';
import {
  decodeTimingByte,
  timingByteFromEditFields,
  timingByteToEditFields,
} from '../../lib/ble/e9Decode';
import { decodeMbColorMaskByte, encodeMbColorMaskByte } from '../../lib/ble/mbPayloads';
import { byteToBitString, parseBitStringToByte } from '../../lib/ble/wandSimClient';

const EDIT_MODES = [
  { value: 'binary', label: 'Bin' },
  { value: 'timing', label: 'Time' },
  { value: 'maskColor', label: 'C+M' },
];

const CARD_STYLE = {
  flex: '1 1 220px',
  maxWidth: '100%',
  minWidth: 200,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--surface2)',
};

function ByteValueReadout({ byteValue }) {
  const hex = (byteValue & 0xff).toString(16).padStart(2, '0').toUpperCase();
  const bits = byteToBitString(byteValue & 0xff);
  return (
    <Group gap={6} align="flex-end" wrap="nowrap">
      <TextInput
        label="Bits"
        value={bits}
        disabled
        size="xs"
        ff="monospace"
        w={96}
        styles={{ input: { cursor: 'default', paddingInline: 6 } }}
      />
      <Text size="xs" ff="monospace" c="dimmed" pb={4}>
        0x{hex}
      </Text>
    </Group>
  );
}

function BinaryByteEditor({ byteIndex, byteValue, onChange }) {
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

  return (
    <Group gap={6} align="flex-end" wrap="nowrap">
      <TextInput
        label="Bits"
        value={draft}
        onChange={handleChange}
        onBlur={handleBlur}
        size="xs"
        ff="monospace"
        placeholder="10100000"
        w={96}
        styles={{ input: { paddingInline: 6 } }}
      />
      <Text size="xs" ff="monospace" c="dimmed" pb={4}>
        0x{(byteValue & 0xff).toString(16).padStart(2, '0').toUpperCase()}
      </Text>
    </Group>
  );
}

function TimingByteEditor({ byteIndex, byteValue, onChange }) {
  const [fields, setFields] = useState(() => timingByteToEditFields(byteValue));

  useEffect(() => {
    setFields(timingByteToEditFields(byteValue));
  }, [byteIndex, byteValue]);

  const applyFields = (next) => {
    setFields(next);
    onChange(byteIndex, timingByteFromEditFields(next));
  };

  const decoded = decodeTimingByte(byteValue);

  return (
    <Stack gap={4}>
      <ByteValueReadout byteValue={byteValue} />
      <Group gap={6} align="flex-start" wrap="wrap" grow>
        <Field label="On (s)" style={{ marginBottom: 0, flex: '1 1 72px' }}>
          <NumberInput
            size="xs"
            min={0}
            step={0.1}
            decimalScale={2}
            value={fields.onSec}
            onChange={(v) => applyFields({ ...fields, onSec: Number(v) || 0 })}
          />
        </Field>
        <Field label="Fade (s)" style={{ marginBottom: 0, flex: '1 1 72px' }}>
          <NumberInput
            size="xs"
            min={0}
            step={0.1}
            decimalScale={2}
            value={fields.fadeSec}
            onChange={(v) => applyFields({ ...fields, fadeSec: Number(v) || 0 })}
          />
        </Field>
      </Group>
      <Group gap="xs">
        <Checkbox
          size="xs"
          label="3×"
          checked={fields.scaler}
          onChange={(e) => applyFields({ ...fields, scaler: e.currentTarget.checked })}
        />
        <Checkbox
          size="xs"
          label="Ext"
          checked={fields.extended}
          onChange={(e) => applyFields({ ...fields, extended: e.currentTarget.checked })}
        />
      </Group>
      <Text size="xs" c="dimmed" ff="monospace">
        t={decoded.t} fade={decoded.fadeBits}
      </Text>
    </Stack>
  );
}

function MaskColorByteEditor({ byteIndex, byteValue, onChange }) {
  const palOpts = mbPaletteOptions();
  const [fields, setFields] = useState(() => decodeMbColorMaskByte(byteValue));

  useEffect(() => {
    setFields(decodeMbColorMaskByte(byteValue));
  }, [byteIndex, byteValue]);

  const applyFields = (next) => {
    setFields(next);
    onChange(byteIndex, encodeMbColorMaskByte(next.palette, next.mask));
  };

  return (
    <Stack gap={4}>
      <ByteValueReadout byteValue={byteValue} />
      <Field label="Palette" style={{ marginBottom: 0 }}>
        <SearchableSelect
          value={String(fields.palette)}
          allowEmpty={false}
          onChange={(v) => applyFields({ ...fields, palette: parseInt(v, 10) || 0 })}
          options={palOpts}
        />
      </Field>
      <Field label="Mask (0–7)" style={{ marginBottom: 0 }}>
        <NumberInput
          size="xs"
          min={0}
          max={7}
          value={fields.mask}
          onChange={(v) =>
            applyFields({ ...fields, mask: Math.max(0, Math.min(7, Number(v) || 0)) })
          }
        />
      </Field>
      <Text size="xs" c="dimmed" ff="monospace">
        m={fields.mask} pal={fields.palette}
      </Text>
    </Stack>
  );
}

function ByteEditorCard({ byteIndex, byteValue, origValue, editMode, onEditModeChange, onChange, onReset }) {
  const modified = origValue != null && (byteValue & 0xff) !== (origValue & 0xff);
  return (
    <Stack gap={6} p={8} style={CARD_STYLE}>
      <Group justify="space-between" align="center" wrap="nowrap" gap={4}>
        <Text size="xs" fw={700} ff="monospace">
          [{byteIndex}]
          {modified ? (
            <Text span size="xs" c="dimmed" ff="monospace"> ←0x{(origValue & 0xff).toString(16).padStart(2, '0').toUpperCase()}</Text>
          ) : null}
        </Text>
        <Group gap={4} wrap="nowrap">
          {modified && onReset && (
            <Button
              size="compact-xs"
              variant="default"
              onClick={() => onReset(byteIndex)}
              title="Restore this byte to its original value"
            >
              Reset
            </Button>
          )}
          <SegmentedControl
            size="xs"
            value={editMode}
            onChange={onEditModeChange}
            data={EDIT_MODES}
            styles={{
              root: { flexShrink: 1 },
              label: { paddingInline: 6, fontSize: 11 },
            }}
          />
        </Group>
      </Group>
      {editMode === 'binary' && (
        <BinaryByteEditor byteIndex={byteIndex} byteValue={byteValue} onChange={onChange} />
      )}
      {editMode === 'timing' && (
        <TimingByteEditor byteIndex={byteIndex} byteValue={byteValue} onChange={onChange} />
      )}
      {editMode === 'maskColor' && (
        <MaskColorByteEditor byteIndex={byteIndex} byteValue={byteValue} onChange={onChange} />
      )}
    </Stack>
  );
}

export function WandLabByteBitsEditor({ selections, onChange, onReset }) {
  const [editModes, setEditModes] = useState({});

  if (!selections?.length) return null;

  const setMode = (index, mode) => {
    setEditModes((prev) => ({ ...prev, [index]: mode }));
  };

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed" fw={600} tt="uppercase">
        {selections.length === 1 ? 'Byte editor' : 'Selected byte editors'}
      </Text>
      <Group gap="xs" align="stretch" wrap="wrap">
        {selections.map(({ index, value, origValue }) => (
          <ByteEditorCard
            key={index}
            byteIndex={index}
            byteValue={value}
            origValue={origValue}
            editMode={editModes[index] ?? 'binary'}
            onEditModeChange={(mode) => setMode(index, mode)}
            onChange={onChange}
            onReset={onReset}
          />
        ))}
      </Group>
    </Stack>
  );
}
