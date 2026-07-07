import { useState } from 'react';
import {
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
import { buildShowBodyFromPackets, bytesToHex, parseHexToBytes, startShow, stopShow } from '../../lib/ble/wandSimClient';
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
  const { progress, startPolling, stop } = useShowProgress(simIp);
  const running = progress?.active;

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
      onStatus?.(`Queued ${valid.length} packet${valid.length === 1 ? '' : 's'} via /show`);
      startPolling((st) => {
        if (st && !st.showActive) {
          const done = st.showStep >= valid.length;
          onStatus?.(done ? 'Sequence complete' : 'Sequence stopped');
          if (done) {
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

  return (
    <Stack gap="md">
      <Text size="xs" c="dimmed">
        Paste Illuma capture export rows, timed /show lines (<Text span ff="monospace">1000 8301…</Text>),
        or one hex string per line. Wait times come from capture timestamps or defaults.
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
        <Table.ScrollContainer minWidth={520}>
          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={36}>#</Table.Th>
                <Table.Th>Hex (payload)</Table.Th>
                <Table.Th w={56}>Len</Table.Th>
                <Table.Th w={130}>Wait before next (ms)</Table.Th>
                <Table.Th w={120} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {packets.map((p, i) => (
                <Table.Tr key={p.id}>
                  <Table.Td>
                    <Text size="xs" c="dimmed">{i + 1}</Text>
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
              ))}
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
        {progress && (
          <Text size="xs" c="dimmed">
            {progress.active
              ? `Step ${progress.step} / ${progress.total}`
              : progress.total
                ? `Finished step ${progress.step} / ${progress.total}`
                : null}
          </Text>
        )}
      </Group>
    </Stack>
  );
}
