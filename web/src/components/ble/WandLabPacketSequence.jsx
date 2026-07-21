import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { parsePasteToPackets } from '../../lib/ble/captureImport';
import {
  buildShowBodyFromPackets,
  bytesToHex,
  parseHexToBytes,
  sendHex,
  startShow,
} from '../../lib/ble/wandSimClient';
import { useShowProgress } from '../../hooks/useShowProgress';
import { generateId } from '../../lib/utils';

function emptyPacket() {
  return { id: generateId(), bytes: [], waitMs: 1000, label: '' };
}

export function WandLabPacketSequence({
  simIp,
  packets,
  setPackets,
  onStatus,
  onLoadToEditor,
  onSequenceComplete,
}) {
  const [pasteText, setPasteText] = useState('');
  const [strip8301, setStrip8301] = useState(true);
  const [defaultWaitMs, setDefaultWaitMs] = useState(1000);
  const [lastSentId, setLastSentId] = useState(null);
  const [manualNextIdx, setManualNextIdx] = useState(0);
  const [stepping, setStepping] = useState(false);
  const { progress, startPolling, stop } = useShowProgress(simIp);
  const running = progress?.active;

  const validPackets = useMemo(
    () => packets.filter((p) => p.bytes?.length),
    [packets],
  );

  // Auto /show: showStep is the 0-based index currently playing among valid packets.
  const autoPlayingId = useMemo(() => {
    if (!running || !progress?.active) return null;
    const step = Number(progress.step) || 0;
    return validPackets[step]?.id ?? null;
  }, [running, progress, validPackets]);

  // Keep last-sent in sync while auto sequence runs (step that just started = last sent).
  useEffect(() => {
    if (!running || !autoPlayingId) return;
    setLastSentId(autoPlayingId);
  }, [running, autoPlayingId]);

  const highlightId = autoPlayingId || lastSentId;

  const nextManualIdx = useMemo(() => {
    let i = Math.max(0, manualNextIdx);
    while (i < packets.length && !(packets[i].bytes?.length)) i++;
    return i;
  }, [manualNextIdx, packets]);

  const nextManualId = nextManualIdx < packets.length ? packets[nextManualIdx]?.id : null;

  useEffect(() => {
    if (manualNextIdx > packets.length) setManualNextIdx(packets.length);
  }, [packets.length, manualNextIdx]);

  const applyPaste = () => {
    const result = parsePasteToPackets(pasteText, {
      strip8301,
      defaultWaitMs,
      lastHoldMs: 3000,
    });
    if (!result.ok || !result.packets.length) {
      onStatus?.(result.message);
      return;
    }
    setPackets(result.packets.map((p) => ({
      id: generateId(),
      bytes: [...p.bytes],
      waitMs: p.waitMs ?? defaultWaitMs,
      label: p.label || '',
    })));
    setLastSentId(null);
    setManualNextIdx(0);
    onStatus?.(result.message);
    setPasteText('');
  };

  const updatePacket = (id, patch) => {
    setPackets((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const updatePacketHex = (id, hexRaw) => {
    const bytes = parseHexToBytes(hexRaw);
    updatePacket(id, { bytes });
  };

  const removePacket = (id) => {
    setPackets((prev) => prev.filter((p) => p.id !== id));
    if (lastSentId === id) setLastSentId(null);
  };

  const queueShow = async () => {
    const ip = (simIp || '').trim();
    if (!ip) { onStatus?.('Set simulator IP first'); return; }
    const valid = packets.filter((p) => p.bytes.length);
    if (!valid.length) { onStatus?.('Add at least one packet with bytes'); return; }
    const body = buildShowBodyFromPackets(valid);
    if (!body) { onStatus?.('Could not build /show body'); return; }
    try {
      await startShow(ip, body);
      setLastSentId(null);
      onStatus?.(`Queued ${valid.length} packet${valid.length === 1 ? '' : 's'} via /show`);
      startPolling((st) => {
        if (st && !st.showActive) {
          const done = st.showStep >= valid.length;
          onStatus?.(done ? 'Sequence complete' : 'Sequence stopped');
          if (done) {
            const last = valid[valid.length - 1];
            if (last) setLastSentId(last.id);
            onSequenceComplete?.({
              note: `Sequence via /show: ${valid.length} packets`,
              presetKey: 'sequence',
            });
          }
        }
      });
    } catch (e) {
      onStatus?.(e.message || 'Show queue failed');
    }
  };

  const handleStop = async () => {
    await stop();
    onStatus?.('Sequence stopped');
  };

  const resetManualStep = () => {
    setManualNextIdx(0);
    setLastSentId(null);
    onStatus?.('Manual step reset to packet 1');
  };

  const stepOnce = async () => {
    const ip = (simIp || '').trim();
    if (!ip) { onStatus?.('Set simulator IP first'); return; }
    if (running) { onStatus?.('Stop the /show sequence before stepping manually'); return; }
    if (nextManualIdx >= packets.length) {
      onStatus?.('End of sequence — click Reset step to start over');
      return;
    }
    const p = packets[nextManualIdx];
    if (!p?.bytes?.length) {
      onStatus?.('Next row has no bytes');
      return;
    }
    setStepping(true);
    try {
      await sendHex(ip, p.bytes);
      setLastSentId(p.id);
      setManualNextIdx(nextManualIdx + 1);
      const hex = bytesToHex(p.bytes).toUpperCase();
      onStatus?.(
        `Stepped ${nextManualIdx + 1}/${packets.length}`
        + (p.label ? ` (${p.label})` : '')
        + `: ${hex.length > 40 ? `${hex.slice(0, 40)}…` : hex}`,
      );
    } catch (e) {
      onStatus?.(e.message || 'Step send failed');
    } finally {
      setStepping(false);
    }
  };

  const sendRow = async (p, index) => {
    const ip = (simIp || '').trim();
    if (!ip) { onStatus?.('Set simulator IP first'); return; }
    if (running) { onStatus?.('Stop the /show sequence before sending manually'); return; }
    if (!p.bytes?.length) return;
    setStepping(true);
    try {
      await sendHex(ip, p.bytes);
      setLastSentId(p.id);
      setManualNextIdx(index + 1);
      onStatus?.(`Sent packet ${index + 1}: ${bytesToHex(p.bytes).toUpperCase().slice(0, 40)}`);
    } catch (e) {
      onStatus?.(e.message || 'Send failed');
    } finally {
      setStepping(false);
    }
  };

  return (
    <Stack gap="md">
      <Text size="xs" c="dimmed">
        Paste Illuma capture export rows, timed /show lines (<Text span ff="monospace">1000 8301…</Text>),
        or one hex string per line. Wait times come from capture timestamps or defaults.
        Use <strong>Step next</strong> to send one packet at a time via /send, or queue the full timed /show.
      </Text>

      <Textarea
        label="Paste capture or hex"
        placeholder={'# ts_ms\trssi\tdevice_id\tlat\tlng\taccuracy_m\ttag\thint\tquality\tfunc\thex\tnote\n1783304853204\t-86\tAA:BB:CC:DD:EE:FF\t28.4170\t-81.5810\t12\tPING\t…\t\t\t8301cc03000100\t'}
        minRows={4}
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
        styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
      />

      <Group gap="md" wrap="wrap" align="flex-end">
        <Checkbox
          label="Strip 8301 for payload bytes"
          checked={strip8301}
          onChange={(e) => setStrip8301(e.currentTarget.checked)}
        />
        <NumberInput
          label="Default wait (ms)"
          value={defaultWaitMs}
          onChange={(v) => setDefaultWaitMs(Number(v) || 1000)}
          min={50}
          max={60000}
          step={50}
          w={140}
          size="xs"
        />
        <Button size="xs" variant="default" onClick={applyPaste} disabled={!pasteText.trim()}>
          Parse into packets
        </Button>
        <Button size="xs" variant="default" onClick={() => setPackets((prev) => [...prev, emptyPacket()])}>
          Add row
        </Button>
      </Group>

      {packets.length > 0 && (
        <Table.ScrollContainer minWidth={560}>
          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={36}>#</Table.Th>
                <Table.Th w={88}>Status</Table.Th>
                <Table.Th>Hex (payload)</Table.Th>
                <Table.Th w={56}>Len</Table.Th>
                <Table.Th w={130}>Wait before next (ms)</Table.Th>
                <Table.Th w={160} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {packets.map((p, i) => {
                const isPlaying = autoPlayingId === p.id;
                const isLastSent = highlightId === p.id && !isPlaying;
                const isNext = !running && nextManualId === p.id && p.bytes?.length;
                return (
                  <Table.Tr
                    key={p.id}
                    style={
                      isPlaying || (isLastSent && lastSentId === p.id)
                        ? { background: 'color-mix(in srgb, var(--mantine-color-violet-filled) 18%, transparent)' }
                        : isNext
                          ? { background: 'color-mix(in srgb, var(--mantine-color-teal-filled) 12%, transparent)' }
                          : undefined
                    }
                  >
                    <Table.Td>
                      <Text size="xs" c="dimmed">{i + 1}</Text>
                    </Table.Td>
                    <Table.Td>
                      {isPlaying ? (
                        <Badge size="xs" color="violet">Sending</Badge>
                      ) : lastSentId === p.id ? (
                        <Badge size="xs" color="violet" variant="light">Last sent</Badge>
                      ) : isNext ? (
                        <Badge size="xs" color="teal" variant="light">Next</Badge>
                      ) : null}
                    </Table.Td>
                    <Table.Td>
                      <TextInput
                        size="xs"
                        value={bytesToHex(p.bytes).toUpperCase()}
                        onChange={(e) => updatePacketHex(p.id, e.target.value)}
                        placeholder="CF0B00…"
                        styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
                      />
                      {p.label && (
                        <Text size="xs" c="dimmed" mt={2}>{p.label}</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace">{p.bytes.length}</Text>
                    </Table.Td>
                    <Table.Td>
                      <NumberInput
                        size="xs"
                        value={p.waitMs}
                        onChange={(v) => updatePacket(p.id, { waitMs: Math.max(50, Number(v) || 1000) })}
                        min={50}
                        max={120000}
                        step={50}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <Button
                          size="compact-xs"
                          variant="light"
                          color="teal"
                          disabled={!p.bytes.length || running || stepping}
                          onClick={() => sendRow(p, i)}
                        >
                          Send
                        </Button>
                        <Button
                          size="compact-xs"
                          variant="default"
                          disabled={!p.bytes.length}
                          onClick={() => onLoadToEditor?.(p.bytes)}
                        >
                          Editor
                        </Button>
                        <Button size="compact-xs" color="red" variant="light" onClick={() => removePacket(p.id)}>
                          ✕
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Group gap="xs" wrap="wrap" align="center">
        {!running ? (
          <Button onClick={queueShow} disabled={!packets.some((p) => p.bytes.length)}>
            Queue /show sequence
          </Button>
        ) : (
          <Button color="red" variant="light" onClick={handleStop}>
            Stop sequence
          </Button>
        )}
        <Button
          variant="light"
          color="teal"
          onClick={stepOnce}
          loading={stepping}
          disabled={running || !packets.some((p) => p.bytes.length) || nextManualIdx >= packets.length}
        >
          Step next
        </Button>
        <Button
          variant="default"
          size="compact-sm"
          onClick={resetManualStep}
          disabled={running || (manualNextIdx === 0 && !lastSentId)}
        >
          Reset step
        </Button>
        {progress && (
          <Text size="xs" c="dimmed">
            {progress.active
              ? `Auto step ${progress.step + 1} / ${progress.total}`
              : progress.total
                ? `Finished step ${progress.step} / ${progress.total}`
                : null}
          </Text>
        )}
        {!running && packets.length > 0 && (
          <Text size="xs" c="dimmed">
            Manual: next #{Math.min(nextManualIdx + 1, packets.length)}
            {lastSentId
              ? ` · last sent #${packets.findIndex((p) => p.id === lastSentId) + 1}`
              : ''}
          </Text>
        )}
      </Group>
    </Stack>
  );
}
