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
import { decodeMbColorMaskByte, encodeMbColorMaskByte, decodeMb6BitChannelFields, encodeMb6BitChannel } from '../../lib/ble/mbPayloads';
import {
  NIBBLE_CUSTOM_BIT_FIELDS,
  bitRangeLabel,
  customBitFieldMax,
  decodeBitGroupValue,
  encodeBitGroupValue,
  normalizeCustomBitFields,
} from '../../lib/ble/byteAnalyzer';
import { generateId } from '../../lib/utils';
import { useWandLabUiState } from '../../lib/ble/wandLabUiState';
import { byteToBitString } from '../../lib/ble/wandSimClient';
import { ClickableBitStrip } from './ByteBitCell';
import { TimingByteFields } from './TimingByteFields';

const EDIT_MODES = [
  { value: 'binary', label: 'Bin' },
  { value: 'timing', label: 'Time' },
  { value: 'custom', label: 'Custom' },
  { value: 'maskColor', label: 'C+M' },
  { value: 'color6', label: '6bit' },
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
  return (
    <Stack gap={6}>
      <ClickableBitStrip
        byteValue={byteValue}
        onByteChange={(v) => onChange(byteIndex, v)}
      />
      <Text size="xs" ff="monospace" c="dimmed">
        0x{(byteValue & 0xff).toString(16).padStart(2, '0').toUpperCase()}
      </Text>
    </Stack>
  );
}

function TimingByteEditor({ byteIndex, byteValue, onChange }) {
  return (
    <TimingByteFields
      byteValue={byteValue}
      onChange={(v) => onChange(byteIndex, v)}
    />
  );
}

function CustomBitFieldsConfig({ fields, onChange }) {
  const list = normalizeCustomBitFields(fields);

  const patchField = (id, patch) => {
    onChange(list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const setRange = (id, hi, lo) => {
    const a = Math.max(0, Math.min(7, Number(hi) || 0));
    const b = Math.max(0, Math.min(7, Number(lo) || 0));
    const bitStart = Math.min(a, b);
    const bitCount = Math.abs(a - b) + 1;
    patchField(id, { bitStart, bitCount });
  };

  return (
    <Stack gap={4}>
      <Group justify="space-between" gap={4} wrap="nowrap">
        <Text size="xs" c="dimmed" fw={600}>
          Custom bit fields
        </Text>
        <Group gap={4} wrap="nowrap">
          <Button
            size="compact-xs"
            variant="default"
            onClick={() => onChange(NIBBLE_CUSTOM_BIT_FIELDS.map((f) => ({ ...f, id: generateId() })))}
          >
            Two nibbles
          </Button>
          <Button
            size="compact-xs"
            variant="default"
            onClick={() => onChange([
              ...list,
              { id: generateId(), name: `f${list.length + 1}`, bitStart: 0, bitCount: 4 },
            ])}
          >
            + Field
          </Button>
        </Group>
      </Group>
      {list.length === 0 && (
        <Text size="xs" c="dimmed">
          Add fields (e.g. bits 7–4 and 3–0) to edit them as decimals.
        </Text>
      )}
      {list.map((f) => {
        const hi = f.bitStart + f.bitCount - 1;
        const lo = f.bitStart;
        return (
          <Group key={f.id} gap={4} wrap="nowrap" align="flex-end">
            <TextInput
              size="xs"
              label="Name"
              value={f.name}
              onChange={(e) => patchField(f.id, { name: e.currentTarget.value })}
              w={64}
              styles={{ input: { paddingInline: 6 } }}
            />
            <NumberInput
              size="xs"
              label="Hi bit"
              min={0}
              max={7}
              value={hi}
              onChange={(v) => setRange(f.id, v, lo)}
              w={58}
            />
            <NumberInput
              size="xs"
              label="Lo bit"
              min={0}
              max={7}
              value={lo}
              onChange={(v) => setRange(f.id, hi, v)}
              w={58}
            />
            <Text size="xs" c="dimmed" ff="monospace" pb={6}>
              {bitRangeLabel(f.bitStart, f.bitCount)}
            </Text>
            <Button
              size="compact-xs"
              variant="subtle"
              color="red"
              onClick={() => onChange(list.filter((x) => x.id !== f.id))}
            >
              ✕
            </Button>
          </Group>
        );
      })}
    </Stack>
  );
}

function CustomByteEditor({ byteIndex, byteValue, onChange, fields }) {
  const list = normalizeCustomBitFields(fields);

  return (
    <Stack gap={6}>
      <ClickableBitStrip
        byteValue={byteValue}
        onByteChange={(v) => onChange(byteIndex, v)}
        groups={list}
      />
      {list.map((f) => (
        <Field
          key={f.id}
          label={`${f.name || 'field'} (${bitRangeLabel(f.bitStart, f.bitCount)})`}
          style={{ marginBottom: 0 }}
        >
          <NumberInput
            size="xs"
            min={0}
            max={customBitFieldMax(f.bitCount)}
            clampBehavior="strict"
            value={decodeBitGroupValue(byteValue, f.bitStart, f.bitCount)}
            onChange={(v) => onChange(
              byteIndex,
              encodeBitGroupValue(byteValue, f.bitStart, f.bitCount, Number(v) || 0),
            )}
          />
        </Field>
      ))}
      <Text size="xs" ff="monospace" c="dimmed">
        0x{(byteValue & 0xff).toString(16).padStart(2, '0').toUpperCase()}
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

function Color6BitByteEditor({ byteIndex, byteValue, onChange }) {
  const [fields, setFields] = useState(() => decodeMb6BitChannelFields(byteValue));

  useEffect(() => {
    setFields(decodeMb6BitChannelFields(byteValue));
  }, [byteIndex, byteValue]);

  const apply = (next) => {
    const clamped = {
      ...next,
      ch: Math.max(0, Math.min(63, Number(next.ch) || 0)),
      bit0: !!next.bit0,
      bit7: !!next.bit7,
    };
    setFields(clamped);
    onChange(byteIndex, encodeMb6BitChannel(clamped.ch, { bit0: clamped.bit0, bit7: clamped.bit7 }));
  };

  const packed = encodeMb6BitChannel(fields.ch, { bit0: fields.bit0, bit7: fields.bit7 });

  return (
    <Stack gap={4}>
      <ByteValueReadout byteValue={byteValue} />
      <Field label="6-bit (0–63)" style={{ marginBottom: 0 }}>
        <NumberInput
          size="xs"
          min={0}
          max={63}
          value={fields.ch}
          onChange={(v) => apply({ ...fields, ch: v })}
        />
      </Field>
      <Group gap="xs">
        <Checkbox
          size="xs"
          label="bit0"
          checked={fields.bit0}
          onChange={(e) => apply({ ...fields, bit0: e.currentTarget.checked })}
        />
        <Checkbox
          size="xs"
          label="bit7"
          checked={fields.bit7}
          onChange={(e) => apply({ ...fields, bit7: e.currentTarget.checked })}
        />
      </Group>
      <Text size="xs" c="dimmed" ff="monospace">
        {`bits[6:1]=ch · spare bit0/bit7 → 0x${packed.toString(16).padStart(2, '0').toUpperCase()}`}
      </Text>
    </Stack>
  );
}

function ByteEditorCard({
  byteIndex,
  byteValue,
  origValue,
  editMode,
  onEditModeChange,
  onChange,
  onReset,
  customFields,
}) {
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
      {editMode === 'custom' && (
        <CustomByteEditor
          byteIndex={byteIndex}
          byteValue={byteValue}
          onChange={onChange}
          fields={customFields}
        />
      )}
      {editMode === 'maskColor' && (
        <MaskColorByteEditor byteIndex={byteIndex} byteValue={byteValue} onChange={onChange} />
      )}
      {editMode === 'color6' && (
        <Color6BitByteEditor byteIndex={byteIndex} byteValue={byteValue} onChange={onChange} />
      )}
    </Stack>
  );
}

export function WandLabByteBitsEditor({
  selections,
  onChange,
  onReset,
  customBitFields = [],
  onCustomBitFieldsChange,
}) {
  const [editModes, setEditModes] = useWandLabUiState('byteEditModes', () => ({}));

  if (!selections?.length) return null;

  const setMode = (index, mode) => {
    if (mode === 'custom' && onCustomBitFieldsChange && !normalizeCustomBitFields(customBitFields).length) {
      onCustomBitFieldsChange(NIBBLE_CUSTOM_BIT_FIELDS.map((f) => ({ ...f, id: generateId() })));
    }
    setEditModes((prev) => ({ ...prev, [index]: mode }));
  };

  const anyCustom = selections.some(({ index }) => (editModes[index] ?? 'binary') === 'custom');

  return (
    <Stack gap="xs">
      <Text size="xs" c="dimmed" fw={600} tt="uppercase">
        {selections.length === 1 ? 'Byte editor' : 'Selected byte editors'}
      </Text>
      {anyCustom && onCustomBitFieldsChange && (
        <CustomBitFieldsConfig fields={customBitFields} onChange={onCustomBitFieldsChange} />
      )}
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
            customFields={customBitFields}
          />
        ))}
      </Group>
    </Stack>
  );
}
