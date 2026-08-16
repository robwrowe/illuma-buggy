import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Group,
  NumberInput,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Textarea,
} from '@mantine/core';
import { Field } from '../shared/Field';
import { SearchableSelect } from '../shared/SearchableSelect';
import { DEFAULT_MB_WLED_COLORS, mbPaletteOptions } from '../../lib/ble/mbConstants';
import {
  decodeTimingByte,
  timingByteFromEditFields,
  timingByteToEditFields,
} from '../../lib/ble/e9Decode';
import {
  TAIL_BUILDER_COLOR_FORMATS,
  assembleTailPayload,
  omitConsecutiveDuplicateTails,
  parseTailList,
  tailBytesToDisplayHex,
} from '../../lib/ble/tailBuilder';

const TAIL_TEMPLATES = [
  { id: '58f4', label: '58 F4 48…', hex: '58 F4 48 82 D1 46 00 00 D0 65 00' },
  { id: '7aec', label: '7A EC 5C…', hex: '7A EC 5C 00 29 15 29 15 48 AB' },
  { id: 'd037', label: 'D0 37 F4…', hex: 'D0 37 F4 D2 46 00 64 64' },
];

const VIBRATION_OPTIONS = [
  { value: 'none', label: 'None (omit byte)', searchText: 'none omit' },
  { value: '0', label: '0x0 — none', searchText: '0x0 none' },
  { value: '1', label: '0x1 — - (6s break)', searchText: '0x1' },
  { value: '2', label: '0x2 — -- (6s break) --', searchText: '0x2' },
  { value: '3', label: '0x3 — --- (6s break) ---', searchText: '0x3' },
  { value: '4', label: '0x4 — --* (4s break)', searchText: '0x4' },
  { value: '5', label: '0x5 — ----*- (3s break)', searchText: '0x5' },
  { value: '6', label: '0x6 — ---***--- (3s break)', searchText: '0x6' },
  { value: '7', label: '0x7 — # (4s break)', searchText: '0x7' },
  { value: '8', label: "0x8 — '''''' pattern", searchText: '0x8' },
  { value: '9', label: '0x9 — - (6s break)', searchText: '0x9' },
  { value: '10', label: '0xA — * (6s break)', searchText: '0xa' },
  { value: '11', label: '0xB — % (5s break)', searchText: '0xb' },
  { value: '12', label: '0xC — none', searchText: '0xc none' },
  { value: '13', label: '0xD — none', searchText: '0xd none' },
  { value: '14', label: '0xE — none', searchText: '0xe none' },
  { value: '15', label: '0xF — none', searchText: '0xf none' },
];

function defaultColor() {
  return { kind: 'palette', paletteIdx: 0, mask: 0, r: 0, g: 0, b: 0 };
}

function defaultColors(n) {
  return Array.from({ length: n }, defaultColor);
}

function parseVibrationValue(raw) {
  if (raw === '' || raw == null || raw === 'none') return null;
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0 || n > 15) return null;
  return n;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function TailTimingEditor({ timingByte, onChange }) {
  const [fields, setFields] = useState(() => timingByteToEditFields(timingByte));

  useEffect(() => {
    setFields(timingByteToEditFields(timingByte));
  }, [timingByte]);

  const applyFields = (next) => {
    setFields(next);
    onChange(timingByteFromEditFields(next));
  };

  const decoded = decodeTimingByte(timingByte);
  const hex = (timingByte & 0xff).toString(16).padStart(2, '0').toUpperCase();

  return (
    <Stack gap={4}>
      <Group gap={8} align="flex-end">
        <Text size="sm" ff="monospace" fw={600}>
          0x{hex}
        </Text>
        <Text size="xs" c="dimmed" ff="monospace">
          t={decoded.t} fade={decoded.fadeBits}
        </Text>
      </Group>
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
    </Stack>
  );
}

function ColorSwatchBox({ background }) {
  return (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: 4,
        flex: '0 0 auto',
        background: background || '#000',
        border: '1px solid var(--border)',
      }}
    />
  );
}

export function WandLabTailBuilderTab({
  simIp,
  onStatus,
  onSendPacket,
  onLoadToByteEditor,
}) {
  const [timingByte, setTimingByte] = useState(0x0f);
  const [colorFormat, setColorFormat] = useState('0f');
  const [colorCount, setColorCount] = useState(2);
  const [colors, setColors] = useState(() => defaultColors(2));
  const [tailRaw, setTailRaw] = useState('58 F4 48 82 D1 46 02 08 D0 65 00');
  const [omitDupes, setOmitDupes] = useState(true);
  const [selectedTailIdx, setSelectedTailIdx] = useState(0);
  const [sendWaitMs, setSendWaitMs] = useState(1000);
  const [sendingAll, setSendingAll] = useState(false);
  const [vibration, setVibration] = useState(null);
  const [envelope, setEnvelope] = useState('e1');
  const [copyMsg, setCopyMsg] = useState('');
  const sendAllGen = useRef(0);

  const palOpts = mbPaletteOptions();
  const isRgb = colorFormat === 'd2';
  const activeColors = colors.slice(0, colorCount);

  const parsedList = useMemo(() => parseTailList(tailRaw), [tailRaw]);
  const displayTails = useMemo(
    () => (omitDupes ? omitConsecutiveDuplicateTails(parsedList.tails) : parsedList.tails),
    [omitDupes, parsedList.tails],
  );
  const safeIdx = displayTails.length ? Math.min(selectedTailIdx, displayTails.length - 1) : 0;
  const activeTail = displayTails[safeIdx] || null;
  const tailBytes = activeTail?.bytes ?? [];

  const assembled = assembleTailPayload({
    timingByte,
    colorFormat,
    colors: activeColors,
    tailBytes,
    vibration,
    envelope,
  });

  const assembleForTail = (bytes) => assembleTailPayload({
    timingByte,
    colorFormat,
    colors: activeColors,
    tailBytes: bytes,
    vibration,
    envelope,
  });

  const setColorCountSafe = (n) => {
    const count = Math.max(1, Math.min(5, n));
    setColorCount(count);
    setColors((prev) => {
      if (prev.length >= count) return prev;
      return [...prev, ...defaultColors(count - prev.length)];
    });
  };

  const patchColor = (idx, patch) => {
    setColors((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const setFormat = (fmt) => {
    setColorFormat(fmt);
    const kind = fmt === 'd2' ? 'rgb' : 'palette';
    setColors((prev) => prev.map((c) => ({ ...c, kind })));
  };

  const applyTailPaste = (text) => {
    setTailRaw(text);
    setSelectedTailIdx(0);
  };

  const sendAssembled = async (bytes, label) => {
    if (!bytes?.length) return false;
    const ok = await onSendPacket?.(bytes);
    if (ok && label) onStatus?.(label);
    return ok;
  };

  const handleSend = async () => {
    const n = displayTails.length;
    const label = n > 1 ? `Sent tail ${safeIdx + 1}/${n}` : undefined;
    await sendAssembled(assembled.bytes, label);
  };

  const handleSendRow = async (idx) => {
    const tail = displayTails[idx];
    if (!tail) return;
    setSelectedTailIdx(idx);
    const pkt = assembleForTail(tail.bytes);
    await sendAssembled(pkt.bytes, `Sent tail ${idx + 1}/${displayTails.length}`);
  };

  const handleStepNext = async () => {
    if (!displayTails.length) return;
    const next = safeIdx + 1;
    if (next >= displayTails.length) {
      onStatus?.('End of tail list — click a row to start over');
      return;
    }
    setSelectedTailIdx(next);
    const pkt = assembleForTail(displayTails[next].bytes);
    await sendAssembled(pkt.bytes, `Sent tail ${next + 1}/${displayTails.length}`);
  };

  const handleSendAll = async () => {
    if (!displayTails.length || sendingAll) return;
    const gen = ++sendAllGen.current;
    setSendingAll(true);
    try {
      for (let i = 0; i < displayTails.length; i++) {
        if (sendAllGen.current !== gen) return;
        setSelectedTailIdx(i);
        const pkt = assembleForTail(displayTails[i].bytes);
        await sendAssembled(pkt.bytes);
        if (sendAllGen.current !== gen) return;
        if (i < displayTails.length - 1) await sleep(sendWaitMs);
      }
      if (sendAllGen.current === gen) {
        onStatus?.(`Sent all ${displayTails.length} tails`);
      }
    } finally {
      if (sendAllGen.current === gen) setSendingAll(false);
    }
  };

  const stopSendAll = () => {
    sendAllGen.current += 1;
    setSendingAll(false);
    onStatus?.('Stopped tail send-all');
  };

  const handleCopy = async () => {
    const text = tailBytesToDisplayHex(assembled.bytes);
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg('Copied');
      onStatus?.('Copied assembled hex');
      setTimeout(() => setCopyMsg(''), 1500);
    } catch {
      onStatus?.('Clipboard copy failed');
    }
  };

  const omitted = parsedList.tails.length - displayTails.length;
  const listDesc = displayTails.length
    ? `${displayTails.length} tail${displayTails.length === 1 ? '' : 's'}`
      + (parsedList.tails.length !== displayTails.length ? ` (${parsedList.tails.length} lines, ${omitted} consecutive dupe${omitted === 1 ? '' : 's'} omitted)` : '')
      + (parsedList.skipped ? `, ${parsedList.skipped} skipped` : '')
      + (displayTails.length > 1 ? ` — selected #${safeIdx + 1} (${tailBytes.length} bytes)` : ` (${tailBytes.length} bytes)`)
    : 'No tails parsed';

  return (
    <Stack gap="md">
      <Field label="Timing byte">
        <TailTimingEditor timingByte={timingByte} onChange={setTimingByte} />
      </Field>

      <Field label="Color format">
        <SearchableSelect
          value={colorFormat}
          allowEmpty={false}
          onChange={(v) => setFormat(v || '0f')}
          options={TAIL_BUILDER_COLOR_FORMATS.map((o) => ({
            value: o.value,
            label: o.label,
            searchText: o.label,
          }))}
        />
      </Field>

      <Field label="Color count">
        <SegmentedControl
          size="xs"
          value={String(colorCount)}
          onChange={(v) => setColorCountSafe(parseInt(v, 10))}
          data={['1', '2', '3', '4', '5']}
        />
      </Field>

      <Stack gap="xs">
        {activeColors.map((c, idx) => {
          const swatch = isRgb
            ? `rgb(${Number(c.r ?? 0)}, ${Number(c.g ?? 0)}, ${Number(c.b ?? 0)})`
            : (DEFAULT_MB_WLED_COLORS[c.paletteIdx ?? 0] || '#000');
          return (
            <Group key={idx} gap="xs" align="flex-end" wrap="wrap">
              <Text size="xs" c="dimmed" w={52} pb={6}>
                Color {idx + 1}
              </Text>
              <ColorSwatchBox background={swatch} />
              {isRgb ? (
                <>
                  {['r', 'g', 'b'].map((ch) => (
                    <Field key={ch} label={ch.toUpperCase()} style={{ marginBottom: 0, flex: '1 1 72px' }}>
                      <NumberInput
                        size="xs"
                        min={0}
                        max={255}
                        value={c[ch] ?? 0}
                        onChange={(v) =>
                          patchColor(idx, { [ch]: Math.max(0, Math.min(255, Number(v) || 0)) })
                        }
                      />
                    </Field>
                  ))}
                </>
              ) : (
                <>
                  <Field label="Palette" style={{ marginBottom: 0, flex: '1 1 180px' }}>
                    <SearchableSelect
                      value={String(c.paletteIdx ?? 0)}
                      allowEmpty={false}
                      onChange={(v) => patchColor(idx, { paletteIdx: parseInt(v, 10) || 0 })}
                      options={palOpts}
                    />
                  </Field>
                  <Field label="Mask (0–7)" style={{ marginBottom: 0, flex: '0 1 88px' }}>
                    <NumberInput
                      size="xs"
                      min={0}
                      max={7}
                      value={c.mask ?? 0}
                      onChange={(v) =>
                        patchColor(idx, { mask: Math.max(0, Math.min(7, Number(v) || 0)) })
                      }
                    />
                  </Field>
                </>
              )}
            </Group>
          );
        })}
      </Stack>

      <Field
        label="Tail bytes"
        description={listDesc}
      >
        <Group gap={6} mb={6} wrap="wrap">
          {TAIL_TEMPLATES.map((t) => (
            <Button key={t.id} size="compact-xs" variant="default" onClick={() => applyTailPaste(t.hex)}>
              {t.label}
            </Button>
          ))}
        </Group>
        <Textarea
          autosize
          minRows={4}
          ff="monospace"
          value={tailRaw}
          onChange={(e) => setTailRaw(e.currentTarget.value)}
          placeholder={'0x30\t0x7B\t0x02\n0x58\t0xF4\t0x48\t0x82\t0xD1\t0x46\nor FF FF FF FF / FFFFFFFF'}
          styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
        />
        <Checkbox
          mt={8}
          size="xs"
          label="Omit consecutive identical tails"
          checked={omitDupes}
          onChange={(e) => {
            setOmitDupes(e.currentTarget.checked);
            setSelectedTailIdx(0);
          }}
        />
      </Field>

      {displayTails.length > 1 && (
        <Table.ScrollContainer minWidth={480}>
          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={36}>#</Table.Th>
                <Table.Th>Tail hex</Table.Th>
                <Table.Th w={48}>Len</Table.Th>
                <Table.Th w={88} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {displayTails.map((t, i) => {
                const isSelected = i === safeIdx;
                return (
                  <Table.Tr
                    key={`${t.hex}-${i}`}
                    onClick={() => setSelectedTailIdx(i)}
                    style={{
                      cursor: 'pointer',
                      background: isSelected
                        ? 'color-mix(in srgb, var(--mantine-color-teal-filled) 14%, transparent)'
                        : undefined,
                    }}
                  >
                    <Table.Td>
                      <Text size="xs" c="dimmed">{i + 1}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        {isSelected && <Badge size="xs" color="teal" variant="light">Selected</Badge>}
                        <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>
                          {t.displayHex}
                        </Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace">{t.bytes.length}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="compact-xs"
                        variant="light"
                        color="teal"
                        disabled={!simIp || sendingAll}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleSendRow(i);
                        }}
                      >
                        Send
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Field label="Vibration">
        <SearchableSelect
          value={vibration == null ? 'none' : String(vibration)}
          allowEmpty={false}
          onChange={(v) => setVibration(parseVibrationValue(v))}
          options={VIBRATION_OPTIONS}
          placeholder="None (omit byte)"
        />
      </Field>

      <Field label="Envelope">
        <SegmentedControl
          size="xs"
          value={envelope}
          onChange={setEnvelope}
          data={[
            { value: 'e1', label: 'E1' },
            { value: 'e2', label: 'E2' },
          ]}
        />
      </Field>

      <Stack gap={4}>
        <Text size="xs" fw={600} tt="uppercase" c="dimmed">
          Assembled payload
        </Text>
        <Text size="sm" ff="monospace" style={{ wordBreak: 'break-all' }}>
          {tailBytesToDisplayHex(assembled.bytes) || '(empty)'}
        </Text>
        <Text size="xs" ff="monospace" c="dimmed">
          Derived sub-opcode: 0x{assembled.subOpcodeHex} (packet length: {assembled.bytes.length} bytes)
        </Text>
        {assembled.warnings.map((w) => (
          <Text key={w} size="xs" c="yellow.6">
            {w}
          </Text>
        ))}
      </Stack>

      <Group gap="xs" wrap="wrap" align="flex-end">
        <Button onClick={handleSend} disabled={!simIp || assembled.bytes.length === 0 || sendingAll}>
          Send{displayTails.length > 1 ? ` #${safeIdx + 1}` : ''}
        </Button>
        {displayTails.length > 1 && (
          <>
            <Button
              variant="default"
              onClick={handleStepNext}
              disabled={!simIp || sendingAll || safeIdx + 1 >= displayTails.length}
            >
              Step next
            </Button>
            {sendingAll ? (
              <Button color="red" variant="light" onClick={stopSendAll}>
                Stop send-all
              </Button>
            ) : (
              <Button variant="default" onClick={handleSendAll} disabled={!simIp}>
                Send all
              </Button>
            )}
            <NumberInput
              label="Wait (ms)"
              size="xs"
              w={110}
              min={50}
              max={60000}
              step={50}
              value={sendWaitMs}
              onChange={(v) => setSendWaitMs(Math.max(50, Number(v) || 1000))}
              disabled={sendingAll}
            />
          </>
        )}
        <Button
          variant="default"
          onClick={() => onLoadToByteEditor?.(assembled.bytes)}
          disabled={assembled.bytes.length === 0}
        >
          Load into byte editor
        </Button>
        <Button variant="default" onClick={handleCopy} disabled={assembled.bytes.length === 0}>
          {copyMsg || 'Copy hex'}
        </Button>
      </Group>
    </Stack>
  );
}
