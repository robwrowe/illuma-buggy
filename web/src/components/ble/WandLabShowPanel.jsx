import { useState } from 'react';
import { Button, Group, NumberInput, Stack, Text } from '@mantine/core';
import {
  buildShowBodyFromPayloadRepeats,
  startShow,
} from '../../lib/ble/wandSimClient';
import { useShowProgress } from '../../hooks/useShowProgress';

export function WandLabShowPanel({
  simIp,
  bytes,
  onStatus,
  onBurstComplete,
}) {
  const [repeatCount, setRepeatCount] = useState(1);
  const [dwellMs, setDwellMs] = useState(1000);
  const [burstNote, setBurstNote] = useState('');
  const [showBurstLog, setShowBurstLog] = useState(false);
  const { progress, startPolling, stop } = useShowProgress(simIp);

  const running = progress?.active;

  const handleStart = async () => {
    const ip = (simIp || '').trim();
    if (!ip) { onStatus?.('Set simulator IP first'); return; }
    if (!bytes?.length) { onStatus?.('No bytes to repeat'); return; }
    try {
      const body = buildShowBodyFromPayloadRepeats(bytes, repeatCount, dwellMs);
      await startShow(ip, body);
      onStatus?.(`Burst started: ${repeatCount}× via /show`);
      startPolling((st) => {
        if (st && !st.showActive) {
          setShowBurstLog(true);
          setBurstNote(`Burst via /show: ${repeatCount} reps, ${dwellMs}ms dwell`);
          onStatus?.(st.showStep >= repeatCount ? 'Burst complete' : 'Burst stopped early');
          onBurstComplete?.({
            note: `Burst via /show: ${repeatCount} reps, ${dwellMs}ms dwell`,
            presetKey: 'burst',
          });
        }
      });
    } catch (e) {
      onStatus?.(e.message || 'Burst failed');
    }
  };

  const handleStop = async () => {
    await stop();
    onStatus?.('Burst stopped');
  };

  return (
    <Stack gap="xs" mt="sm">
      <Text size="xs" c="dimmed" fw={600} tt="uppercase">Repeat via /show</Text>
      <Group grow wrap="wrap" align="flex-end">
        <NumberInput
          label="Repeat count"
          value={repeatCount}
          onChange={(v) => setRepeatCount(Number(v) || 1)}
          min={1}
          max={200}
          size="xs"
        />
        <NumberInput
          label="Dwell (ms)"
          value={dwellMs}
          onChange={(v) => setDwellMs(Number(v) || 1000)}
          min={50}
          max={60000}
          step={100}
          size="xs"
        />
        <Group gap="xs" wrap="nowrap">
          {!running ? (
            <Button size="xs" onClick={handleStart} disabled={!bytes?.length}>
              Start burst
            </Button>
          ) : (
            <Button size="xs" color="red" variant="light" onClick={handleStop}>
              Stop
            </Button>
          )}
        </Group>
      </Group>
      {progress && (
        <Text size="xs" c="dimmed">
          {progress.active
            ? `Step ${progress.step} / ${progress.total}`
            : progress.total
              ? `Finished at step ${progress.step} / ${progress.total}`
              : null}
        </Text>
      )}
      {showBurstLog && !running && (
        <Group gap="xs">
          <Text size="xs" c="dimmed" style={{ flex: 1 }}>{burstNote}</Text>
          <Button
            size="xs"
            variant="light"
            onClick={() => {
              onBurstComplete?.({ note: burstNote, presetKey: 'burst' });
              setShowBurstLog(false);
            }}
          >
            Log this burst
          </Button>
        </Group>
      )}
    </Stack>
  );
}
