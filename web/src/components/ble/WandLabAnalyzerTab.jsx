import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Group,
  Popover,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  BYTE_TAG_KINDS,
  columnConstancy,
  createEmptyColorDetail,
  createEmptyParamDetail,
  effectiveTag,
  parseAnalyzerInput,
} from '../../lib/ble/byteAnalyzer';
import { Field } from '../shared/Field';
import { SearchableSelect } from '../shared/SearchableSelect';
import { AnalyzerFindingForm } from './AnalyzerFindingForm';

function nextGroupId(existingGroupIds) {
  let n = 1;
  while (existingGroupIds.includes(`grp${n}`)) n++;
  return `grp${n}`;
}

function ParamDetailPopover({ opened, initialDetail, onConfirm, onCancel, anchorLabel }) {
  const [name, setName] = useState(initialDetail?.paramName || '');
  const [bitStart, setBitStart] = useState(initialDetail?.bitStart ?? 0);
  const [bitCount, setBitCount] = useState(initialDetail?.bitCount ?? 8);

  const selected = new Set(Array.from({ length: bitCount }, (_, k) => bitStart + k));
  const toggleBit = (bitIdx) => {
    const next = new Set(selected);
    if (next.has(bitIdx)) next.delete(bitIdx);
    else next.add(bitIdx);
    if (next.size === 0) {
      setBitStart(0);
      setBitCount(0);
      return;
    }
    const min = Math.min(...next);
    const max = Math.max(...next);
    setBitStart(min);
    setBitCount(max - min + 1);
  };

  if (!opened) return null;

  return (
    <Popover.Dropdown>
      <Stack gap={6} p={4} miw={220}>
        <Text size="xs" fw={600}>{anchorLabel}</Text>
        <TextInput
          size="xs"
          label="Param name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Group gap={2} justify="center">
          {[7, 6, 5, 4, 3, 2, 1, 0].map((bitIdx) => (
            <Box
              key={bitIdx}
              onClick={() => toggleBit(bitIdx)}
              style={{
                width: 20,
                height: 20,
                textAlign: 'center',
                fontSize: 10,
                cursor: 'pointer',
                lineHeight: '20px',
                borderRadius: 3,
                background: selected.has(bitIdx)
                  ? 'var(--mantine-color-blue-light)'
                  : 'var(--surface2)',
                border: '1px solid var(--border)',
              }}
            >
              {bitIdx}
            </Box>
          ))}
        </Group>
        <Text size="xs" c="dimmed" ta="center">
          {bitCount === 8
            ? 'whole byte'
            : bitCount === 0
              ? 'no bits selected'
              : `bits[${bitStart + bitCount - 1}:${bitStart}] (${bitCount}-bit)`}
        </Text>
        <Group justify="flex-end" gap={6}>
          <Button size="compact-xs" variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="compact-xs"
            onClick={() =>
              onConfirm({
                paramName: name.trim(),
                bitStart: bitCount === 0 ? 0 : bitStart,
                bitCount: bitCount === 0 ? 8 : bitCount,
              })
            }
          >
            Set
          </Button>
        </Group>
      </Stack>
    </Popover.Dropdown>
  );
}

function ColorDetailPopover({
  opened,
  initialDetail,
  existingGroupIds,
  onConfirm,
  onCancel,
  anchorLabel,
}) {
  const [mode, setMode] = useState(initialDetail?.mode || 'palette');
  const [channelRole, setChannelRole] = useState(initialDetail?.channelRole || 'r');
  const [groupId, setGroupId] = useState(
    initialDetail?.groupId || nextGroupId(existingGroupIds),
  );

  if (!opened) return null;

  const groupOptions = [...new Set([groupId, ...existingGroupIds].filter(Boolean))].map((g) => ({
    value: g,
    label: g,
  }));

  return (
    <Popover.Dropdown>
      <Stack gap={6} p={4} miw={220}>
        <Text size="xs" fw={600}>{anchorLabel}</Text>
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={setMode}
          data={[
            { value: 'palette', label: 'Palette' },
            { value: 'rgb', label: 'RGB channel' },
          ]}
        />
        {mode === 'rgb' && (
          <>
            <SegmentedControl
              size="xs"
              value={channelRole}
              onChange={setChannelRole}
              data={[
                { value: 'r', label: 'R' },
                { value: 'g', label: 'G' },
                { value: 'b', label: 'B' },
              ]}
            />
            <Field label="Group" style={{ marginBottom: 0 }}>
              <SearchableSelect
                size="xs"
                value={groupId}
                allowEmpty={false}
                onChange={setGroupId}
                options={groupOptions}
              />
            </Field>
            <TextInput
              size="xs"
              label="Or type new group id"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value.trim())}
              placeholder="grp1"
            />
          </>
        )}
        <Group justify="flex-end" gap={6}>
          <Button size="compact-xs" variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="compact-xs"
            onClick={() =>
              onConfirm(
                mode === 'palette'
                  ? { mode: 'palette' }
                  : { mode: 'rgb', channelRole, groupId: groupId || nextGroupId(existingGroupIds) },
              )
            }
          >
            Set
          </Button>
        </Group>
      </Stack>
    </Popover.Dropdown>
  );
}

function TagSuffix({ tag }) {
  if (tag?.kind === 'param' && tag.detail?.bitCount < 8) {
    return (
      <Text span size="xs" c="dimmed" style={{ fontSize: 8, display: 'block' }}>
        b{tag.detail.bitStart + tag.detail.bitCount - 1}:{tag.detail.bitStart}
      </Text>
    );
  }
  if (tag?.kind === 'color' && tag.detail?.mode === 'rgb') {
    return (
      <Text span size="xs" c="dimmed" style={{ fontSize: 8, display: 'block' }}>
        {tag.detail.channelRole?.toUpperCase()}·{tag.detail.groupId}
      </Text>
    );
  }
  return null;
}

function AnalyzerRow({
  row,
  maxLen,
  columnTags,
  cellTags,
  detailPopover,
  existingGroupIds,
  onCellClick,
  onDetailConfirm,
  onDetailCancel,
  onSend,
  onEdit,
  onLog,
  tagKindMeta,
}) {
  return (
    <>
      <Box
        style={{
          fontSize: 10,
          fontFamily: 'monospace',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          justifyContent: 'center',
          paddingRight: 4,
        }}
      >
        <Group gap={4} wrap="nowrap">
          <Button size="compact-xs" variant="default" onClick={onSend}>
            Send
          </Button>
          <Button size="compact-xs" variant="default" onClick={onEdit}>
            Edit
          </Button>
          <Button size="compact-xs" variant="light" onClick={onLog}>
            Log
          </Button>
        </Group>
      </Box>
      {Array.from({ length: maxLen }).map((_, i) => {
        const tag = effectiveTag(i, row.id, columnTags, cellTags);
        const meta = tag ? tagKindMeta(tag.kind) : null;
        const byte = i < row.bytes.length ? row.bytes[i] : null;
        const popoverOpen =
          detailPopover?.rowId === row.id && detailPopover?.index === i;
        return (
          <Popover key={i} opened={popoverOpen} withArrow position="bottom">
            <Popover.Target>
              <Box
                onClick={() => byte != null && onCellClick(i)}
                style={{
                  cursor: byte != null ? 'pointer' : 'default',
                  textAlign: 'center',
                  fontSize: 10,
                  fontFamily: 'monospace',
                  padding: '4px 0',
                  borderRadius: 4,
                  opacity: byte == null ? 0.3 : 1,
                  background: meta
                    ? `var(--mantine-color-${meta.color}-light)`
                    : 'var(--surface2)',
                  border: '1px solid var(--border)',
                }}
              >
                {byte != null ? (byte & 0xff).toString(16).padStart(2, '0').toUpperCase() : '··'}
                <TagSuffix tag={tag} />
              </Box>
            </Popover.Target>
            {popoverOpen && detailPopover.kind === 'param' && (
              <ParamDetailPopover
                opened
                initialDetail={detailPopover.initial}
                anchorLabel={`row cell[${i}]`}
                onCancel={onDetailCancel}
                onConfirm={onDetailConfirm}
              />
            )}
            {popoverOpen && detailPopover.kind === 'color' && (
              <ColorDetailPopover
                opened
                initialDetail={detailPopover.initial}
                existingGroupIds={existingGroupIds}
                anchorLabel={`row cell[${i}]`}
                onCancel={onDetailCancel}
                onConfirm={onDetailConfirm}
              />
            )}
          </Popover>
        );
      })}
    </>
  );
}

export function WandLabAnalyzerTab({
  onSendPacket,
  onLoadToByteEditor,
  onLogFinding,
  rules,
  onGenerateRule,
}) {
  const [pasteText, setPasteText] = useState('');
  const [rows, setRows] = useState([]);
  const [columnTags, setColumnTags] = useState({});
  const [cellTags, setCellTags] = useState({});
  const [activeTag, setActiveTag] = useState('signature');
  const [detailPopover, setDetailPopover] = useState(null);
  const [loggingRowId, setLoggingRowId] = useState(null);

  const parseInput = () => {
    setRows(parseAnalyzerInput(pasteText));
    setColumnTags({});
    setCellTags({});
    setDetailPopover(null);
  };

  const maxLen = useMemo(() => rows.reduce((m, r) => Math.max(m, r.bytes.length), 0), [rows]);
  const constancy = useMemo(() => columnConstancy(rows), [rows]);

  const existingGroupIds = useMemo(() => {
    const ids = new Set();
    const scan = (tag) => {
      if (tag?.kind === 'color' && tag.detail?.mode === 'rgb' && tag.detail.groupId) {
        ids.add(tag.detail.groupId);
      }
    };
    Object.values(columnTags).forEach(scan);
    Object.values(cellTags).forEach((rowMap) => Object.values(rowMap).forEach(scan));
    return [...ids];
  }, [columnTags, cellTags]);

  const applyTag = (rowId, index, entry) => {
    if (rowId == null) {
      setColumnTags((prev) => {
        const next = { ...prev };
        if (entry == null) delete next[index];
        else next[index] = entry;
        return next;
      });
    } else {
      setCellTags((prev) => {
        const rowMap = { ...(prev[rowId] || {}) };
        if (entry == null) delete rowMap[index];
        else rowMap[index] = entry;
        return { ...prev, [rowId]: rowMap };
      });
    }
  };

  const handleClick = (rowId, index) => {
    const current = rowId == null ? columnTags[index] : cellTags[rowId]?.[index];
    if (activeTag === 'param') {
      setDetailPopover({
        kind: 'param',
        rowId,
        index,
        initial: current?.kind === 'param' ? current.detail : createEmptyParamDetail(),
      });
      return;
    }
    if (activeTag === 'color') {
      setDetailPopover({
        kind: 'color',
        rowId,
        index,
        initial: current?.kind === 'color' ? current.detail : createEmptyColorDetail(),
      });
      return;
    }
    const next = current?.kind === activeTag ? null : { kind: activeTag, detail: {} };
    applyTag(rowId, index, next);
  };

  const confirmDetailPopover = (detail) => {
    if (!detailPopover) return;
    applyTag(detailPopover.rowId, detailPopover.index, {
      kind: detailPopover.kind,
      detail,
    });
    setDetailPopover(null);
  };

  const tagKindMeta = (id) => BYTE_TAG_KINDS.find((k) => k.id === id);

  const loggingRow = rows.find((r) => r.id === loggingRowId);

  return (
    <Stack gap="md">
      <Text size="xs" c="dimmed">
        Paste one packet (hex) per line. Click a column header to tag that byte position across
        every row; click an individual cell to override just that packet.
      </Text>

      <Textarea
        autosize
        minRows={3}
        maxRows={8}
        placeholder={'8301E90C0F19...\n8301E90C0F2A...'}
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
        styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
      />
      <Group gap="xs">
        <Button size="xs" onClick={parseInput}>
          Parse {pasteText.split('\n').filter((l) => l.trim()).length || ''} lines
        </Button>
        {rows.length > 0 && (
          <Text size="xs" c="dimmed">
            {rows.length} packets, max {maxLen} bytes
          </Text>
        )}
      </Group>

      <Group gap={6}>
        <Text size="xs" c="dimmed" fw={600}>
          Tag:
        </Text>
        {BYTE_TAG_KINDS.map((k) => (
          <Button
            key={k.id}
            size="compact-xs"
            variant={activeTag === k.id ? 'filled' : 'outline'}
            color={k.color}
            onClick={() => setActiveTag(k.id)}
          >
            {k.label}
          </Button>
        ))}
      </Group>

      {rows.length > 0 && (
        <ScrollArea type="auto">
          <Box
            style={{
              display: 'grid',
              gridTemplateColumns: `120px repeat(${maxLen}, 34px)`,
              gap: 2,
              minWidth: 120 + maxLen * 36,
            }}
          >
            <Box />
            {Array.from({ length: maxLen }).map((_, i) => {
              const tag = columnTags[i];
              const meta = tag ? tagKindMeta(tag.kind) : null;
              const c = constancy[i];
              const popoverOpen = detailPopover?.rowId == null && detailPopover?.index === i;
              return (
                <Popover key={i} opened={popoverOpen} withArrow position="bottom">
                  <Popover.Target>
                    <Tooltip
                      label={`byte[${i}] · ${c?.distinctCount ?? 0} distinct value(s) across ${c?.coverage ?? 0} row(s)`}
                    >
                      <Box
                        onClick={() => handleClick(null, i)}
                        style={{
                          cursor: 'pointer',
                          textAlign: 'center',
                          fontSize: 10,
                          fontFamily: 'monospace',
                          padding: '4px 0',
                          borderRadius: 4,
                          background: meta
                            ? `var(--mantine-color-${meta.color}-light)`
                            : 'var(--surface2)',
                          border: c?.constant
                            ? '1px solid var(--mantine-color-teal-6)'
                            : '1px solid var(--border)',
                        }}
                      >
                        {i}
                        <TagSuffix tag={tag} />
                      </Box>
                    </Tooltip>
                  </Popover.Target>
                  {popoverOpen && detailPopover.kind === 'param' && (
                    <ParamDetailPopover
                      key={`col-param-${i}`}
                      opened
                      initialDetail={detailPopover.initial}
                      anchorLabel={`byte[${i}]`}
                      onCancel={() => setDetailPopover(null)}
                      onConfirm={confirmDetailPopover}
                    />
                  )}
                  {popoverOpen && detailPopover.kind === 'color' && (
                    <ColorDetailPopover
                      key={`col-color-${i}`}
                      opened
                      initialDetail={detailPopover.initial}
                      existingGroupIds={existingGroupIds}
                      anchorLabel={`byte[${i}]`}
                      onCancel={() => setDetailPopover(null)}
                      onConfirm={confirmDetailPopover}
                    />
                  )}
                </Popover>
              );
            })}

            {rows.map((row) => (
              <AnalyzerRow
                key={row.id}
                row={row}
                maxLen={maxLen}
                columnTags={columnTags}
                cellTags={cellTags}
                detailPopover={detailPopover}
                existingGroupIds={existingGroupIds}
                onCellClick={(i) => handleClick(row.id, i)}
                onDetailConfirm={confirmDetailPopover}
                onDetailCancel={() => setDetailPopover(null)}
                onSend={() => onSendPacket?.(row.bytes)}
                onEdit={() => onLoadToByteEditor?.(row.bytes)}
                onLog={() => setLoggingRowId(row.id)}
                tagKindMeta={tagKindMeta}
              />
            ))}
          </Box>
        </ScrollArea>
      )}

      {loggingRow && (
        <AnalyzerFindingForm
          row={loggingRow}
          columnTags={columnTags}
          cellTags={cellTags[loggingRowId]}
          rules={rules}
          onCancel={() => setLoggingRowId(null)}
          onSubmit={(entry) => {
            onLogFinding?.(entry);
            setLoggingRowId(null);
          }}
          onGenerateRule={(draftRule) => {
            onGenerateRule?.(draftRule);
          }}
        />
      )}
    </Stack>
  );
}
