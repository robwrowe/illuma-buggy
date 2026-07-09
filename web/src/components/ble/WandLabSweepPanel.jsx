import { useEffect, useMemo, useState } from 'react';
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
  getSweepStepPayload,
  payloadToShowHex,
  sendHex,
  startShow,
  sweepTotalSteps,
} from '../../lib/ble/wandSimClient';
import { MB_PAL_OFF } from '../../lib/ble/mbConstants';
import { buildMbSingle } from '../../lib/ble/mbPayloads';
import { useShowProgress } from '../../hooks/useShowProgress';

const MB_OFF_BYTES = buildMbSingle(MB_PAL_OFF);

function parseHexByte(s) {
  const n = parseInt(String(s).replace(/[^0-9a-fA-F]/g, ''), 16);
  return Number.isNaN(n) ? 0 : n & 0xff;
}

function sweepStepLabel(stepIdx, values, offBetween) {
  if (offBetween && stepIdx % 2 === 1) return 'off';
  const valIdx = offBetween ? Math.floor(stepIdx / 2) : stepIdx;
  const val = values[valIdx];
  return val != null ? `0x${val.toString(16).padStart(2, '0').toUpperCase()}` : '';
}

function formatSweepTargets(indices) {
  if (!indices?.length) return '';
  return indices.join(', ');
}

export function WandLabSweepPanel({
  simIp,
  bytes,
  sweepIndices,
  onSweepIndicesChange,
  onStatus,
  onSweepComplete,
  onLivePayloadChange,
}) {
  const [opened, { toggle }] = useDisclosure(false);
  const [startHex, setStartHex] = useState('00');
  const [endHex, setEndHex] = useState('FF');
  const [stepHex, setStepHex] = useState('01');
  const [dwellMs, setDwellMs] = useState(3000);
  const [offBetween, setOffBetween] = useState(false);
  const [offWaitMs, setOffWaitMs] = useState(1000);
  const [manualAdvance, setManualAdvance] = useState(false);
  const [sweepValues, setSweepValues] = useState([]);
  const [sweepOffBetween, setSweepOffBetween] = useState(false);
  const [manualStepIdx, setManualStepIdx] = useState(-1);
  const [sweepNote, setSweepNote] = useState('');
  const [showSweepLog, setShowSweepLog] = useState(false);
  const [lastSentPayload, setLastSentPayload] = useState(null);
  const [pending, setPending] = useState(null);
  const { progress, startPolling, stop } = useShowProgress(simIp);

  const busy = pending != null;

  const manualActive = manualStepIdx >= 0;
  const running = manualActive || progress?.active;
  const step = manualActive ? manualStepIdx + 1 : (progress?.step ?? 0);
  const totalSteps = sweepValues.length
    ? sweepTotalSteps(sweepValues, sweepOffBetween)
    : (progress?.total ?? 0);

  const isOffStep = running && sweepOffBetween && step > 0 && step % 2 === 0;
  const currentVal = running && sweepValues.length && step > 0 && !isOffStep
    ? sweepValues[Math.min(Math.floor((step - 1) / (sweepOffBetween ? 2 : 1)), sweepValues.length - 1)]
    : null;

  const livePayload = useMemo(() => {
    if (!running || !sweepValues.length || step <= 0) return null;
    return getSweepStepPayload(
      bytes,
      sweepIndices,
      sweepValues,
      step - 1,
      sweepOffBetween,
      MB_OFF_BYTES,
    );
  }, [running, sweepValues, step, sweepOffBetween, bytes, sweepIndices]);

  const liveHex = livePayload?.length
    ? payloadToShowHex(livePayload)
    : bytes?.length
      ? payloadToShowHex(bytes)
      : '';

  useEffect(() => {
    if (!livePayload?.length) {
      if (!manualActive && !progress?.active) onLivePayloadChange?.(null);
      return;
    }
    onLivePayloadChange?.(livePayload);
    setLastSentPayload(livePayload);
  }, [livePayload, manualActive, progress?.active, onLivePayloadChange]);

  useEffect(() => () => onLivePayloadChange?.(null), [onLivePayloadChange]);

  const buildSweepPlan = () => {
    const start = parseHexByte(startHex);
    const end = parseHexByte(endHex);
    const step = Math.max(1, parseHexByte(stepHex) || 1);
    const offOpts = offBetween
      ? { offBytes: MB_OFF_BYTES, offWaitMs }
      : null;
    return buildShowBodyFromSweep(
      bytes, sweepIndices, start, end, step, dwellMs, undefined, offOpts,
    );
  };

  const validateSweep = () => {
    const ip = (simIp || '').trim();
    if (ip === '') { onStatus?.('Set simulator IP first'); return null; }
    if (!sweepIndices?.length) { onStatus?.('Click byte index labels to set sweep targets'); return null; }
    if (!bytes?.length) { onStatus?.('No bytes to sweep'); return null; }
    const { body, values } = buildSweepPlan();
    if (!values.length) { onStatus?.('Empty sweep range'); return null; }
    return { ip, body, values, offOpts: offBetween ? { offBytes: MB_OFF_BYTES, offWaitMs } : null };
  };

  const sendManualStep = async (stepIdx, plan, { updateIndex = true, actionLabel } = {}) => {
    const payload = getSweepStepPayload(
      bytes,
      sweepIndices,
      plan.values,
      stepIdx,
      !!plan.offOpts,
      MB_OFF_BYTES,
    );
    if (!payload.length) return;
    await sendHex(plan.ip, payload);
    if (updateIndex) setManualStepIdx(stepIdx);
    setLastSentPayload(payload);
    onLivePayloadChange?.(payload);
    const label = sweepStepLabel(stepIdx, plan.values, !!plan.offOpts);
    const total = sweepTotalSteps(plan.values, !!plan.offOpts);
    const action = actionLabel || 'sent';
    onStatus?.(`Manual sweep ${stepIdx + 1}/${total} ${action} (${label})`);
  };

  const getManualPlan = () => {
    const ip = (simIp || '').trim();
    if (ip === '' || !sweepIndices?.length || !bytes?.length || !sweepValues.length) return null;
    return {
      ip,
      values: sweepValues,
      offOpts: sweepOffBetween ? { offBytes: MB_OFF_BYTES, offWaitMs } : null,
    };
  };

  const handleRunManual = async () => {
    if (busy) return;
    const plan = validateSweep();
    if (!plan) return;
    setSweepValues(plan.values);
    setSweepOffBetween(!!plan.offOpts);
    setShowSweepLog(false);
    setPending('start-manual');
    onStatus?.('Sending first sweep value…');
    try {
      await sendManualStep(0, plan);
    } catch (e) {
      setManualStepIdx(-1);
      onLivePayloadChange?.(null);
      onStatus?.(e.message || 'Manual sweep send failed');
    } finally {
      setPending(null);
    }
  };

  const handleManualPrevious = async () => {
    if (busy) return;
    const plan = getManualPlan();
    if (!plan || manualStepIdx <= 0) return;
    setPending('prev');
    onStatus?.('Sending previous value…');
    try {
      await sendManualStep(manualStepIdx - 1, plan, { actionLabel: 'previous' });
      setShowSweepLog(false);
    } catch (e) {
      onStatus?.(e.message || 'Send failed');
    } finally {
      setPending(null);
    }
  };

  const handleManualRepeat = async () => {
    if (busy) return;
    const plan = getManualPlan();
    if (!plan || manualStepIdx < 0) return;
    setPending('repeat');
    onStatus?.('Re-sending current value…');
    try {
      await sendManualStep(manualStepIdx, plan, { updateIndex: false, actionLabel: 'repeated' });
    } catch (e) {
      onStatus?.(e.message || 'Send failed');
    } finally {
      setPending(null);
    }
  };

  const handleManualNext = async () => {
    if (busy) return;
    const plan = getManualPlan();
    if (!plan || manualStepIdx < 0) return;
    const total = sweepTotalSteps(plan.values, !!plan.offOpts);
    const next = manualStepIdx + 1;
    if (next >= total) {
      setShowSweepLog(true);
      onStatus?.('Manual sweep complete');
      return;
    }
    setPending('next');
    onStatus?.('Sending next value…');
    try {
      await sendManualStep(next, plan);
      setShowSweepLog(false);
      if (next >= total - 1) setShowSweepLog(true);
    } catch (e) {
      onStatus?.(e.message || 'Send failed');
    } finally {
      setPending(null);
    }
  };

  const handleStopManual = () => {
    setManualStepIdx(-1);
    setShowSweepLog(false);
    onLivePayloadChange?.(null);
    onStatus?.('Manual sweep stopped');
  };

  const handleRunAuto = async () => {
    if (busy) return;
    const plan = validateSweep();
    if (!plan) return;

    setSweepValues(plan.values);
    setSweepOffBetween(!!plan.offOpts);
    setManualStepIdx(-1);
    setPending('run-auto');
    onStatus?.('Starting auto sweep…');
    try {
      await startShow(plan.ip, plan.body);
      const stepCount = plan.offOpts ? plan.values.length * 2 - 1 : plan.values.length;
      onStatus?.(
        `Sweep started: ${plan.values.length} values${plan.offOpts ? ` + off between (${stepCount} steps)` : ''} at byte${plan.values.length === 1 ? '' : 's'} ${formatSweepTargets(sweepIndices)}`,
      );
      startPolling(() => {
        setShowSweepLog(true);
        setSweepNote('');
        onLivePayloadChange?.(null);
        onStatus?.('Sweep finished or stopped');
      });
    } catch (e) {
      onStatus?.(e.message || 'Sweep failed');
    } finally {
      setPending(null);
    }
  };

  const handleStopAuto = async () => {
    if (busy && pending !== 'stop-auto') return;
    setPending('stop-auto');
    try {
      await stop();
      onLivePayloadChange?.(null);
      onStatus?.('Sweep stopped');
    } finally {
      setPending(null);
    }
  };

  const manualTotal = sweepValues.length ? sweepTotalSteps(sweepValues, sweepOffBetween) : 0;
  const canManualPrevious = manualActive && manualStepIdx > 0;
  const canManualRepeat = manualActive && manualStepIdx >= 0;
  const canManualNext = manualActive && manualStepIdx < manualTotal - 1;

  return (
    <Stack gap="xs" mt="sm">
      <Group justify="space-between">
        <Text size="xs" c="dimmed" fw={600} tt="uppercase">Byte sweep</Text>
        <Button size="compact-xs" variant="subtle" onClick={toggle}>
          {opened ? 'Hide' : sweepIndices?.length ? `Targets: ${formatSweepTargets(sweepIndices)}` : 'Set targets'}
        </Button>
      </Group>
      {sweepIndices?.length > 0 && (
        <Text size="xs" c="violet">
          Sweep target{sweepIndices.length === 1 ? '' : 's'}: byte {formatSweepTargets(sweepIndices)}
          {' '}— click index labels to toggle
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
            disabled={manualAdvance}
            description={manualAdvance ? 'Auto timing disabled in manual mode' : undefined}
          />
        </Group>
      )}
      {opened && (
        <Stack gap={4}>
          <Checkbox
            label="Manual advance (send each value with Next)"
            checked={manualAdvance}
            onChange={(e) => {
              setManualAdvance(e.currentTarget.checked);
              if (manualActive) handleStopManual();
            }}
            size="xs"
            disabled={progress?.active}
          />
          <Checkbox
            label="All-off (E905 palette 29) between values"
            checked={offBetween}
            onChange={(e) => setOffBetween(e.currentTarget.checked)}
            size="xs"
            disabled={running}
          />
          {offBetween && !manualAdvance && (
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
            ? ` (off, ${step} / ${totalSteps})`
            : currentVal != null
              && ` (${sweepStepLabel(step - 1, sweepValues, sweepOffBetween)}, ${step} / ${totalSteps})`}
          {busy && pending !== 'run-auto' && pending !== 'stop-auto' ? ' · sending…' : ''}
        </Text>
      )}
      {opened && (
        <Group gap="xs">
          {!running ? (
            <Button
              size="xs"
              onClick={manualAdvance ? handleRunManual : handleRunAuto}
              disabled={!sweepIndices?.length || busy}
              loading={pending === 'start-manual' || pending === 'run-auto'}
            >
              {manualAdvance ? 'Start manual sweep' : 'Run sweep'}
            </Button>
          ) : manualActive ? (
            <>
              <Button
                size="xs"
                variant="default"
                onClick={handleManualPrevious}
                disabled={!canManualPrevious || (busy && pending !== 'prev')}
                loading={pending === 'prev'}
              >
                Previous
              </Button>
              <Button
                size="xs"
                variant="default"
                onClick={handleManualRepeat}
                disabled={!canManualRepeat || (busy && pending !== 'repeat')}
                loading={pending === 'repeat'}
              >
                Repeat
              </Button>
              <Button
                size="xs"
                onClick={handleManualNext}
                disabled={!canManualNext || (busy && pending !== 'next')}
                loading={pending === 'next'}
              >
                Next value
              </Button>
              <Button
                size="xs"
                color="red"
                variant="light"
                onClick={handleStopManual}
                disabled={busy}
              >
                Stop
              </Button>
            </>
          ) : (
            <Button
              size="xs"
              color="red"
              variant="light"
              onClick={handleStopAuto}
              loading={pending === 'stop-auto'}
              disabled={busy && pending !== 'stop-auto'}
            >
              Stop sweep
            </Button>
          )}
          {sweepIndices?.length > 0 && !running && (
            <Button size="xs" variant="subtle" onClick={() => onSweepIndicesChange?.([])}>
              Clear targets
            </Button>
          )}
        </Group>
      )}
      {showSweepLog && sweepValues.length > 0 && (
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
              const modePart = manualAdvance ? ', manual advance' : '';
              const targetLabel = formatSweepTargets(sweepIndices);
              const note = sweepNote.trim()
                || `Sweep byte${sweepIndices.length === 1 ? '' : 's'} ${targetLabel}: 0x${startHex}–0x${endHex} step 0x${stepHex}, ${dwellMs}ms dwell${offPart}${modePart}`;
              onSweepComplete?.({
                note,
                presetKey: `sweep:b${targetLabel.replace(/, /g, ',')}`,
                bytes: lastSentPayload?.length ? bytesToHex(lastSentPayload) : bytesToHex(bytes),
              });
              setShowSweepLog(false);
              setSweepNote('');
              setManualStepIdx(-1);
              setLastSentPayload(null);
              onLivePayloadChange?.(null);
            }}
          >
            Save sweep summary log
          </Button>
        </Stack>
      )}
    </Stack>
  );
}

/** Clickable byte index for sweep target selection (toggle). */
export function SweepByteIndex({ index, isModified, isSweepTarget, onToggle }) {
  const borderColor = isSweepTarget ? 'var(--mantine-color-yellow-5)' : isModified ? 'var(--primary)' : 'var(--border)';
  const bg = isSweepTarget ? '#f59e0b22' : isModified ? 'var(--primary-dim)' : 'var(--surface2)';

  return (
    <button
      type="button"
      onClick={() => onToggle(index)}
      style={{
        fontSize: 10,
        color: 'var(--text3)',
        marginRight: 4,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        textDecoration: isSweepTarget ? 'underline' : 'none',
      }}
      title={isSweepTarget ? 'Remove from sweep targets' : 'Add to sweep targets'}
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
