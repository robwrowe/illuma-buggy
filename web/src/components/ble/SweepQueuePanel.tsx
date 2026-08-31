import { useCallback, useState } from 'react';
import {
  Button,
  Checkbox,
  Collapse,
  Group,
  NumberInput,
  Stack,
  Table,
  Text,
  Textarea,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { parsePasteToPackets } from '../../lib/ble/captureImport';
import { payloadToShowHex } from '../../lib/ble/wandSimClient';
import { runSweepQueueAdder, useSweepQueue } from '../../lib/ble/sweepQueue';
import { useWandLabUiState } from '../../lib/ble/wandLabUiState';
import {
  DEFAULT_OBSERVE_HOLD_MS,
  observe,
  wandsimUrlFromIp,
} from '../../lib/ble/waveClassifierClient';
import { useWaveClassifierBackend } from '../../lib/ble/useWaveClassifierBackend';
import { WaveClassifierObserveResults } from './WaveClassifierObserveResults';

const LARGE_SWEEP_WARN = 30;

function truncateHex(hex) {
  const s = String(hex || '');
  if (s.length <= 28) return s;
  return `${s.slice(0, 28)}…`;
}

export function SweepQueuePanel({
  simIp = '',
  labTab = '',
  onStatus,
}) {
  const { items, add, remove, clear, move } = useSweepQueue();
  const [open, setOpen] = useWandLabUiState('sweepQueue.open', true);
  const [pasteText, setPasteText] = useState('');
  const [holdMs, setHoldMs] = useWandLabUiState('sweepQueue.holdMs', DEFAULT_OBSERVE_HOLD_MS);
  const [timeline, setTimeline] = useWandLabUiState('sweepQueue.timeline', true);
  const [calibrate, setCalibrate] = useWandLabUiState('sweepQueue.calibrate', true);
  const [blackFlash, setBlackFlash] = useWandLabUiState('sweepQueue.blackFlash', true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [reports, setReports] = useState([]);
  const [reportCsv, setReportCsv] = useState('');
  const [reportMd, setReportMd] = useState('');
  const [reportJson, setReportJson] = useState('');
  const wc = useWaveClassifierBackend();

  const addCurrent = useCallback(() => {
    const n = runSweepQueueAdder(labTab);
    if (n > 0) {
      onStatus?.(`Added ${n} packet${n === 1 ? '' : 's'} to sweep queue`);
      setError('');
    } else {
      setError('Nothing to add from this tab — paste hex below or use Add to sweep queue on Tail Builder, Packet Sequence, or Bit Grid.');
    }
  }, [labTab, onStatus]);

  const addPaste = () => {
    const result = parsePasteToPackets(pasteText, { strip8301: true });
    if (!result.ok || !result.packets.length) {
      setError(result.message || 'No packets parsed');
      return;
    }
    const queued = result.packets.map((p, i) => ({
      hex_full: payloadToShowHex(p.bytes).toUpperCase(),
      label: p.label || `paste-${i + 1}`,
      source: 'manual',
      provenance: p.label || `pasted line ${i + 1}`,
    }));
    add(queued);
    setPasteText('');
    setError('');
    onStatus?.(`Queued ${queued.length} pasted packet${queued.length === 1 ? '' : 's'}`);
  };

  const runSweep = async () => {
    setError('');
    const wandsim = wandsimUrlFromIp(simIp);
    if (!wandsim) {
      const msg = 'Set Simulator IP first — Run Sweep drives the same board as Send';
      setError(msg);
      onStatus?.(msg);
      return;
    }
    let ready = wc.available;
    if (!ready) ready = await wc.refresh();
    if (!ready) {
      setError(wc.disabledTip);
      onStatus?.(wc.disabledTip);
      return;
    }
    if (!items.length) {
      setError('Sweep queue is empty');
      return;
    }
    const payloads = items.map((it) => ({
      hex_full: it.hex_full,
      label: it.label || it.provenance || it.id,
      tail_index: it.tail_index,
      color_count: it.color_count,
      expected_colors: it.expected_colors,
    }));
    setRunning(true);
    onStatus?.('Run Sweep — if Calibrate is on, WandSim runs 29 palette solids first…');
    try {
      const hold = Math.max(500, Number(holdMs) || DEFAULT_OBSERVE_HOLD_MS);
      const res = await observe(wc.baseUrl, {
        payloads,
        hold_ms: hold,
        zone_layout: 'auto',
        base_url: wandsim,
        timeline: !!timeline,
        calibrate: !!calibrate,
        black_flash_ms: blackFlash ? 150 : 0,
        onChunk: (i, n) => {
          if (n > 1) onStatus?.(`Run Sweep batch ${i + 1}/${n}…`);
        },
      });
      const nextReports = (res?.reports || []).map((r, i) => ({
        ...r,
        effect_label: r.effect_label || payloads[i]?.label || `#${i + 1}`,
      }));
      setReports(nextReports);
      setReportCsv(res?.report_csv || '');
      setReportMd(res?.report_md || '');
      setReportJson(res?.report_json || '');
      const fileNote = res?.report_md ? ` → ${res.report_md}` : '';
      onStatus?.(`Run Sweep done — ${nextReports.length} result${nextReports.length === 1 ? '' : 's'}${fileNote}`);
    } catch (e) {
      const msg = e.message || 'Run Sweep failed';
      setError(msg);
      onStatus?.(msg);
    } finally {
      setRunning(false);
    }
  };

  const runDisabledReason = !simIp
    ? 'Set Simulator IP first — Run Sweep drives the same board as Send'
    : !wc.available
      ? wc.disabledTip
      : !items.length
        ? 'Queue is empty'
        : '';

  return (
    <Stack gap={6}>
      <UnstyledButton onClick={() => setOpen((v) => !v)} style={{ width: '100%', textAlign: 'left' }}>
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Text size="xs" fw={700}>
            Sweep queue{items.length ? ` (${items.length})` : ''}
          </Text>
          <Text size="xs" c="dimmed">
            {open ? 'Hide ▴' : 'Show ▾'}
          </Text>
        </Group>
      </UnstyledButton>
      <Collapse expanded={!!open}>
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            Accumulate packets from any tab, then Run Sweep once for a single csv/md/json bundle.
            Per-tab Observe still writes its own bundle.
          </Text>
          <Group gap="xs" wrap="wrap" align="flex-end">
            <Button size="compact-xs" variant="default" onClick={addCurrent}>
              Add current packet(s)
            </Button>
            <NumberInput
              label="Capture (ms)"
              size="xs"
              w={120}
              min={500}
              max={30000}
              step={500}
              value={holdMs}
              onChange={(v) => setHoldMs(Math.max(500, Number(v) || DEFAULT_OBSERVE_HOLD_MS))}
              disabled={running}
            />
            <Tooltip label={runDisabledReason || (timeline ? 'Capture a per-tick color timeline for the whole queue' : 'Capture and classify the whole queue as one run')}>
              <span>
                <Button
                  size="compact-xs"
                  color="violet"
                  loading={running}
                  disabled={!!runDisabledReason || running}
                  onClick={() => void runSweep()}
                >
                  Run Sweep
                </Button>
              </span>
            </Tooltip>
            <Checkbox
              size="xs"
              label="Timeline"
              checked={!!timeline}
              onChange={(e) => setTimeline(e.currentTarget.checked)}
              disabled={running}
            />
            <Checkbox
              size="xs"
              label="Calibrate palette"
              checked={!!calibrate}
              onChange={(e) => setCalibrate(e.currentTarget.checked)}
              disabled={running}
            />
            <Checkbox
              size="xs"
              label="Black flash"
              checked={!!blackFlash}
              onChange={(e) => setBlackFlash(e.currentTarget.checked)}
              disabled={running}
            />
            <Button size="compact-xs" variant="subtle" color="red" onClick={clear} disabled={!items.length || running}>
              Clear queue
            </Button>
          </Group>
          {items.length > LARGE_SWEEP_WARN ? (
            <Text size="xs" c="yellow.6">
              Large sweep ({items.length} packets) — consider `run --builder-trials` on the CLI for resumability.
            </Text>
          ) : null}
          <Textarea
            size="xs"
            minRows={2}
            placeholder="Paste hex lines, capture rows, or timed show steps…"
            value={pasteText}
            onChange={(e) => setPasteText(e.currentTarget.value)}
            disabled={running}
          />
          <Button
            size="compact-xs"
            variant="default"
            onClick={addPaste}
            disabled={!pasteText.trim() || running}
            w="fit-content"
          >
            Add pasted hex
          </Button>
          {items.length ? (
            <Table.ScrollContainer minWidth={480}>
              <Table striped withTableBorder withColumnBorders highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Label</Table.Th>
                    <Table.Th>Provenance</Table.Th>
                    <Table.Th>Hex</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {items.map((it, i) => (
                    <Table.Tr key={it.id}>
                      <Table.Td>
                        <Text size="xs" ff="monospace">{it.label || '—'}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">{it.provenance || it.source || '—'}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" ff="monospace">{truncateHex(it.hex_full)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            disabled={i === 0 || running}
                            onClick={() => move(it.id, -1)}
                          >
                            ↑
                          </Button>
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            disabled={i === items.length - 1 || running}
                            onClick={() => move(it.id, 1)}
                          >
                            ↓
                          </Button>
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            color="red"
                            disabled={running}
                            onClick={() => remove(it.id)}
                          >
                            ✕
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          ) : (
            <Text size="xs" c="dimmed">Queue is empty.</Text>
          )}
          {error ? <Text size="xs" c="red">{error}</Text> : null}
          {(running || reports.length > 0) && (
            <Stack gap={4}>
              <Text size="xs" fw={600} tt="uppercase" c="dimmed">Sweep results</Text>
              <WaveClassifierObserveResults
                reports={reports}
                reportCsv={reportCsv}
                reportMd={reportMd}
                reportJson={reportJson}
                backendUrl={wc.baseUrl}
                mode={timeline ? 'timeline' : 'classify'}
              />
            </Stack>
          )}
        </Stack>
      </Collapse>
    </Stack>
  );
}
