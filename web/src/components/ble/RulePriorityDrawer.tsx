import { useMemo, useState } from 'react';
import {
  Badge,
  Checkbox,
  Drawer,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  Stack,
  Switch,
  Text,
  UnstyledButton,
} from '@mantine/core';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AppButton } from '../shared/styles';
import { reindexRulePriorities } from '../../lib/ble/mbMapping';

function rowId(rule, index) {
  return rule?.id || `rule-${index}`;
}

function stableSortByPriority(rules) {
  return (rules || [])
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => {
      const pa = Number(a.rule.priority) || 0;
      const pb = Number(b.rule.priority) || 0;
      if (pa !== pb) return pa - pb;
      return a.index - b.index;
    })
    .map(({ rule }) => rule);
}

function splitSelected(rules, selectedIds) {
  const selected = [];
  const rest = [];
  for (const rule of rules) {
    if (selectedIds.has(rule.id)) selected.push(rule);
    else rest.push(rule);
  }
  return { selected, rest };
}

function SortableRuleRow({
  rule,
  index,
  checked,
  stagedPriority,
  onToggleSelect,
  onStagePriority,
  onToggleEnabled,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rowId(rule, index),
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
    zIndex: isDragging ? 2 : undefined,
  };

  return (
    <Paper
      ref={setNodeRef}
      style={style}
      p="xs"
      withBorder
      bg={checked ? 'var(--mantine-color-violet-light)' : undefined}
    >
      <Group gap="xs" wrap="nowrap" align="center">
        <UnstyledButton
          type="button"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
          tabIndex={-1}
          style={{
            cursor: 'grab',
            fontSize: 18,
            lineHeight: 1,
            padding: '4px 2px',
            color: 'var(--mantine-color-dimmed)',
            flexShrink: 0,
          }}
        >
          ⠿
        </UnstyledButton>
        <Checkbox
          checked={checked}
          onChange={(e) => onToggleSelect(rule.id, e.currentTarget.checked)}
          aria-label={`Select ${rule.name || `Rule ${index + 1}`}`}
        />
        <Text
          size="sm"
          fw={600}
          style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {rule.name || `Rule ${index + 1}`}
        </Text>
        <NumberInput
          size="xs"
          w={88}
          hideControls
          value={stagedPriority}
          onChange={(v) => onStagePriority(rule.id, parseInt(String(v), 10) || 0)}
          aria-label={`Priority for ${rule.name || `Rule ${index + 1}`}`}
        />
        <Badge size="xs" variant="outline">
          P{rule.priority ?? index * 10}
        </Badge>
        <Switch
          size="xs"
          checked={rule.enabled !== false}
          onChange={(e) => onToggleEnabled(rule.id, e.currentTarget.checked)}
          label={rule.enabled === false ? 'off' : 'on'}
          styles={{ label: { fontSize: 11 } }}
        />
      </Group>
    </Paper>
  );
}

export function RulePriorityDrawer({ rules, onChange, onClose }) {
  const [rows, setRows] = useState(() => [...(rules || [])]);
  const [staged, setStaged] = useState({});
  const [selected, setSelected] = useState(() => new Set());
  const [bandOpen, setBandOpen] = useState(false);
  const [bandStart, setBandStart] = useState(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const ids = useMemo(() => rows.map((rule, i) => rowId(rule, i)), [rows]);
  const selectedCount = selected.size;
  const hasStaged = Object.keys(staged).length > 0;

  const stagedPriorityOf = (rule) =>
    staged[rule.id] !== undefined ? staged[rule.id] : (rule.priority ?? 0);

  const commit = (next) => {
    setRows(next);
    setStaged({});
    onChange(next);
  };

  const toggleSelect = (id, checked) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = rows.findIndex((rule, i) => rowId(rule, i) === active.id);
    const newIndex = rows.findIndex((rule, i) => rowId(rule, i) === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    commit(reindexRulePriorities(arrayMove(rows, oldIndex, newIndex)));
  };

  const applyNumbers = () => {
    const withNumbers = rows.map((rule) => ({
      ...rule,
      priority: stagedPriorityOf(rule),
    }));
    commit(reindexRulePriorities(stableSortByPriority(withNumbers)));
  };

  const renumber = () => {
    commit(reindexRulePriorities(rows));
  };

  const moveSelected = (toEnd) => {
    if (!selectedCount) return;
    const { selected: picked, rest } = splitSelected(rows, selected);
    const next = toEnd ? [...rest, ...picked] : [...picked, ...rest];
    commit(reindexRulePriorities(next));
  };

  const applyPriorityBand = () => {
    if (!selectedCount) return;
    const { selected: picked, rest } = splitSelected(rows, selected);
    const restSorted = stableSortByPriority(rest);
    const start = Number(bandStart) || 0;
    let insertAt = restSorted.findIndex((rule) => (Number(rule.priority) || 0) >= start);
    if (insertAt < 0) insertAt = restSorted.length;
    commit(
      reindexRulePriorities([
        ...restSorted.slice(0, insertAt),
        ...picked,
        ...restSorted.slice(insertAt),
      ]),
    );
    setBandOpen(false);
  };

  const toggleEnabled = (id, enabled) => {
    const next = rows.map((rule) => (rule.id === id ? { ...rule, enabled } : rule));
    setRows(next);
    onChange(next);
  };

  return (
    <Drawer
      opened
      onClose={onClose}
      title="Reorder / bulk priority"
      position="right"
      size="lg"
      padding="md"
      zIndex={1000}
    >
      <Stack gap="sm" h="100%">
        <Text size="xs" c="dimmed">
          Drag to reorder, or type priorities and Apply numbers. Closing without Apply
          discards unapplied number edits. Lower priority runs first.
        </Text>

        <Group gap="xs" wrap="wrap">
          <AppButton
            size="compact-xs"
            variant="default"
            disabled={!selectedCount}
            onClick={() => moveSelected(false)}
          >
            Move to top
          </AppButton>
          <AppButton
            size="compact-xs"
            variant="default"
            disabled={!selectedCount}
            onClick={() => moveSelected(true)}
          >
            Move to bottom
          </AppButton>
          <AppButton
            size="compact-xs"
            variant="default"
            disabled={!selectedCount}
            onClick={() => {
              setBandStart(0);
              setBandOpen((v) => !v);
            }}
          >
            Set priority…
          </AppButton>
          <AppButton size="compact-xs" variant="default" onClick={renumber}>
            Renumber 0,10,20…
          </AppButton>
          <AppButton
            size="compact-xs"
            variant="primary"
            disabled={!hasStaged}
            onClick={applyNumbers}
          >
            Apply numbers
          </AppButton>
          <Text size="xs" c="dimmed">
            {selectedCount ? `${selectedCount} selected` : 'None selected'}
          </Text>
        </Group>

        {bandOpen && (
          <Group gap="xs" align="flex-end">
            <NumberInput
              size="xs"
              label="Start priority"
              description="Selected rows land as a contiguous block at this band, then the list is renumbered."
              value={bandStart}
              onChange={(v) => setBandStart(parseInt(String(v), 10) || 0)}
              w={140}
            />
            <AppButton size="compact-sm" variant="primary" disabled={!selectedCount} onClick={applyPriorityBand}>
              Apply
            </AppButton>
          </Group>
        )}

        <ScrollArea style={{ flex: 1 }} offsetScrollbars>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <Stack gap={6}>
                {rows.map((rule, index) => (
                  <SortableRuleRow
                    key={rowId(rule, index)}
                    rule={rule}
                    index={index}
                    checked={selected.has(rule.id)}
                    stagedPriority={stagedPriorityOf(rule)}
                    onToggleSelect={toggleSelect}
                    onStagePriority={(id, value) =>
                      setStaged((prev) => ({ ...prev, [id]: value }))
                    }
                    onToggleEnabled={toggleEnabled}
                  />
                ))}
              </Stack>
            </SortableContext>
          </DndContext>
        </ScrollArea>
      </Stack>
    </Drawer>
  );
}
