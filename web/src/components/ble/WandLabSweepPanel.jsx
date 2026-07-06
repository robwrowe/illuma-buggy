import { useState } from 'react';
import {
  Button,
  Checkbox,
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
import { MB_PAL_OFF } from '../../lib/ble/mbConstants';
import { buildMbSingle } from '../../lib/ble/mbPayloads';
import { useShowProgress } from '../../hooks/useShowProgress';

const MB_OFF_BYTES = buildMbSingle(MB_PAL_OFF);

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
  const [offBetween, setOffBetween] = useState(false);
  const [offWaitMs, setOffWaitMs] = useState(1000);
  const [sweepValues, setSweepValues] = useState([]);
  const [sweepOffBetween, setSweepOffBetween] = useState(false);
  const [sweepNote, setSweepNote] = useState('');
  const [showSweepLog, setShowSweepLog] = useState(false);
  const { progress, startPolling, stop } = useShowProgress(simIp);

  const running = progress?.active;
  const step = progress?.step ?? 0;
  const isOffStep = running && sweepOffBetween && step > 0 && step % 2 === 0;
  const currentVal = running && sweepValues.length && step > 0 && !isOffStep
    ? sweepValues[Math.min(Math.floor((step - 1) / (sweepOffBetween ? 2 : 1)), sweepValues.length - 1)]
    : null;

  const liveHex = isOffStep
    ? payloadToShowHex(MB_OFF_BYTES)
    : currentVal != null && sweepIndex != null && bytes?.length
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

    const offOpts = offBetween
      ? { offBytes: MB_OFF_BYTES, offWaitMs }
      : null;
    const { body, values } = buildShowBodyFromSweep(
      bytes, sweepIndex, start, end, step, dwellMs, undefined, offOpts,
    );
    if (!values.length) { onStatus?.('Empty sweep range'); return; }

    setSweepValues(values);
    setSweepOffBetween(!!offOpts);
    try {
      await startShow(ip, body);
      const stepCount = offOpts ? values.length * 2 - 1 : values.length;
      onStatus?.(
        `Sweep started: ${values.length} values${offOpts ? ` + off between (${stepCount} steps)` : ''} at byte ${sweepIndex}`,
      );
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
      {opened && (
        <Stack gap={4}>
          <Checkbox
            label="All-off (E905 palette 29) between values"
            checked={offBetween}
            onChange={(e) => setOffBetween(e.currentTarget.checked)}
            size="xs"
          />
          {offBetween && (
            <NumberInput
              label="Off wait (ms)"
              description="Hold after off command before next sweep value"
              value={offWaitMs}
              onChange={(v) => setOffWaitMs(Number(v) || 1000)}
              min={50}
              size="xs"
              maw={200}
            />
          )}
        </Stack>
      )}
      {running && liveHex && (
        <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>
          Live: {liveHex.toUpperCase()}
          {isOffStep
            ? ` (off, ${step} / ${progress?.total ?? 0})`
            : currentVal != null
              && ` (0x${currentVal.toString(16).padStart(2, '0').toUpperCase()}, ${step} / ${progress?.total ?? 0})`}
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
              const offPart = offBetween ? `, off between (${offWaitMs}ms)` : '';
              const note = sweepNote.trim()
                || `Sweep byte ${sweepIndex}: 0x${startHex}–0x${endHex} step 0x${stepHex}, ${dwellMs}ms dwell${offPart}`;
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
