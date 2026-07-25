import {
  Badge,
  Button,
  Group,
  NumberInput,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { SearchableSelect } from '../shared/SearchableSelect';
import { SectionHead } from '../shared/SectionHead';
import { WAND_LAB_MB_CMDS, SW_FX_PRESET_BYTES } from '../../lib/ble/mbConstants';
import {
  WAND_LAB_COLORS,
  WAND_LAB_DEVICE_TYPES,
  WAND_LAB_LAYOUTS,
  WAND_LAB_SHOWS,
} from '../../lib/sheets/wandLabFindings';

export function WandLabLogPanel({
  log,
  filteredLog,
  form,
  onFormChange,
  derivedOpcode,
  logFilter,
  onLogFilterChange,
  editingLogId,
  onAddEntry,
  onCancelEdit,
  onLoadEntry,
  onDeleteEntry,
  onExport,
  onPurge,
  onRetryPending,
  pendingCount,
}) {
  const patch = (p) => onFormChange({ ...form, ...p });
  const toggleColor = (c) => {
    const colors = form.colors || [];
    patch({
      colors: colors.includes(c) ? colors.filter((x) => x !== c) : [...colors, c],
    });
  };

  return (
    <Stack h="100%" gap="sm" p="sm" style={{ minHeight: 0 }}>
      <SectionHead>Observation log</SectionHead>

      <SegmentedControl
        size="xs"
        fullWidth
        value={form.deviceType || 'unknown'}
        onChange={(v) => patch({ deviceType: v })}
        data={WAND_LAB_DEVICE_TYPES.map((d) => ({ value: d.value, label: d.label }))}
      />

      <SimpleGrid cols={2} spacing="xs">
        <NumberInput
          label="Total (s)"
          size="xs"
          decimalScale={2}
          step={0.25}
          min={0}
          value={form.totalTimeS === '' ? undefined : form.totalTimeS}
          onChange={(v) => patch({ totalTimeS: v === '' || v == null ? '' : v })}
        />
        <NumberInput
          label="Fade (s)"
          size="xs"
          decimalScale={2}
          step={0.25}
          min={0}
          value={form.fadeTimeS === '' ? undefined : form.fadeTimeS}
          onChange={(v) => patch({ fadeTimeS: v === '' || v == null ? '' : v })}
        />
        <NumberInput
          label="Cycle (s)"
          size="xs"
          decimalScale={2}
          step={0.25}
          min={0}
          value={form.cycleTimeS === '' ? undefined : form.cycleTimeS}
          onChange={(v) => patch({ cycleTimeS: v === '' || v == null ? '' : v })}
        />
        <NumberInput
          label="Cycles"
          size="xs"
          allowDecimal={false}
          min={0}
          value={form.numCycles === '' ? undefined : form.numCycles}
          onChange={(v) => patch({ numCycles: v === '' || v == null ? '' : v })}
        />
      </SimpleGrid>

      <Text size="xs" fw={600}>Colors</Text>
      <Group gap={4} wrap="wrap">
        {WAND_LAB_COLORS.map((c) => (
          <Badge
            key={c}
            size="sm"
            variant={(form.colors || []).includes(c) ? 'filled' : 'outline'}
            style={{ cursor: 'pointer' }}
            onClick={() => toggleColor(c)}
          >
            {c}
          </Badge>
        ))}
      </Group>

      <Text size="xs" fw={600}>Layout</Text>
      <Group gap={4} wrap="wrap">
        {WAND_LAB_LAYOUTS.map((l) => (
          <Badge
            key={l.value}
            size="sm"
            variant={form.layout === l.value ? 'filled' : 'outline'}
            style={{ cursor: 'pointer' }}
            onClick={() => patch({ layout: l.value })}
          >
            {l.label}
          </Badge>
        ))}
      </Group>

      <Text size="xs" fw={600}>Show</Text>
      <SearchableSelect
        value={form.show || ''}
        allowEmpty={false}
        onChange={(v) => patch({ show: v })}
        options={WAND_LAB_SHOWS.map((v) => ({ value: v, label: v, searchText: v }))}
      />

      <Group gap="xs" align="flex-end" wrap="nowrap">
        <TextInput
          label="Opcode"
          size="xs"
          style={{ flex: 1 }}
          value={form.opcodeOverride || derivedOpcode || ''}
          placeholder={derivedOpcode || 'auto'}
          onChange={(e) => patch({ opcodeOverride: e.target.value.trim().toUpperCase() })}
          styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
        />
        {form.opcodeOverride && (
          <Button size="compact-xs" variant="default" onClick={() => patch({ opcodeOverride: '' })}>
            Auto
          </Button>
        )}
      </Group>

      <Textarea
        placeholder="Notes — what happened on the strip?"
        minRows={2}
        autosize
        maxRows={4}
        size="xs"
        value={form.notes || ''}
        onChange={(e) => patch({ notes: e.target.value })}
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

      {pendingCount > 0 && (
        <Button size="xs" variant="light" color="orange" onClick={onRetryPending}>
          Retry {pendingCount} pending Sheets write{pendingCount === 1 ? '' : 's'}
        </Button>
      )}

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
            ...WAND_LAB_SHOWS,
            ...WAND_LAB_DEVICE_TYPES.map((d) => d.value),
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
                    {e.opcode || e.presetKey}
                    {e.deviceType ? ` · ${e.deviceType}` : e.tag ? ` · ${e.tag}` : ''}
                    {e.synced === false ? ' · pending' : ''}
                    {e.kind === 'sequence' && e.packets?.length
                      ? ` · ${e.packets.length} pkts`
                      : ''}
                  </Text>
                  <Group gap={4} wrap="nowrap">
                    <Button size="compact-xs" variant="default" onClick={() => onLoadEntry(e)}>Load</Button>
                    <Button size="compact-xs" color="red" variant="light" onClick={() => onDeleteEntry(e.id)}>✕</Button>
                  </Group>
                </Group>
                <Text size="xs" c="dimmed">{new Date(e.ts || e.createdAt).toLocaleString()}</Text>
                {(e.notes || e.note) && (
                  <Text size="xs" c="dimmed">{e.notes || e.note}</Text>
                )}
                {(e.colors?.length > 0 || e.layout || e.show) && (
                  <Text size="xs" c="dimmed">
                    {[e.layout, (e.colors || []).join(','), e.show].filter(Boolean).join(' · ')}
                  </Text>
                )}
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
