import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
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
  BIT_COL_PX,
  BYTE_TAG_KINDS,
  HEX_COL_PX,
  bitAgreementAcross,
  buildAnalyzerStateFromPackets,
  cellHasBitView,
  columnConstancy,
  columnHasBitView,
  createEmptyColorDetail,
  createEmptyParamDetail,
  deserializeByteTags,
  effectiveTag,
  loadBitPatterns,
  looksLikeByteTagsSheetPaste,
  normalizeParamGroups,
  parseAnalyzerInput,
  parseByteTagsSheetPaste,
  saveBitPatterns,
  asIndexList,
  asIndexMap,
  toggleBitCellMap,
  toggleBitColumn,
} from '../../lib/ble/byteAnalyzer';
import { hexToBytes, bytesToHex } from '../../lib/ble/e9Decode';
import { byteToBitString, hasCompanyIdPrefix, stripCompanyId } from '../../lib/ble/wandSimClient';
import { useWandLabUiState } from '../../lib/ble/wandLabUiState';
import { Field } from '../shared/Field';
import { SearchableSelect } from '../shared/SearchableSelect';
import { AnalyzerFindingForm } from './AnalyzerFindingForm';
import { BitColumnHeader, ByteBitCell } from './ByteBitCell';
import { BitGridEditor } from './BitGridEditor';

function nextGroupId(existingGroupIds) {
  let n = 1;
  while (existingGroupIds.includes(`grp${n}`)) n++;
  return `grp${n}`;
}

function ParamDetailPopover({
  opened,
  initialDetail,
  existingParamNames = [],
  onConfirm,
  onCancel,
  anchorLabel,
  byteValue = 0,
  patterns = [],
  onPatternsChange,
}) {
  const initialGroups = normalizeParamGroups(initialDetail);
  const defaultMode = initialDetail?.mode === 'bitgroups' || initialGroups.length > 1
    ? 'bitgroups'
    : 'whole';
  const [mode, setMode] = useState(defaultMode);
  const [name, setName] = useState(initialDetail?.paramName || initialGroups[0]?.name || '');
  const [bitStart, setBitStart] = useState(initialDetail?.bitStart ?? initialGroups[0]?.bitStart ?? 0);
  const [bitCount, setBitCount] = useState(initialDetail?.bitCount ?? initialGroups[0]?.bitCount ?? 8);
  const [groups, setGroups] = useState(initialGroups);

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

  const knownNames = [...new Set(existingParamNames.filter(Boolean))];

  return (
    <Popover.Dropdown>
      <Stack gap={6} p={4} miw={260}>
        <Text size="xs" fw={600}>
          {anchorLabel}
        </Text>
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={setMode}
          data={[
            { value: 'whole', label: 'Whole byte' },
            { value: 'bitgroups', label: 'Bit groups' },
          ]}
        />
        {mode === 'bitgroups' ? (
          <>
            <BitGridEditor
              byteValue={byteValue}
              groups={groups}
              onGroupsChange={setGroups}
              showTimingPreset
              patterns={patterns}
              onPatternsChange={onPatternsChange}
            />
            <Group justify="flex-end" gap={6}>
              <Button size="compact-xs" variant="default" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                size="compact-xs"
                onClick={() => onConfirm({ mode: 'bitgroups', groups })}
              >
                Set
              </Button>
            </Group>
          </>
        ) : (
          <>
            {knownNames.length > 0 && (
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Reuse name
                </Text>
                <Group gap={4}>
                  {knownNames.map((n) => (
                    <Button
                      key={n}
                      size="compact-xs"
                      variant={name === n ? 'filled' : 'light'}
                      onClick={() => setName(n)}
                    >
                      {n}
                    </Button>
                  ))}
                </Group>
              </Stack>
            )}
            <TextInput
              size="xs"
              label={knownNames.length ? 'Or type new name' : 'Param name'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. sx, intensity"
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
          </>
        )}
      </Stack>
    </Popover.Dropdown>
  );
}

/** RGB channel + group picker — only used when Color mode is RGB. */
function RgbChannelPopover({
  opened,
  initialDetail,
  existingGroupIds,
  onConfirm,
  onCancel,
  anchorLabel,
}) {
  const [channelRole, setChannelRole] = useState(initialDetail?.channelRole || 'r');
  const [groupId, setGroupId] = useState(initialDetail?.groupId || nextGroupId(existingGroupIds));

  if (!opened) return null;

  const groupOptions = [...new Set([groupId, ...existingGroupIds].filter(Boolean))].map((g) => ({
    value: g,
    label: g,
  }));

  return (
    <Popover.Dropdown>
      <Stack gap={6} p={4} miw={220}>
        <Text size="xs" fw={600}>
          {anchorLabel}
        </Text>
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
        <Group justify="flex-end" gap={6}>
          <Button size="compact-xs" variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="compact-xs"
            onClick={() =>
              onConfirm({
                mode: 'rgb',
                channelRole,
                groupId: groupId || nextGroupId(existingGroupIds),
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

function TagSuffix({ tag }) {
  if (tag?.kind === 'param') {
    const groups = normalizeParamGroups(tag.detail);
    if (groups.length > 1) {
      return (
        <Text span size="xs" c="dimmed" style={{ fontSize: 8, display: 'block' }}>
          {groups.map((g) => g.name || '·').join(' ')}
        </Text>
      );
    }
    const g = groups[0];
    if (g && g.bitCount < 8) {
      return (
        <Text span size="xs" c="dimmed" style={{ fontSize: 8, display: 'block' }}>
          b{g.bitStart + g.bitCount - 1}:{g.bitStart}
        </Text>
      );
    }
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
  existingParamNames,
  onDetailConfirm,
  onDetailCancel,
  onSend,
  onEdit,
  onLog,
  onRemove,
  tagKindMeta,
  compareSelection = [],
  patterns = [],
  onPatternsChange,
  bitColumns = [],
  bitCells,
  onToggleBits,
}) {
  const [hovered, setHovered] = useState(false);
  const hoverHandlers = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };
  const rowBg = hovered
    ? 'color-mix(in srgb, var(--mantine-color-blue-filled) 14%, transparent)'
    : undefined;

  return (
    <>
      <Box
        {...hoverHandlers}
        style={{
          fontSize: 10,
          fontFamily: 'monospace',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          justifyContent: 'center',
          paddingRight: 4,
          paddingLeft: 2,
          borderRadius: 4,
          background: rowBg,
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
          <Button
            size="compact-xs"
            color="red"
            variant="subtle"
            onClick={onRemove}
            title="Remove row"
          >
            ✕
          </Button>
        </Group>
      </Box>
      {Array.from({ length: maxLen }).map((_, i) => {
        const tag = effectiveTag(i, row.id, columnTags, cellTags);
        const meta = tag ? tagKindMeta(tag.kind) : null;
        const byte = i < row.bytes.length ? row.bytes[i] : null;
        const popoverOpen = detailPopover?.rowId === row.id && detailPopover?.index === i;
        const cmpIdx = compareSelection.findIndex((s) => s.rowId === row.id && s.index === i);
        const showBits = byte != null && cellHasBitView(bitColumns, bitCells, row.id, i);
        return (
          <Popover key={i} opened={popoverOpen} withArrow position="bottom">
            <Popover.Target>
              <Box {...hoverHandlers} style={{ background: rowBg, borderRadius: 4 }}>
                <ByteBitCell
                  byteValue={byte ?? 0}
                  empty={byte == null}
                  showBits={showBits}
                  onToggleBits={() => byte != null && onToggleBits(row.id, i)}
                  tagColor={meta?.color}
                  suffix={<TagSuffix tag={tag} />}
                  compareMark={cmpIdx >= 0 ? cmpIdx + 1 : null}
                />
              </Box>
            </Popover.Target>
            {popoverOpen && detailPopover.kind === 'param' && (
              <ParamDetailPopover
                opened
                initialDetail={detailPopover.initial}
                existingParamNames={existingParamNames}
                anchorLabel={`row cell[${i}]`}
                byteValue={byte ?? 0}
                patterns={patterns}
                onPatternsChange={onPatternsChange}
                onCancel={onDetailCancel}
                onConfirm={onDetailConfirm}
              />
            )}
            {popoverOpen && detailPopover.kind === 'color' && (
              <RgbChannelPopover
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

export const EMPTY_ANALYZER_SESSION = {
  pasteText: '',
  rows: [],
  strip8301: true,
  columnTags: {},
  cellTags: {},
  activeTag: 'signature',
  colorMode: 'palette',
  importNote: '',
};

export function WandLabAnalyzerTab({
  onSendPacket,
  onLoadToByteEditor,
  onLogFinding,
  rules,
  onGenerateRule,
  importSeed = null,
  onImportSeedConsumed,
  onStatus,
  session = EMPTY_ANALYZER_SESSION,
  onSessionChange,
  simIp: _simIp,
}) {
  const pasteText = session.pasteText ?? '';
  const rows = session.rows ?? [];
  const strip8301 = session.strip8301 !== false;
  const columnTags = session.columnTags ?? {};
  const cellTags = session.cellTags ?? {};
  const activeTag = session.activeTag || 'signature';
  const colorMode = session.colorMode || 'palette';
  const importNote = session.importNote || '';

  const patchSession = (partial) => {
    onSessionChange?.({ ...EMPTY_ANALYZER_SESSION, ...session, ...partial });
  };

  // Ephemeral UI only — not cached across tab switches (except Wand Lab UI localStorage)
  const [detailPopover, setDetailPopover] = useState<any>(null);
  const [loggingRowId, setLoggingRowId] = useState<any>(null);
  const [newRowHex, setNewRowHex] = useState('');
  const [newRowMsg, setNewRowMsg] = useState('');
  const [compareMode, setCompareMode] = useWandLabUiState('analyzer.compareMode', false);
  const [compareSelection, setCompareSelection] = useWandLabUiState('analyzer.compareSelection', []);
  const [bitCells, setBitCells] = useWandLabUiState('analyzer.bitCells', () => ({}));
  const [bitColumns, setBitColumns] = useWandLabUiState('analyzer.bitColumns', () => []);
  const [patterns, setPatternsState] = useState(loadBitPatterns);

  const setPatterns = (next) => {
    const list = typeof next === 'function' ? next(patterns) : next;
    setPatternsState(saveBitPatterns(list));
  };

  const applyPacketState = (packets, note = '') => {
    const state = buildAnalyzerStateFromPackets(packets);
    patchSession({
      rows: state.rows,
      columnTags: state.columnTags,
      cellTags: state.cellTags,
      importNote: note,
    });
    setDetailPopover(null);
    setLoggingRowId(null);
    setCompareSelection([]);
  };

  const parseInput = () => {
    if (looksLikeByteTagsSheetPaste(pasteText)) {
      const result = parseByteTagsSheetPaste(pasteText, { strip8301 });
      if (!result.ok) {
        onStatus?.(result.message);
        patchSession({ importNote: result.message });
        return;
      }
      applyPacketState(result.packets, result.message);
      onStatus?.(result.message);
      return;
    }
    patchSession({
      rows: parseAnalyzerInput(pasteText, { strip8301 }),
      columnTags: {},
      cellTags: {},
      importNote: '',
    });
    setDetailPopover(null);
    setLoggingRowId(null);
    setCompareSelection([]);
  };

  useEffect(() => {
    if (!importSeed?.key || !Array.isArray(importSeed.packets) || !importSeed.packets.length)
      return;
    const strip = importSeed.strip8301 ?? true;
    const packets = importSeed.packets
      .map((p, i) => {
        let bytes = Array.isArray(p.bytes) && p.bytes.length ? p.bytes : null;
        if (!bytes) {
          let hex = String(p.hex || p.raw || '').replace(/[^0-9a-fA-F]/g, '');
          if (strip && hasCompanyIdPrefix(hex)) hex = stripCompanyId(hex);
          bytes = hexToBytes(hex);
        }
        const tags =
          Array.isArray(p.tags) && p.tags.length
            ? p.tags
            : deserializeByteTags(p.byteTagsSerialized || '', bytes.length);
        return {
          id: p.id || `seed-${importSeed.key}-${i}`,
          raw: p.hex || p.raw || '',
          bytes,
          tags,
          opcode: p.opcode || '',
          notes: p.notes || '',
          findingId: p.findingId || '',
          linkedRuleId: p.linkedRuleId || '',
          byteTagsSerialized: p.byteTagsSerialized || '',
        };
      })
      .filter((p) => p.bytes.length > 0);

    if (!packets.length) {
      onStatus?.('Could not load analyzer packets (empty hex)');
      onImportSeedConsumed?.();
      return;
    }
    applyPacketState(
      packets,
      `Loaded ${packets.length} tagged packet${packets.length === 1 ? '' : 's'} for editing`,
    );
    onStatus?.(
      `Loaded ${packets.length} tagged packet${packets.length === 1 ? '' : 's'} into analyzer`,
    );
    onImportSeedConsumed?.();
  }, [importSeed?.key]);

  const maxLen = useMemo(() => rows.reduce((m, r) => Math.max(m, r.bytes.length), 0), [rows]);
  const constancy = useMemo(() => columnConstancy(rows), [rows]);
  const bitColTemplate = useMemo(() => {
    const cols = Array.from({ length: maxLen }, (_, i) =>
      columnHasBitView(bitColumns, bitCells, i) ? `${BIT_COL_PX}px` : `${HEX_COL_PX}px`,
    );
    return `10.5rem ${cols.join(' ')}`.trim();
  }, [maxLen, bitColumns, bitCells]);
  const bitGridMinWidth = useMemo(() => {
    let w = 168;
    for (let i = 0; i < maxLen; i++) {
      w += columnHasBitView(bitColumns, bitCells, i) ? BIT_COL_PX + 2 : HEX_COL_PX + 2;
    }
    return w;
  }, [maxLen, bitColumns, bitCells]);

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

  const existingParamNames = useMemo(() => {
    const names = new Set<string>();
    const scan = (tag) => {
      if (tag?.kind !== 'param') return;
      const n = String(tag.detail?.paramName || '').trim();
      if (n) names.add(n);
      normalizeParamGroups(tag.detail).forEach((g) => {
        const gn = String(g.name || '').trim();
        if (gn) names.add(gn);
      });
    };
    Object.values(columnTags).forEach(scan);
    Object.values(cellTags).forEach((rowMap) => Object.values(rowMap).forEach(scan));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [columnTags, cellTags]);

  const applyTag = (rowId, index, entry) => {
    if (rowId == null) {
      const next = { ...columnTags };
      if (entry == null) delete next[index];
      else next[index] = entry;
      patchSession({ columnTags: next });
    } else {
      const rowMap = { ...(cellTags[rowId] || {}) };
      if (entry == null) delete rowMap[index];
      else rowMap[index] = entry;
      patchSession({ cellTags: { ...cellTags, [rowId]: rowMap } });
    }
  };

  const removeRow = (rowId) => {
    const nextRows = rows.filter((r) => r.id !== rowId);
    const nextCellTags = { ...cellTags };
    delete nextCellTags[rowId];
    patchSession({ rows: nextRows, cellTags: nextCellTags });
    if (loggingRowId === rowId) setLoggingRowId(null);
    if (detailPopover?.rowId === rowId) setDetailPopover(null);
    setCompareSelection((prev) => (prev || []).filter((s) => s.rowId !== rowId));
  };

  /** Append packet(s) from the new-row hex field (one hex line per row). Empty → blank zeros. */
  const addRow = () => {
    const text = newRowHex.trim();
    if (!text) {
      const len = maxLen || rows[0]?.bytes?.length || 16;
      const bytes = Array.from({ length: len }, () => 0);
      const id = `row-add-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      patchSession({
        rows: [
          ...rows,
          {
            id,
            raw: bytesToHex(bytes),
            bytes,
            opcode: '',
            notes: '',
            findingId: '',
            linkedRuleId: '',
          },
        ],
      });
      setNewRowMsg(`Added blank ${len}-byte row`);
      return;
    }

    if (looksLikeByteTagsSheetPaste(text)) {
      const result = parseByteTagsSheetPaste(text, { strip8301 });
      if (!result.ok) {
        setNewRowMsg(result.message);
        onStatus?.(result.message);
        return;
      }
      const state = buildAnalyzerStateFromPackets(result.packets);
      // Merge tags: keep existing column tags; attach imported cell tags under new ids
      const mergedCellTags = { ...cellTags, ...state.cellTags };
      const mergedColumnTags = { ...columnTags };
      Object.entries(state.columnTags).forEach(([idx, tag]) => {
        if (mergedColumnTags[idx] == null) mergedColumnTags[idx] = tag;
      });
      patchSession({
        rows: [...rows, ...state.rows],
        cellTags: mergedCellTags,
        columnTags: mergedColumnTags,
      });
      setNewRowHex('');
      setNewRowMsg(result.message);
      onStatus?.(result.message);
      return;
    }

    const parsed = parseAnalyzerInput(text, { strip8301 });
    if (!parsed.length) {
      const msg = 'No valid hex in paste — expect even-length hex (optional 8301)';
      setNewRowMsg(msg);
      onStatus?.(msg);
      return;
    }
    patchSession({ rows: [...rows, ...parsed] });
    setNewRowHex('');
    setNewRowMsg(
      parsed.length === 1
        ? `Added ${parsed[0].bytes.length}-byte row`
        : `Added ${parsed.length} rows`,
    );
  };

  /** Clear the assignment that paints this cell (cell override, else column default). */
  const clearAssignment = (rowId, index) => {
    if (rowId != null && cellTags[rowId]?.[index]) {
      applyTag(rowId, index, null);
    } else {
      applyTag(null, index, null);
    }
    setDetailPopover(null);
  };

  const handleClick = (rowId, index) => {
    if (compareMode) {
      if (rowId == null) return;
      setCompareSelection((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const idx = list.findIndex((s) => s.rowId === rowId && s.index === index);
        if (idx >= 0) return list.filter((_, i) => i !== idx);
        return [...list, { rowId, index }];
      });
      return;
    }

    const assigned = effectiveTag(index, rowId ?? undefined, columnTags, cellTags);
    if (assigned?.kind === 'param') {
      setDetailPopover({
        kind: 'param',
        rowId,
        index,
        initial: assigned.detail || createEmptyParamDetail(),
      });
      return;
    }
    if (assigned) {
      clearAssignment(rowId, index);
      return;
    }

    if (activeTag === 'param') {
      setDetailPopover({
        kind: 'param',
        rowId,
        index,
        initial: createEmptyParamDetail(),
      });
      return;
    }

    if (activeTag === 'color') {
      if (colorMode === 'palette') {
        applyTag(rowId, index, { kind: 'color', detail: { mode: 'palette' } });
        return;
      }
      setDetailPopover({
        kind: 'color',
        rowId,
        index,
        initial: { ...createEmptyColorDetail(), mode: 'rgb', channelRole: 'r' },
      });
      return;
    }

    applyTag(rowId, index, { kind: activeTag, detail: {} });
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

  const compareEntries = useMemo(() => {
    const list = Array.isArray(compareSelection) ? compareSelection : [];
    return list.map((sel, i) => {
      const row = rows.find((r) => r.id === sel.rowId);
      const byte = row && sel.index < row.bytes.length ? row.bytes[sel.index] & 0xff : null;
      const first = i === 0 ? byte : (rows.find((r) => r.id === list[0].rowId)?.bytes[list[0].index] ?? null);
      const firstVal = first != null ? first & 0xff : null;
      return { ...sel, i, row, byte, firstVal };
    });
  }, [compareSelection, rows]);

  const compareBits = useMemo(() => {
    const vals = compareEntries.map((e) => e.byte).filter((v) => v != null);
    if (vals.length < 2) return null;
    return bitAgreementAcross(vals);
  }, [compareEntries]);

  const flipColumn = (index) => {
    const next = toggleBitColumn(bitColumns, bitCells, index);
    setBitColumns(next.bitColumns);
    setBitCells(next.bitCells);
  };

  const selectColumnForCompare = (index) => {
    const col = Number(index);
    const next = rows
      .filter((r) => col < (r.bytes?.length || 0))
      .map((r) => ({ rowId: r.id, index: col }));
    setCompareSelection((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const atCol = list.filter((s) => Number(s.index) === col);
      const complete =
        next.length > 0 &&
        atCol.length === next.length &&
        atCol.length === list.length &&
        next.every((n) => atCol.some((s) => s.rowId === n.rowId));
      return complete ? [] : next;
    });
  };

  return (
    <Stack gap="md">
      <Text size="xs" c="dimmed">
        Paste bare hex (one packet per line), or paste rows from the Sheets{' '}
        <Text span ff="monospace">
          byte_tags
        </Text>{' '}
        tab (with header) to reload tags for editing. Click a cell to flip hex ↔ bits. Click a
        column header to flip the whole column.
      </Text>

      <Textarea
        autosize
        minRows={3}
        maxRows={8}
        placeholder={
          'Hex only:\n8301E90C0F19...\n\nOr Sheets byte_tags paste:\nfinding_id\tcreated_at\topcode\thex\tbyte_tags\t...'
        }
        value={pasteText}
        onChange={(e) => patchSession({ pasteText: e.target.value })}
        styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
      />
      <Group gap="xs" align="center" wrap="wrap">
        <Checkbox
          label="Strip 8301 for payload bytes"
          checked={strip8301}
          onChange={(e) => patchSession({ strip8301: e.currentTarget.checked })}
        />
        <Button size="xs" onClick={parseInput}>
          {looksLikeByteTagsSheetPaste(pasteText) ? 'Import sheet rows' : 'Parse'}{' '}
          {pasteText.split('\n').filter((l) => l.trim()).length || ''} lines
        </Button>
        {rows.length > 0 && (
          <>
            <Text size="xs" c="dimmed">
              {rows.length} packets, max {maxLen} bytes
              {strip8301 ? ' (8301 stripped)' : ''}
            </Text>
            <Button
              size="xs"
              variant="default"
              onClick={() => {
                patchSession({ ...EMPTY_ANALYZER_SESSION, strip8301 });
                setDetailPopover(null);
                setLoggingRowId(null);
                setNewRowHex('');
                setNewRowMsg('');
              }}
            >
              Clear session
            </Button>
          </>
        )}
      </Group>
      {importNote ? (
        <Text size="xs" c="teal">
          {importNote}
        </Text>
      ) : null}

      <Group gap="xs" align="flex-end" wrap="wrap">
        <TextInput
          size="xs"
          label="Add row from hex"
          placeholder="Paste hex (one packet per line) — empty adds blank zeros"
          value={newRowHex}
          onChange={(e) => { setNewRowHex(e.target.value); setNewRowMsg(''); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              addRow();
            }
          }}
          style={{ flex: 1, minWidth: 220 }}
          styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
        />
        <Button size="xs" onClick={addRow}>
          {newRowHex.trim() ? 'Add pasted row(s)' : 'Add blank row'}
        </Button>
      </Group>
      {newRowMsg ? (
        <Text size="xs" c="dimmed">{newRowMsg}</Text>
      ) : null}

      <Group gap={6} align="center" wrap="wrap">
        <Text size="xs" c="dimmed" fw={600}>
          Tag:
        </Text>
        {BYTE_TAG_KINDS.map((k) => (
          <Button
            key={k.id}
            size="compact-xs"
            variant={activeTag === k.id ? 'filled' : 'outline'}
            color={k.color}
            onClick={() => patchSession({ activeTag: k.id })}
          >
            {k.label}
          </Button>
        ))}
        {activeTag === 'color' && (
          <SegmentedControl
            size="xs"
            value={colorMode}
            onChange={(v) => patchSession({ colorMode: v })}
            data={[
              { value: 'palette', label: 'Palette' },
              { value: 'rgb', label: 'RGB' },
            ]}
          />
        )}
        <Button
          size="compact-xs"
          variant={compareMode ? 'filled' : 'outline'}
          color="pink"
          onClick={() => setCompareMode((v) => !v)}
        >
          Compare
        </Button>
        <Button
          size="compact-xs"
          variant="default"
          disabled={!(asIndexList(bitColumns).length || Object.keys(asIndexMap(bitCells)).length)}
          onClick={() => {
            setBitColumns([]);
            setBitCells({});
          }}
        >
          Reset cells
        </Button>
        {compareMode && (
          <Text size="xs" c="dimmed">
            Click cells to compare. Click a column header to compare that byte across all rows.
          </Text>
        )}
      </Group>

      {compareMode && compareEntries.length > 0 && (
        <Box p="sm" style={{ border: '1px solid var(--mantine-color-pink-6)', borderRadius: 8 }}>
          <Group justify="space-between" mb={6}>
            <Text size="xs" fw={600}>
              Compare ({compareEntries.length} selected)
            </Text>
            <Button size="compact-xs" variant="default" onClick={() => setCompareSelection([])}>
              Clear
            </Button>
          </Group>
          <ScrollArea type="auto" mah={320}>
            <Box
              style={{
                display: 'grid',
                gridTemplateColumns: compareBits
                  ? '1.6rem 8.6rem 2.6rem 2rem 5.2rem repeat(8, 1.15rem) minmax(10rem, auto)'
                  : '1.6rem 8.6rem 2.6rem 2rem 5.2rem minmax(10rem, auto)',
                columnGap: 8,
                rowGap: 4,
                alignItems: 'center',
                minWidth: 720,
              }}
            >
              {compareBits && (
                <>
                  <Text size="xs" c="dimmed" ff="monospace" style={{ gridColumn: '1 / 6' }}>bits</Text>
                  {compareBits.map((b) => (
                    <Text key={`h-${b.bitIdx}`} size="xs" ta="center" ff="monospace" c="dimmed">{b.bitIdx}</Text>
                  ))}
                  <Box />
                </>
              )}
              {compareEntries.map((e) => {
                const delta = e.byte != null && e.firstVal != null && e.i > 0 ? e.byte - e.firstVal : null;
                const xor = e.byte != null && e.firstVal != null && e.i > 0 ? e.byte ^ e.firstVal : null;
                const shortId = String(e.rowId || '').replace(/^row-/, '').slice(0, 8);
                return (
                  <Box key={`${e.rowId}-${e.index}`} style={{ display: 'contents' }}>
                    <Text size="xs" fw={700} c="pink">#{e.i + 1}</Text>
                    <Text size="xs" ff="monospace">row{shortId}[{e.index}]</Text>
                    <Text size="xs" ff="monospace">
                      {e.byte != null ? `0x${(e.byte).toString(16).padStart(2, '0').toUpperCase()}` : '—'}
                    </Text>
                    <Text size="xs" ff="monospace">{e.byte != null ? e.byte : ''}</Text>
                    <Text size="xs" ff="monospace">{e.byte != null ? byteToBitString(e.byte) : ''}</Text>
                    {(compareBits || []).map((b) => (
                      <Text
                        key={`${e.rowId}-${e.index}-${b.bitIdx}`}
                        size="xs"
                        ta="center"
                        ff="monospace"
                        c={e.byte == null ? 'dimmed' : b.agree ? 'teal' : 'orange'}
                      >
                        {e.byte == null ? '·' : (e.byte >> b.bitIdx) & 1}
                      </Text>
                    ))}
                    <Text size="xs" c="dimmed">
                      {delta == null
                        ? ''
                        : delta === 0
                          ? 'Δ vs #1: same'
                          : `Δ vs #1: ${delta > 0 ? '+' : ''}${delta} dec, XOR ${byteToBitString(xor)}`}
                    </Text>
                  </Box>
                );
              })}
              {compareBits && (
                <>
                  <Text size="xs" c="dimmed" ff="monospace" style={{ gridColumn: '1 / 6' }}>agree</Text>
                  {compareBits.map((b) => (
                    <Text key={`a-${b.bitIdx}`} size="xs" ta="center" ff="monospace" c={b.agree ? 'teal' : 'orange'}>
                      {b.agree ? '═' : '·'}
                    </Text>
                  ))}
                  <Box />
                </>
              )}
            </Box>
          </ScrollArea>
        </Box>
      )}

      {rows.length > 0 && (
        <ScrollArea type="auto">
          <Box
            style={{
              display: 'grid',
              gridTemplateColumns: bitColTemplate,
              gap: 2,
              minWidth: bitGridMinWidth,
              alignItems: 'start',
            }}
          >
            <Box />
            {Array.from({ length: maxLen }).map((_, i) => {
              const tag = columnTags[i];
              const meta = tag ? tagKindMeta(tag.kind) : null;
              const c = constancy[i];
              const popoverOpen = detailPopover?.rowId == null && detailPopover?.index === i;
              const showBits = columnHasBitView(bitColumns, bitCells, i);
              return (
                <Popover key={i} opened={popoverOpen} withArrow position="bottom">
                  <Popover.Target>
                    <Tooltip
                      label={
                        compareMode
                          ? `Click to compare byte[${i}] across all ${rows.length} row(s)`
                          : `Click to flip column ${i} hex ↔ bits · ${c?.distinctCount ?? 0} distinct value(s)`
                      }
                    >
                      <Box>
                        <BitColumnHeader
                          index={i}
                          showBits={showBits}
                          constant={!!c?.constant}
                          tagColor={meta?.color}
                          onClick={() => {
                            if (compareMode) selectColumnForCompare(i);
                            else flipColumn(i);
                          }}
                        >
                          <TagSuffix tag={tag} />
                        </BitColumnHeader>
                      </Box>
                    </Tooltip>
                  </Popover.Target>
                  {popoverOpen && detailPopover.kind === 'param' && (
                    <ParamDetailPopover
                      key={`col-param-${i}`}
                      opened
                      initialDetail={detailPopover.initial}
                      existingParamNames={existingParamNames}
                      anchorLabel={`byte[${i}]`}
                      byteValue={rows[0]?.bytes[i] ?? 0}
                      patterns={patterns}
                      onPatternsChange={setPatterns}
                      onCancel={() => setDetailPopover(null)}
                      onConfirm={confirmDetailPopover}
                    />
                  )}
                  {popoverOpen && detailPopover.kind === 'color' && (
                    <RgbChannelPopover
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
                existingParamNames={existingParamNames}
                onDetailConfirm={confirmDetailPopover}
                onDetailCancel={() => setDetailPopover(null)}
                onSend={() => onSendPacket?.(row.bytes)}
                onEdit={() => onLoadToByteEditor?.(row.bytes)}
                onLog={() => setLoggingRowId(row.id)}
                onRemove={() => removeRow(row.id)}
                tagKindMeta={tagKindMeta}
                compareSelection={Array.isArray(compareSelection) ? compareSelection : []}
                patterns={patterns}
                onPatternsChange={setPatterns}
                bitColumns={bitColumns}
                bitCells={bitCells}
                onToggleBits={(rowId, index) => {
                  if (compareMode) {
                    handleClick(rowId, index);
                    return;
                  }
                  setBitCells((prev) => toggleBitCellMap(prev, rowId, index));
                }}
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
          initialOpcode={loggingRow.opcode || ''}
          initialNotes={loggingRow.notes || ''}
          initialLinkedRuleId={loggingRow.linkedRuleId || ''}
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
