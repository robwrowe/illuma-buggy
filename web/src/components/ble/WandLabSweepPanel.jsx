import { useState } from 'react';
import {
  Button,
  Group,
  NumberInput,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  buildShowBodyFromSweep,
  bytesToHex,
  payloadToShowHex,
  startShow,
} from '../../lib/ble/wandSimClient';
import { useShowProgress } from '../../hooks/useShowProgress';

function parseHexByte(s) {
  const n = parseInt(String(s).replace(/[^0-9a-fA-F]/g, ''), 16);
  return Number.isNaN(n) ? 0 : n & 0xff;
}

export function WandLabSweepPanel({
  simIp,
  bytes,
  sweepIndex,
  onSweepIndexChange,
  onStatus,
  onSweepComplete,
}) {
  const [opened, { toggle }] = useDisclosure(false);
  const [startHex, setStartHex] = useState('00');
  const [endHex, setEndHex] = useState('FF');
  const [stepHex, setStepHex] = useState('01');
  const [dwellMs, setDwellMs] = useState(3000);
  const [sweepValues, setSweepValues] = useState([]);
  const [sweepNote, setSweepNote] = useState('');
  const [showSweepLog, setShowSweepLog] = useState(false);
  const { progress, startPolling, stop } = useShowProgress(simIp);

  const running = progress?.active;
  const currentVal = running && sweepValues.length && progress?.step > 0
    ? sweepValues[Math.min(progress.step - 1, sweepValues.length - 1)]
    : null;

  const liveHex = currentVal != null && sweepIndex != null && bytes?.length
    ? payloadToShowHex(bytes.map((b, i) => (i === sweepIndex ? currentVal : b)))
    : bytes?.length
      ? payloadToShowHex(bytes)
      : '';

  const handleRun = async () => {
    const ip = (simIp || '').trim();
    if (ip === '') { onStatus?.('Set simulator IP first'); return; }
    if (sweepIndex == null) { onStatus?.('Click a byte index to set sweep target'); return; }
    if (!bytes?.length) { onStatus?.('No bytes to sweep'); return; }

    const start = parseHexByte(startHex);
    const end = parseHexByte(endHex);
    const step = Math.max(1, parseHexByte(stepHex) || 1);

    const { body, values } = buildShowBodyFromSweep(bytes, sweepIndex, start, end, step, dwellMs);
    if (!values.length) { onStatus?.('Empty sweep range'); return; }

    setSweepValues(values);
    try {
      await startShow(ip, body);
      onStatus?.(`Sweep started: ${values.length} values at byte ${sweepIndex}`);
      startPolling(() => {
        setShowSweepLog(true);
        setSweepNote('');
        onStatus?.('Sweep finished or stopped');
      });
    } catch (e) {
      onStatus?.(e.message || 'Sweep failed');
    }
  };

  return (
    <Stack gap="xs" mt="sm">
      <Group justify="space-between">
        <Text size="xs" c="dimmed" fw={600} tt="uppercase">Byte sweep</Text>
        <Button size="compact-xs" variant="subtle" onClick={toggle}>
          {opened ? 'Hide' : sweepIndex != null ? `Target: byte ${sweepIndex}` : 'Set target'}
        </Button>
      </Group>
      {sweepIndex != null && (
        <Text size="xs" c="violet">
          Sweep target: byte {sweepIndex} — click another index label to change
        </Text>
      )}
      {opened && (
        <Group grow wrap="wrap" align="flex-end">
          <TextInput label="Start" value={startHex} onChange={(e) => setStartHex(e.target.value)} size="xs" />
          <TextInput label="End" value={endHex} onChange={(e) => setEndHex(e.target.value)} size="xs" />
          <TextInput label="Step" value={stepHex} onChange={(e) => setStepHex(e.target.value)} size="xs" />
          <NumberInput
            label="Dwell / value (ms)"
            value={dwellMs}
            onChange={(v) => setDwellMs(Number(v) || 3000)}
            min={100}
            size="xs"
          />
        </Group>
      )}
      {running && liveHex && (
        <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>
          Live: {liveHex.toUpperCase()}
          {currentVal != null && ` (0x${currentVal.toString(16).padStart(2, '0').toUpperCase()}, ${progress?.step ?? 0} / ${progress?.total ?? 0})`}
        </Text>
      )}
      {opened && (
        <Group gap="xs">
          {!running ? (
            <Button size="xs" onClick={handleRun} disabled={sweepIndex == null}>
              Run sweep
            </Button>
          ) : (
            <Button size="xs" color="red" variant="light" onClick={() => stop()}>
              Stop sweep
            </Button>
          )}
          {sweepIndex != null && (
            <Button size="xs" variant="subtle" onClick={() => onSweepIndexChange?.(null)}>
              Clear target
            </Button>
          )}
        </Group>
      )}
      {showSweepLog && !running && sweepValues.length > 0 && (
        <Stack gap={4}>
          <TextInput
            size="xs"
            placeholder="Overall observation (e.g. class changes around 0x20)"
            value={sweepNote}
            onChange={(e) => setSweepNote(e.target.value)}
          />
          <Button
            size="xs"
            variant="light"
            onClick={() => {
              const note = sweepNote.trim()
                || `Sweep byte ${sweepIndex}: 0x${startHex}–0x${endHex} step 0x${stepHex}, ${dwellMs}ms dwell`;
              onSweepComplete?.({
                note,
                presetKey: `sweep:b${sweepIndex}`,
                bytes: bytesToHex(bytes),
              });
              setShowSweepLog(false);
              setSweepNote('');
            }}
          >
            Save sweep summary log
          </Button>
        </Stack>
      )}
    </Stack>
  );
}

/** Clickable byte index for sweep target selection. */
export function SweepByteIndex({ index, isModified, isSweepTarget, onSelect }) {
  const borderColor = isSweepTarget ? 'var(--mantine-color-yellow-5)' : isModified ? 'var(--primary)' : 'var(--border)';
  const bg = isSweepTarget ? '#f59e0b22' : isModified ? 'var(--primary-dim)' : 'var(--surface2)';

  return (
    <button
      type="button"
      onClick={() => onSelect(index)}
      style={{
        fontSize: 10,
        color: 'var(--text3)',
        marginRight: 4,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        textDecoration: isSweepTarget ? 'underline' : 'none',
      }}
      title="Set as sweep target"
    >
      <span style={{
        display: 'inline-block',
        padding: '1px 4px',
        borderRadius: 4,
        border: `1px solid ${borderColor}`,
        background: bg,
      }}>
        {index}
      </span>
    </button>
  );
}
