import { useMemo, useState } from 'react';
import {
  Checkbox,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { AppButton } from '../shared/styles';
import { webBleBoard } from '../../lib/ble/chunking';

const EVENT_FILTERS = [
  { id: 'marker', label: 'marker' },
  { id: 'match', label: 'match' },
  { id: 'suppressed', label: 'suppressed' },
  { id: 'no_match', label: 'no_match' },
  { id: 'lifecycle', label: 'lifecycle' },
  { id: 'applied', label: 'applied' },
];

function lineSummary(line) {
  if (!line || typeof line !== 'object') return '';
  const parts = [];
  if (line.id) parts.push(line.id);
  if (line.name) parts.push(line.name);
  if (line.msg) parts.push(line.msg);
  if (line.active && line.matched) parts.push(`${line.active}→blocked ${line.matched}`);
  if (line.transition) parts.push(line.transition);
  return parts.join(' · ');
}

function downloadJsonl(lines, meta) {
  const header = meta
    ? `# sd=${meta.sd} path=${meta.path || ''} ring=${meta.ring ?? ''} count=${meta.count ?? ''}\n`
    : '';
  const body = lines.map((l) => JSON.stringify(l)).join('\n');
  const blob = new Blob([header + body + (body ? '\n' : '')], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `illuma-rule-log-${Date.now()}.jsonl`;
  a.click();
  URL.revokeObjectURL(url);
}

export function RuleLogPanel({ connected }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(50);
  const [selectedEvents, setSelectedEvents] = useState(() => new Set());
  const [textFilter, setTextFilter] = useState('');
  const [meta, setMeta] = useState(null);
  const [lines, setLines] = useState([]);

  const toggleEvent = (id) => {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visible = useMemo(() => {
    const q = textFilter.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((l) => JSON.stringify(l).toLowerCase().includes(q));
  }, [lines, textFilter]);

  const pull = async () => {
    setError('');
    setBusy(true);
    try {
      if (!webBleBoard.connected) await webBleBoard.connect();
      const events = selectedEvents.size ? Array.from(selectedEvents) : null;
      const { meta: m, lines: rows } = await webBleBoard.requestRuleLog({
        limit: Math.max(1, Math.min(96, Number(limit) || 50)),
        events,
      });
      setMeta(m);
      setLines(rows);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper p="sm" bg="var(--surface2)" radius="md">
      <Stack gap="xs">
        <Text size="xs" fw={600}>Rule log (board)</Text>
        <Text size="xs" c="dimmed" lh={1.5}>
          Pulls the newest events from the board RAM ring (also mirrored to SD when a card is
          mounted) over Bluetooth. REST/WiFi push does not carry the live log stream. Use
          markers mid-show, then filter for <Text span ff="monospace" size="xs">match</Text>
          {' / '}
          <Text span ff="monospace" size="xs">suppressed</Text>.
          {' / '}
          <Text span ff="monospace" size="xs">suppressed</Text>.
        </Text>
        <Group gap="xs" align="flex-end" wrap="wrap">
          <NumberInput
            label="Limit"
            size="xs"
            min={1}
            max={96}
            value={limit}
            onChange={(v) => setLimit(Number(v) || 50)}
            w={90}
          />
          <AppButton variant="primary" onClick={pull} disabled={!connected || busy}>
            {busy ? 'Pulling…' : 'Pull log'}
          </AppButton>
          <AppButton
            variant="default"
            onClick={() => downloadJsonl(visible, meta)}
            disabled={!lines.length}
          >
            Download JSONL
          </AppButton>
        </Group>
        <Group gap="xs" wrap="wrap">
          {EVENT_FILTERS.map(({ id, label }) => (
            <Checkbox
              key={id}
              size="xs"
              label={label}
              checked={selectedEvents.has(id)}
              onChange={() => toggleEvent(id)}
            />
          ))}
        </Group>
        <Text size="xs" c="dimmed">
          Leave filters unchecked to pull all event types. Checked = allow-list on the board.
        </Text>
        {meta && (
          <Text size="xs" c="dimmed" ff="monospace">
            sd={String(meta.sd)} path={meta.path || '—'} ring={meta.ring ?? '—'} pulled={meta.count ?? lines.length}
          </Text>
        )}
        <TextInput
          size="xs"
          placeholder="Filter pulled rows…"
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
          disabled={!lines.length}
        />
        {error && <Text size="xs" c="red">{error}</Text>}
        {!!visible.length && (
          <ScrollArea h={220} type="auto">
            <Table striped highlightOnHover withTableBorder withColumnBorders fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>ts</Table.Th>
                  <Table.Th>event</Table.Th>
                  <Table.Th>detail</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visible.map((line, i) => (
                  <Table.Tr key={`${line.ts}-${line.event}-${i}`}>
                    <Table.Td ff="monospace">{line.ts ?? ''}</Table.Td>
                    <Table.Td ff="monospace">{line.event ?? ''}</Table.Td>
                    <Table.Td>{lineSummary(line)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
        {!busy && !error && lines.length === 0 && (
          <Text size="xs" c="dimmed">No rows yet — pull after some rule activity or a log marker.</Text>
        )}
      </Stack>
    </Paper>
  );
}
