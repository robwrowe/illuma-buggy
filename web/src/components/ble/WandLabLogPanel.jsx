import { useState } from 'react';
import {
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  UnstyledButton,
} from '@mantine/core';
import { SearchableSelect } from '../shared/SearchableSelect';
import { SectionHead } from '../shared/SectionHead';
import { WAND_LAB_MB_CMDS, SW_FX_PRESET_BYTES } from '../../lib/ble/mbConstants';
import {
  EMPTY_FINDING_FORM,
  FINDING_FORM_SECTIONS,
  WAND_LAB_COLORS,
  WAND_LAB_DEVICE_TYPES,
  WAND_LAB_LAYOUTS,
  WAND_LAB_SHOWS,
  getWandLabShows,
  setWandLabShows,
} from '../../lib/sheets/wandLabFindings';

function CollapsibleSection({ title, summary, defaultOpen = false, onReset, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Stack gap={6}>
      <Group gap={6} wrap="nowrap" justify="space-between" align="center">
        <UnstyledButton onClick={() => setOpen((v) => !v)} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            <Text size="xs" c="dimmed" ff="monospace">{open ? '▾' : '▸'}</Text>
            <Text size="xs" fw={600}>{title}</Text>
            {!open && summary ? (
              <Text size="xs" c="dimmed" lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
                {summary}
              </Text>
            ) : null}
          </Group>
        </UnstyledButton>
        {onReset && (
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={(e) => {
              e.stopPropagation();
              onReset();
            }}
          >
            Reset
          </Button>
        )}
      </Group>
      {open ? children : null}
    </Stack>
  );
}

function ShowsEditorModal({ opened, onClose, shows, onChange }) {
  const [draft, setDraft] = useState('');

  const addShow = () => {
    const name = draft.trim();
    if (!name) return;
    if (shows.some((s) => s.toLowerCase() === name.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...shows, name]);
    setDraft('');
  };

  const removeShow = (name) => {
    const next = shows.filter((s) => s !== name);
    onChange(next.length ? next : [...WAND_LAB_SHOWS]);
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Edit shows" size="sm">
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          These labels appear in the Show picker and history filter. Stored in this browser only.
        </Text>
        <Group gap="xs" wrap="nowrap">
          <TextInput
            style={{ flex: 1 }}
            size="xs"
            placeholder="New show name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addShow()}
          />
          <Button size="xs" onClick={addShow} disabled={!draft.trim()}>Add</Button>
        </Group>
        <Stack gap={4}>
          {shows.map((name) => (
            <Group key={name} justify="space-between" wrap="nowrap" gap="xs">
              <Text size="sm" style={{ flex: 1, minWidth: 0 }}>{name}</Text>
              <Button size="compact-xs" color="red" variant="light" onClick={() => removeShow(name)}>
                ✕
              </Button>
            </Group>
          ))}
        </Stack>
        <Button
          size="xs"
          variant="default"
          onClick={() => onChange([...WAND_LAB_SHOWS])}
        >
          Reset to defaults
        </Button>
        <Button size="xs" onClick={onClose}>Done</Button>
      </Stack>
    </Modal>
  );
}

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
  onResetForm,
  onLoadEntry,
  onDeleteEntry,
  onExport,
  onPurge,
  onRetryPending,
  pendingCount,
}) {
  const [shows, setShows] = useState(() => getWandLabShows());
  const [showsModalOpen, setShowsModalOpen] = useState(false);

  const patch = (p) => onFormChange({ ...form, ...p });
  const resetSection = (key) => patch({ ...FINDING_FORM_SECTIONS[key] });

  const toggleColor = (c) => {
    const colors = form.colors || [];
    patch({
      colors: colors.includes(c) ? colors.filter((x) => x !== c) : [...colors, c],
    });
  };

  const updateShows = (next) => {
    setWandLabShows(next);
    setShows(next);
    if (form.show && !next.includes(form.show) && next.length) {
      patch({ show: next[next.length - 1] });
    }
  };

  const timingSummary = [
    form.totalTimeS !== '' && form.totalTimeS != null ? `tot ${form.totalTimeS}s` : null,
    form.fadeTimeS !== '' && form.fadeTimeS != null ? `fade ${form.fadeTimeS}s` : null,
    form.cycleTimeS !== '' && form.cycleTimeS != null ? `cyc ${form.cycleTimeS}s` : null,
    form.numCycles !== '' && form.numCycles != null ? `×${form.numCycles}` : null,
  ].filter(Boolean).join(' · ') || '—';

  const colorsSummary = (form.colors || []).length
    ? (form.colors || []).join(', ')
    : 'none';

  const layoutLabel = WAND_LAB_LAYOUTS.find((l) => l.value === form.layout)?.label || form.layout || '—';
  const opcodeDisplay = form.opcodeOverride || derivedOpcode || 'auto';

  return (
    <Stack h="100%" gap="sm" p="sm" style={{ minHeight: 0 }}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <SectionHead>Observation log</SectionHead>
        <Button
          size="compact-xs"
          variant="default"
          onClick={() => (onResetForm ? onResetForm() : onFormChange({ ...EMPTY_FINDING_FORM }))}
        >
          Reset all
        </Button>
      </Group>

      <Group gap={6} wrap="nowrap" justify="space-between" align="center">
        <div style={{ flex: 1, minWidth: 0 }}>
          <SegmentedControl
            size="xs"
            fullWidth
            value={form.deviceType || 'unknown'}
            onChange={(v) => patch({ deviceType: v })}
            data={WAND_LAB_DEVICE_TYPES.map((d) => ({ value: d.value, label: d.label }))}
          />
        </div>
        <Button size="compact-xs" variant="subtle" color="gray" onClick={() => resetSection('device')}>
          Reset
        </Button>
      </Group>

      <CollapsibleSection
        title="Timing"
        summary={timingSummary}
        onReset={() => resetSection('timing')}
      >
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
      </CollapsibleSection>

      <CollapsibleSection
        title="Colors"
        summary={colorsSummary}
        onReset={() => resetSection('colors')}
      >
        <Text size="xs" c="dimmed" mb={4}>Tap to toggle</Text>
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
      </CollapsibleSection>

      <CollapsibleSection
        title="Layout"
        summary={layoutLabel}
        onReset={() => resetSection('layout')}
      >
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
      </CollapsibleSection>

      <CollapsibleSection
        title="Show"
        summary={form.show || '—'}
        onReset={() => resetSection('show')}
      >
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <div style={{ flex: 1, minWidth: 0 }}>
            <SearchableSelect
              value={form.show || ''}
              allowEmpty={false}
              onChange={(v) => patch({ show: v })}
              options={shows.map((v) => ({ value: v, label: v, searchText: v }))}
            />
          </div>
          <Button size="compact-xs" variant="default" onClick={() => setShowsModalOpen(true)}>
            Edit
          </Button>
        </Group>
      </CollapsibleSection>

      <CollapsibleSection
        title="Opcode & notes"
        summary={[opcodeDisplay, form.notes ? 'has notes' : null].filter(Boolean).join(' · ')}
        onReset={() => resetSection('opcodeNotes')}
      >
        <Stack gap="xs">
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
            placeholder="Notes — cleared after each log; other fields stick"
            minRows={2}
            autosize
            maxRows={4}
            size="xs"
            value={form.notes || ''}
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </Stack>
      </CollapsibleSection>

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
            ...shows,
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
                    {e.kind === 'byte_tags' ? 'analyzer' : (e.opcode || e.presetKey)}
                    {e.kind === 'byte_tags' && e.opcode ? ` · ${e.opcode}` : ''}
                    {e.deviceType ? ` · ${e.deviceType}` : e.tag ? ` · ${e.tag}` : ''}
                    {e.synced === false ? ' · pending' : ''}
                    {e.kind === 'sequence' && e.packets?.length
                      ? ` · ${e.packets.length} pkts`
                      : ''}
                    {e.kind === 'byte_tags' && e.byteTagsSerialized
                      ? ` · ${e.byteTagsSerialized.split(',').filter(Boolean).length} tags`
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
                {e.kind === 'byte_tags' && e.byteTagsSerialized ? (
                  <Text size="xs" ff="monospace" c="dimmed" style={{ wordBreak: 'break-all' }}>
                    {e.byteTagsSerialized}
                  </Text>
                ) : null}
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
                    {e.bytes || e.hex}
                  </Text>
                )}
              </Stack>
            ))}
          </Stack>
        )}
      </ScrollArea>

      <ShowsEditorModal
        opened={showsModalOpen}
        onClose={() => setShowsModalOpen(false)}
        shows={shows}
        onChange={updateShows}
      />
    </Stack>
  );
}
