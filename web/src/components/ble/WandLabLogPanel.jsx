import {
  Badge,
  Button,
  Group,
  ScrollArea,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { SearchableSelect } from '../shared/SearchableSelect';
import { SectionHead } from '../shared/SectionHead';
import { WAND_LAB_MB_CMDS, WAND_LAB_TAGS, SW_FX_PRESET_BYTES } from '../../lib/ble/mbConstants';

export function WandLabLogPanel({
  log,
  filteredLog,
  tag,
  onTagChange,
  note,
  onNoteChange,
  logFilter,
  onLogFilterChange,
  editingLogId,
  onAddEntry,
  onCancelEdit,
  onLoadEntry,
  onDeleteEntry,
  onExport,
  onPurge,
}) {
  return (
    <Stack h="100%" gap="sm" p="sm" style={{ minHeight: 0 }}>
      <SectionHead>Observation log</SectionHead>

      <Group gap={4} wrap="wrap">
        {WAND_LAB_TAGS.map((t) => (
          <Badge
            key={t}
            size="sm"
            variant={tag === t ? 'filled' : 'outline'}
            style={{ cursor: 'pointer' }}
            onClick={() => onTagChange(t)}
          >
            {t}
          </Badge>
        ))}
      </Group>

      <Textarea
        placeholder="What happened on the strip?"
        minRows={2}
        autosize
        maxRows={4}
        size="xs"
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
      />

      <Group gap="xs" grow>
        <Button size="xs" variant="default" onClick={onAddEntry}>
          {editingLogId ? 'Save entry' : 'Log current'}
        </Button>
        {editingLogId && (
          <Button size="xs" variant="default" onClick={onCancelEdit}>
            Cancel
          </Button>
        )}
      </Group>

      <Group gap={4} wrap="wrap" align="center">
        <Text size="xs" fw={600}>History ({(log || []).length})</Text>
        <SearchableSelect
          value={logFilter}
          allowEmpty
          onChange={onLogFilterChange}
          placeholder="Filter…"
          options={[
            ...Object.keys(SW_FX_PRESET_BYTES),
            ...WAND_LAB_MB_CMDS.map((c) => `mb:${c.id}`),
            ...WAND_LAB_TAGS,
            'paste',
            'sequence',
            'burst',
          ].map((v) => ({ value: v, label: v, searchText: v }))}
        />
        <Button size="compact-xs" variant="default" onClick={onExport}>Export</Button>
        {(log || []).length > 0 && (
          <Button size="compact-xs" color="red" variant="light" onClick={onPurge}>Purge</Button>
        )}
      </Group>

      <ScrollArea type="auto" offsetScrollbars style={{ flex: 1, minHeight: 0 }}>
        {filteredLog.length === 0 ? (
          <Text size="xs" c="dimmed">No log entries yet.</Text>
        ) : (
          <Stack gap="xs" pb="xs">
            {filteredLog.map((e) => (
              <Stack
                key={e.id}
                gap={4}
                p="xs"
                style={{
                  background: 'var(--surface2)',
                  borderRadius: 8,
                  border: editingLogId === e.id ? '1px solid var(--primary)' : '1px solid transparent',
                }}
              >
                <Group justify="space-between" wrap="nowrap" align="flex-start" gap={4}>
                  <Text size="xs" fw={600} style={{ flex: 1, minWidth: 0 }}>
                    {e.presetKey} · {e.tag}
                    {e.kind === 'sequence' && e.packets?.length
                      ? ` · ${e.packets.length} pkts`
                      : ''}
                  </Text>
                  <Group gap={4} wrap="nowrap">
                    <Button size="compact-xs" variant="default" onClick={() => onLoadEntry(e)}>Load</Button>
                    <Button size="compact-xs" color="red" variant="light" onClick={() => onDeleteEntry(e.id)}>✕</Button>
                  </Group>
                </Group>
                <Text size="xs" c="dimmed">{new Date(e.ts).toLocaleString()}</Text>
                {e.note && <Text size="xs" c="dimmed">{e.note}</Text>}
                {e.kind === 'sequence' && e.packets?.length ? (
                  <Stack gap={2}>
                    {e.packets.slice(0, 4).map((p, i) => (
                      <Text key={i} size="xs" ff="monospace" c="dimmed" style={{ wordBreak: 'break-all' }}>
                        {i + 1}. +{p.waitMs}ms {p.bytes?.toUpperCase()}
                      </Text>
                    ))}
                    {e.packets.length > 4 && (
                      <Text size="xs" c="dimmed">…and {e.packets.length - 4} more</Text>
                    )}
                  </Stack>
                ) : (
                  <Text size="xs" ff="monospace" c="dimmed" style={{ wordBreak: 'break-all' }}>
                    {e.bytes}
                  </Text>
                )}
              </Stack>
            ))}
          </Stack>
        )}
      </ScrollArea>
    </Stack>
  );
}
