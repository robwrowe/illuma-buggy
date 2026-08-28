import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
  Group,
  NumberInput,
  SegmentedControl,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { Field } from '../shared/Field';
import { SearchableSelect } from '../shared/SearchableSelect';
import { generateId } from '../../lib/utils';
import { DEFAULT_MB_WLED_COLORS, mbPaletteOptions } from '../../lib/ble/mbConstants';
import { decodeMbColorMaskByte } from '../../lib/ble/mbPayloads';
import { byteToBitString, parseBitStringToByte } from '../../lib/ble/wandSimClient';
import { useWandLabUiState } from '../../lib/ble/wandLabUiState';
import {
  BIT_COL_PX,
  HEX_COL_PX,
  asIndexMap,
  asIndexList,
  cellHasBitView,
  columnConstancy,
  columnHasBitView,
  decodeBitGroupValue,
  encodeBitGroupValue,
  customBitFieldMax,
  bitRangeLabel,
  shiftRowIndexMap,
  toggleBitCellMap,
  toggleBitColumn,
} from '../../lib/ble/byteAnalyzer';
import { BitColumnHeader, ByteBitCell } from './ByteBitCell';
import { TimingByteFields } from './TimingByteFields';
import {
  TAIL_BUILDER_COLOR_FORMATS,
  assembleTailPayload,
  encodeTailColorByte,
  omitConsecutiveDuplicateTails,
  parseTailBytes,
  parseTailList,
  tailBytesToDisplayHex,
} from '../../lib/ble/tailBuilder';

const DEFAULT_TAIL_RAW = '58 F4 48 82 D1 46 02 08 D0 65 00';

const MAX_NIBBLE_SPECS = 16;

function clampBitStart(n) {
  return Math.max(0, Math.min(7, Number(n) || 0));
}

function clampBitCount(bitStart, bitCount) {
  const start = clampBitStart(bitStart);
  return Math.max(1, Math.min(8 - start, Number(bitCount) || 1));
}

function bitsFromLegacyWhich(which) {
  return which === 'lo' ? { bitStart: 0, bitCount: 4 } : { bitStart: 4, bitCount: 4 };
}

function defaultNibbleSpecs() {
  return [{ id: 'n0', byteIdx: 0, bitStart: 4, bitCount: 4 }];
}

function normalizeNibbleSpecs(list) {
  if (!Array.isArray(list) || !list.length) return [];
  return list.slice(0, MAX_NIBBLE_SPECS).map((s, i) => {
    let bitStart = s?.bitStart;
    let bitCount = s?.bitCount;
    if ((bitStart == null || bitCount == null) && s?.which) {
      const migrated = bitsFromLegacyWhich(s.which);
      bitStart = bitStart ?? migrated.bitStart;
      bitCount = bitCount ?? migrated.bitCount;
    }
    bitStart = clampBitStart(bitStart);
    bitCount = clampBitCount(bitStart, bitCount ?? 4);
    return {
      id: typeof s?.id === 'string' && s.id ? s.id : `n${i}`,
      byteIdx: Math.max(0, Number(s?.byteIdx) || 0),
      bitStart,
      bitCount,
    };
  });
}

function nibbleSpecLabel(spec) {
  return `[${spec.byteIdx}] ${bitRangeLabel(spec.bitStart, spec.bitCount)}`;
}

function nibbleDec(bytes, spec) {
  const byteIdx = Number(spec.byteIdx) || 0;
  if (!bytes || byteIdx >= bytes.length) return null;
  return decodeBitGroupValue(bytes[byteIdx], spec.bitStart, spec.bitCount);
}

function nibbleSpecKey(spec) {
  return `${spec.byteIdx}:${spec.bitStart}:${spec.bitCount}`;
}

function nextNibblePlacement(specs, tailMaxLen) {
  const last = specs[specs.length - 1];
  const maxByte = Math.max(0, (Number(tailMaxLen) || 1) - 1);
  if (!last) return { byteIdx: 0, bitStart: 4, bitCount: 4 };
  const nextByte = (Number(last.byteIdx) || 0) + 1;
  if (nextByte <= maxByte) {
    return { byteIdx: nextByte, bitStart: last.bitStart, bitCount: last.bitCount };
  }
  const byteIdx = Math.min(Number(last.byteIdx) || 0, maxByte);
  const used = new Set(specs.filter((s) => s.byteIdx === byteIdx).map(nibbleSpecKey));
  const candidates = [
    { byteIdx, bitStart: 0, bitCount: 4 },
    { byteIdx, bitStart: 4, bitCount: 4 },
    { byteIdx, bitStart: 0, bitCount: 8 },
    { byteIdx, bitStart: 0, bitCount: 2 },
    { byteIdx, bitStart: 2, bitCount: 2 },
    { byteIdx, bitStart: 4, bitCount: 2 },
    { byteIdx, bitStart: 6, bitCount: 2 },
  ];
  return candidates.find((c) => !used.has(nibbleSpecKey(c)))
    || { byteIdx, bitStart: last.bitStart, bitCount: last.bitCount };
}

function origHexListFromRaw(raw) {
  return parseTailList(raw).tails.map((t) => t.hex);
}

const TAIL_TEMPLATES = [];

const VIBRATION_OPTIONS = [
  { value: 'none', label: 'None (omit byte)', searchText: 'none omit' },
  { value: '0', label: '0x0 — none', searchText: '0x0 none' },
  { value: '1', label: '0x1 — - (6s break)', searchText: '0x1' },
  { value: '2', label: '0x2 — -- (6s break) --', searchText: '0x2' },
  { value: '3', label: '0x3 — --- (6s break) ---', searchText: '0x3' },
  { value: '4', label: '0x4 — --* (4s break)', searchText: '0x4' },
  { value: '5', label: '0x5 — ----*- (3s break)', searchText: '0x5' },
  { value: '6', label: '0x6 — ---***--- (3s break)', searchText: '0x6' },
  { value: '7', label: '0x7 — # (4s break)', searchText: '0x7' },
  { value: '8', label: "0x8 — '''''' pattern", searchText: '0x8' },
  { value: '9', label: '0x9 — - (6s break)', searchText: '0x9' },
  { value: '10', label: '0xA — * (6s break)', searchText: '0xa' },
  { value: '11', label: '0xB — % (5s break)', searchText: '0xb' },
  { value: '12', label: '0xC — none', searchText: '0xc none' },
  { value: '13', label: '0xD — none', searchText: '0xd none' },
  { value: '14', label: '0xE — none', searchText: '0xe none' },
  { value: '15', label: '0xF — none', searchText: '0xf none' },
];

function defaultColor() {
  return { kind: 'palette', paletteIdx: 0, mask: 0, r: 0, g: 0, b: 0 };
}

function defaultColors(n) {
  return Array.from({ length: n }, defaultColor);
}

function parseVibrationValue(raw) {
  if (raw === '' || raw == null || raw === 'none') return null;
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0 || n > 15) return null;
  return n;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseHexByte(raw) {
  const t = String(raw || '')
    .trim()
    .replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{1,2}$/.test(t)) return null;
  return parseInt(t, 16) & 0xff;
}

function ByteHexBitsEditor({ byteValue, onChange }) {
  const value = Number(byteValue) & 0xff;
  const [bitsDraft, setBitsDraft] = useState(() => byteToBitString(value));
  const [hexDraft, setHexDraft] = useState(() => value.toString(16).padStart(2, '0').toUpperCase());

  useEffect(() => {
    setBitsDraft(byteToBitString(value));
    setHexDraft(value.toString(16).padStart(2, '0').toUpperCase());
  }, [value]);

  const commitByte = (n) => {
    if (!Number.isFinite(n)) return;
    onChange?.(n & 0xff);
  };

  return (
    <Group gap={6} align="flex-end" wrap="nowrap">
      <TextInput
        label="Bits"
        value={bitsDraft}
        onChange={(e) => {
          const clean = e.currentTarget.value.replace(/[^01]/g, '').slice(0, 8);
          setBitsDraft(clean);
          if (clean.length === 8) {
            const val = parseBitStringToByte(clean);
            if (val != null) commitByte(val);
          }
        }}
        onBlur={() => {
          if (!bitsDraft.length) {
            setBitsDraft(byteToBitString(value));
            return;
          }
          const padded = bitsDraft.padStart(8, '0');
          setBitsDraft(padded);
          const val = parseBitStringToByte(padded);
          if (val != null) commitByte(val);
        }}
        size="xs"
        ff="monospace"
        placeholder="00000000"
        w={96}
        styles={{ input: { paddingInline: 6 } }}
      />
      <TextInput
        label="Hex"
        value={hexDraft}
        onChange={(e) => {
          const clean = e.currentTarget.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 2);
          setHexDraft(clean.toUpperCase());
          if (clean.length === 2) {
            const val = parseHexByte(clean);
            if (val != null) commitByte(val);
          }
        }}
        onBlur={() => {
          const val = parseHexByte(hexDraft);
          if (val == null) {
            setHexDraft(value.toString(16).padStart(2, '0').toUpperCase());
            return;
          }
          setHexDraft(val.toString(16).padStart(2, '0').toUpperCase());
          commitByte(val);
        }}
        size="xs"
        ff="monospace"
        placeholder="00"
        w={56}
        styles={{ input: { paddingInline: 6 } }}
      />
    </Group>
  );
}

function entryFromBytes(bytes) {
  const b = (bytes || []).map((x) => x & 0xff);
  return {
    bytes: b,
    hex: b.map((x) => x.toString(16).padStart(2, '0')).join(''),
    displayHex: tailBytesToDisplayHex(b),
  };
}

function tailsToRaw(tails) {
  return (tails || []).map((t) => tailBytesToDisplayHex(t.bytes)).join('\n');
}

function ColorSwatchBox({ background }) {
  return (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: 4,
        flex: '0 0 auto',
        background: background || '#000',
        border: '1px solid var(--border)',
      }}
    />
  );
}

export function WandLabTailBuilderTab({
  simIp,
  onStatus,
  onSendPacket,
  onLoadToByteEditor,
  onSendToAnalyzer,
  onLogTail,
}) {
  const [timingByte, setTimingByte] = useWandLabUiState('tail.timingByte', 0x0f);
  const [colorFormat, setColorFormat] = useWandLabUiState('tail.colorFormat', '0f');
  const [colorCount, setColorCount] = useWandLabUiState('tail.colorCount', 2);
  const [maskFollowsColorCount, setMaskFollowsColorCount] = useWandLabUiState(
    'tail.maskFollowsColorCount',
    true,
  );
  const [colors, setColors] = useWandLabUiState('tail.colors', () => defaultColors(2));
  const [tailRaw, setTailRaw] = useWandLabUiState('tail.raw', DEFAULT_TAIL_RAW);
  const [enteredRaw, setEnteredRaw] = useWandLabUiState('tail.enteredRaw', DEFAULT_TAIL_RAW);
  const [origRows, setOrigRows] = useWandLabUiState('tail.origRows', () =>
    origHexListFromRaw(DEFAULT_TAIL_RAW),
  );
  const [omitDupes, setOmitDupes] = useWandLabUiState('tail.omitDupes', true);
  const [selectedTailIdx, setSelectedTailIdx] = useWandLabUiState('tail.selectedIdx', 0);
  const [sendWaitMs, setSendWaitMs] = useWandLabUiState('tail.sendWaitMs', 1000);
  const [valueMode, setValueMode] = useWandLabUiState('tail.valueMode', 'cells');
  const [bitCells, setBitCells] = useWandLabUiState('tail.bitCells', () => ({}));
  const [bitColumns, setBitColumns] = useWandLabUiState('tail.bitColumns', () => []);
  const [highlightSame, setHighlightSame] = useWandLabUiState('tail.highlightSame', true);
  const [assemblyOpen, setAssemblyOpen] = useWandLabUiState('tail.assemblyOpen', false);
  const [sendingAll, setSendingAll] = useState(false);
  const [vibration, setVibration] = useWandLabUiState('tail.vibration', null);
  const [envelope, setEnvelope] = useWandLabUiState('tail.envelope', 'e1');
  const [copyMsg, setCopyMsg] = useState('');
  const [packetCopyMsg, setPacketCopyMsg] = useState('');
  const [nibbleCopyMsg, setNibbleCopyMsg] = useState('');
  const [nibbleSpecs, setNibbleSpecs] = useWandLabUiState('tail.nibbleSpecs', defaultNibbleSpecs);
  const sendAllGen = useRef(0);

  const palOpts = mbPaletteOptions();
  const isRgb = colorFormat === 'd2';
  const activeColors = colors.slice(0, colorCount);
  const colorsForPacket = useMemo(() => {
    if (!maskFollowsColorCount) return activeColors;
    const mask = Math.max(0, Math.min(7, colorCount));
    return activeColors.map((c) => ({ ...c, mask }));
  }, [activeColors, maskFollowsColorCount, colorCount]);

  const parsedList = useMemo(() => parseTailList(tailRaw), [tailRaw]);
  const displayTails = useMemo(
    () => (omitDupes ? omitConsecutiveDuplicateTails(parsedList.tails) : parsedList.tails),
    [omitDupes, parsedList.tails],
  );

  const seededOrigRef = useRef(false);
  useEffect(() => {
    if (seededOrigRef.current) return;
    seededOrigRef.current = true;
    const hexes = parsedList.tails.map((t) => t.hex);
    const origOk = Array.isArray(origRows) && origRows.length === hexes.length;
    if (!origOk) {
      setOrigRows(hexes);
      setEnteredRaw(tailRaw);
    } else if (!enteredRaw) {
      setEnteredRaw(tailRaw);
    }
  }, [enteredRaw, origRows, parsedList.tails, tailRaw]);

  const origHexForDisplayIndex = (i) => {
    const row = displayTails[i];
    if (!row) return '';
    const srcIdx = parsedList.tails.indexOf(row);
    const idx = srcIdx >= 0 ? srcIdx : i;
    return (Array.isArray(origRows) && origRows[idx]) || row.hex || '';
  };

  const origHexesForDisplay = () => displayTails.map((_, i) => origHexForDisplayIndex(i));

  const rowIsDirty = (i) => {
    const row = displayTails[i];
    if (!row) return false;
    return row.hex !== origHexForDisplayIndex(i);
  };

  const anyTailDirty = useMemo(() => {
    const current = parsedList.tails.map((t) => t.hex);
    const orig = origHexListFromRaw(enteredRaw);
    if (current.length !== orig.length) return current.length > 0 || orig.length > 0;
    return current.some((h, i) => h !== orig[i]);
  }, [parsedList.tails, enteredRaw]);
  const safeIdx = displayTails.length ? Math.min(selectedTailIdx, displayTails.length - 1) : 0;
  const activeTail = displayTails[safeIdx] || null;
  const tailMaxLen = useMemo(
    () => displayTails.reduce((m, t) => Math.max(m, t.bytes?.length || 0), 0),
    [displayTails],
  );
  const constancy = useMemo(
    () => (displayTails.length > 1 ? columnConstancy(displayTails) : []),
    [displayTails],
  );
  const showSameHighlight = highlightSame && displayTails.length > 1;
  const tailBytes = activeTail?.bytes ?? [];
  const specs = normalizeNibbleSpecs(nibbleSpecs);
  const nibbleByteSet = useMemo(() => new Set(specs.map((s) => s.byteIdx)), [specs]);

  const assembled = assembleTailPayload({
    timingByte,
    colorFormat,
    colors: colorsForPacket,
    tailBytes,
    vibration,
    envelope,
  });

  const assembleForTail = (bytes) =>
    assembleTailPayload({
      timingByte,
      colorFormat,
      colors: colorsForPacket,
      tailBytes: bytes,
      vibration,
      envelope,
    });

  const setColorCountSafe = (n) => {
    const count = Math.max(1, Math.min(7, n));
    setColorCount(count);
    setColors((prev) => {
      if (prev.length >= count) return prev;
      return [...prev, ...defaultColors(count - prev.length)];
    });
  };

  const patchColor = (idx, patch) => {
    setColors((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const applyPaletteByte = (idx, byte) => {
    const decoded = decodeMbColorMaskByte(byte);
    patchColor(idx, {
      paletteIdx: decoded.palette,
      ...(maskFollowsColorCount ? {} : { mask: decoded.mask }),
    });
  };

  const setFormat = (fmt) => {
    setColorFormat(fmt);
    const kind = fmt === 'd2' ? 'rgb' : 'palette';
    setColors((prev) => prev.map((c) => ({ ...c, kind })));
  };

  const commitEnteredTails = (text, selectIdx = 0) => {
    setTailRaw(text);
    setEnteredRaw(text);
    setOrigRows(origHexListFromRaw(text));
    if (selectIdx != null) setSelectedTailIdx(selectIdx);
  };

  const applyTailPaste = (text) => {
    commitEnteredTails(text, 0);
  };

  const writeDisplayTails = (next, selectIdx = null) => {
    setTailRaw(tailsToRaw(next));
    if (selectIdx != null) setSelectedTailIdx(selectIdx);
  };

  const patchTailBytes = (idx, bytes) => {
    const next = displayTails.map((t, i) => (i === idx ? entryFromBytes(bytes) : t));
    setOrigRows(origHexesForDisplay());
    writeDisplayTails(next, idx);
  };

  const patchTailByte = (rowIdx, byteIdx, value) => {
    const row = displayTails[rowIdx];
    if (!row) return;
    const nextBytes = row.bytes.map((b, i) => (i === byteIdx ? value & 0xff : b));
    patchTailBytes(rowIdx, nextBytes);
  };

  const patchNibbleDec = (rowIdx, spec, value) => {
    const row = displayTails[rowIdx];
    if (!row) return;
    const byteIdx = Number(spec.byteIdx) || 0;
    if (byteIdx >= row.bytes.length) return;
    patchTailByte(
      rowIdx,
      byteIdx,
      encodeBitGroupValue(row.bytes[byteIdx], spec.bitStart, spec.bitCount, Number(value) || 0),
    );
  };

  const resetRow = (idx) => {
    const row = displayTails[idx];
    if (!row || !rowIsDirty(idx)) return;
    const bytes = parseTailBytes(origHexForDisplayIndex(idx));
    const nextOrig = origHexesForDisplay();
    const next = displayTails.map((t, i) => (i === idx ? entryFromBytes(bytes) : t));
    setOrigRows(nextOrig);
    writeDisplayTails(next, idx);
  };

  const resetAllTails = () => {
    if (!anyTailDirty) return;
    commitEnteredTails(enteredRaw || tailRaw, 0);
  };

  const duplicateRow = (idx) => {
    const row = displayTails[idx];
    if (!row) return;
    const next = [...displayTails];
    next.splice(idx + 1, 0, entryFromBytes([...row.bytes]));
    const nextOrig = origHexesForDisplay();
    nextOrig.splice(idx + 1, 0, origHexForDisplayIndex(idx));
    setOrigRows(nextOrig);
    setOmitDupes(false);
    setBitCells((prev) => shiftRowIndexMap(prev, idx + 1, idx));
    writeDisplayTails(next, idx + 1);
  };

  const duplicateAllRows = () => {
    if (!displayTails.length) return;
    const next = [];
    const nextOrig = [];
    const nextCells = {};
    const srcCells = asIndexMap(bitCells);
    displayTails.forEach((t, i) => {
      const origIdx = next.length;
      next.push(entryFromBytes([...t.bytes]));
      const copyIdx = next.length;
      next.push(entryFromBytes([...t.bytes]));
      const origHex = origHexForDisplayIndex(i);
      nextOrig.push(origHex, origHex);
      if (srcCells[String(i)]) {
        nextCells[String(origIdx)] = srcCells[String(i)];
        nextCells[String(copyIdx)] = srcCells[String(i)];
      }
    });
    setOrigRows(nextOrig);
    setOmitDupes(false);
    setBitCells(nextCells);
    writeDisplayTails(next, Math.min(displayTails.length * 2 - 1, safeIdx * 2 + 1));
  };

  const sendAssembled = async (bytes, label = '') => {
    if (!bytes?.length) return false;
    const ok = await onSendPacket?.(bytes);
    if (ok && label) onStatus?.(label);
    return ok;
  };

  const handleSend = async () => {
    const n = displayTails.length;
    const label = n > 1 ? `Sent tail ${safeIdx + 1}/${n}` : undefined;
    await sendAssembled(assembled.bytes, label);
  };

  const handleSendRow = async (idx) => {
    const tail = displayTails[idx];
    if (!tail) return;
    setSelectedTailIdx(idx);
    const pkt = assembleForTail(tail.bytes);
    await sendAssembled(pkt.bytes, `Sent tail ${idx + 1}/${displayTails.length}`);
  };

  const handleLogRow = (idx) => {
    const tail = displayTails[idx];
    if (!tail) return;
    setSelectedTailIdx(idx);
    const pkt = assembleForTail(tail.bytes);
    if (!pkt.bytes?.length) {
      onStatus?.('Nothing to log — assembled packet is empty');
      return;
    }
    onLogTail?.(pkt, {
      rowIdx: idx,
      rowCount: displayTails.length,
      tailBytes: tail.bytes,
    });
  };

  const handleStepNext = async () => {
    if (!displayTails.length) return;
    const next = safeIdx + 1;
    if (next >= displayTails.length) {
      onStatus?.('End of tail list — click a row to start over');
      return;
    }
    setSelectedTailIdx(next);
    const pkt = assembleForTail(displayTails[next].bytes);
    await sendAssembled(pkt.bytes, `Sent tail ${next + 1}/${displayTails.length}`);
  };

  const handleSendAll = async () => {
    if (!displayTails.length || sendingAll) return;
    const gen = ++sendAllGen.current;
    setSendingAll(true);
    try {
      for (let i = 0; i < displayTails.length; i++) {
        if (sendAllGen.current !== gen) return;
        setSelectedTailIdx(i);
        const pkt = assembleForTail(displayTails[i].bytes);
        await sendAssembled(pkt.bytes);
        if (sendAllGen.current !== gen) return;
        if (i < displayTails.length - 1) await sleep(sendWaitMs);
      }
      if (sendAllGen.current === gen) {
        onStatus?.(`Sent all ${displayTails.length} tails`);
      }
    } finally {
      if (sendAllGen.current === gen) setSendingAll(false);
    }
  };

  const stopSendAll = () => {
    sendAllGen.current += 1;
    setSendingAll(false);
    onStatus?.('Stopped tail send-all');
  };

  const handleCopy = async () => {
    const text = tailBytesToDisplayHex(assembled.bytes);
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg('Copied');
      onStatus?.('Copied assembled hex');
      setTimeout(() => setCopyMsg(''), 1500);
    } catch {
      onStatus?.('Clipboard copy failed');
    }
  };

  const assembledPacketHex = (bytes) => (assembleForTail(bytes || []).hex || '').toUpperCase();

  const copyHexToClipboard = async (text, okStatus, setMsg) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setMsg?.('Copied');
      onStatus?.(okStatus);
      if (setMsg) setTimeout(() => setMsg(''), 1500);
    } catch {
      onStatus?.('Clipboard copy failed');
    }
  };

  const handleCopyPackets = async () => {
    const lines = displayTails.map((t) => assembledPacketHex(t.bytes)).filter(Boolean);
    if (!lines.length) return;
    await copyHexToClipboard(
      lines.join('\n'),
      lines.length === 1 ? 'Copied 1 assembled packet' : `Copied ${lines.length} assembled packets`,
      setPacketCopyMsg,
    );
  };

  const handleCopyRowPacket = async (idx) => {
    const tail = displayTails[idx];
    if (!tail) return;
    const hex = assembledPacketHex(tail.bytes);
    if (!hex) {
      onStatus?.('Nothing to copy — assembled packet is empty');
      return;
    }
    setSelectedTailIdx(idx);
    await copyHexToClipboard(hex, `Copied assembled packet ${idx + 1}/${displayTails.length}`);
  };

  const handleCopyNibbleDecimals = async () => {
    if (!displayTails.length || !specs.length) return;
    const header = specs.map(nibbleSpecLabel).join('\t');
    const rows = displayTails.map((t) =>
      specs
        .map((s) => {
          const v = nibbleDec(t.bytes, s);
          return v == null ? '' : String(v);
        })
        .join('\t'),
    );
    const text = [header, ...rows].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setNibbleCopyMsg('Copied');
      onStatus?.(
        specs.length === 1
          ? `Copied ${nibbleSpecLabel(specs[0])} decimals`
          : `Copied ${specs.length} nibble columns for ${displayTails.length} tails`,
      );
      setTimeout(() => setNibbleCopyMsg(''), 1500);
    } catch {
      onStatus?.('Clipboard copy failed');
    }
  };

  const patchNibbleSpec = (id, patch) => {
    setNibbleSpecs((prev) =>
      normalizeNibbleSpecs(prev).map((s) => {
        if (s.id !== id) return s;
        const next = { ...s, ...patch };
        next.byteIdx = Math.max(0, Number(next.byteIdx) || 0);
        next.bitStart = clampBitStart(next.bitStart);
        next.bitCount = clampBitCount(next.bitStart, next.bitCount);
        return next;
      }),
    );
  };

  const addNibbleSpec = (byteIdx = 0, bitStart = 4, bitCount = 4) => {
    setNibbleSpecs((prev) => {
      const list = normalizeNibbleSpecs(prev);
      if (list.length >= MAX_NIBBLE_SPECS) return list;
      return [
        ...list,
        {
          id: generateId(),
          byteIdx: Math.max(0, Number(byteIdx) || 0),
          bitStart: clampBitStart(bitStart),
          bitCount: clampBitCount(bitStart, bitCount),
        },
      ];
    });
  };

  const addNibbleFromColumn = (byteIdx) => {
    const onByte = specs.filter((s) => s.byteIdx === byteIdx);
    const keys = new Set(onByte.map(nibbleSpecKey));
    if (!keys.has(`${byteIdx}:4:4`)) addNibbleSpec(byteIdx, 4, 4);
    else if (!keys.has(`${byteIdx}:0:4`)) addNibbleSpec(byteIdx, 0, 4);
    else if (!keys.has(`${byteIdx}:0:8`)) addNibbleSpec(byteIdx, 0, 8);
    else addNibbleSpec(byteIdx, 0, 4);
  };

  const removeNibbleSpec = (id) => {
    setNibbleSpecs((prev) => normalizeNibbleSpecs(prev).filter((s) => s.id !== id));
  };

  const omitted = parsedList.tails.length - displayTails.length;
  const isTailList = parsedList.tails.length > 1;
  const listDesc = displayTails.length
    ? `${displayTails.length} tail${displayTails.length === 1 ? '' : 's'}` +
      (parsedList.tails.length !== displayTails.length
        ? ` (${parsedList.tails.length} lines, ${omitted} consecutive dupe${omitted === 1 ? '' : 's'} omitted)`
        : '') +
      (parsedList.skipped ? `, ${parsedList.skipped} skipped` : '') +
      (isTailList
        ? ` — selected #${safeIdx + 1} (${tailBytes.length} bytes)`
        : ` (${tailBytes.length} bytes)`)
    : 'No tails parsed';

  const flipColumn = (index) => {
    const next = toggleBitColumn(bitColumns, bitCells, index);
    setBitColumns(next.bitColumns);
    setBitCells(next.bitCells);
  };

  return (
    <Stack gap="md">
      <Group gap="xs" justify="space-between" wrap="wrap">
        <SegmentedControl
          size="xs"
          value={valueMode}
          onChange={setValueMode}
          data={[
            { value: 'cells', label: 'Cells' },
            { value: 'text', label: 'Text' },
          ]}
        />
        <Text size="xs" c="dimmed">
          {listDesc}
        </Text>
      </Group>
      <Group gap={6} wrap="wrap">
        {TAIL_TEMPLATES.map((t) => (
          <Button
            key={t.id}
            size="compact-xs"
            variant="default"
            onClick={() => applyTailPaste(t.hex)}
          >
            {t.label}
          </Button>
        ))}
        <Checkbox
          size="xs"
          label="Omit consecutive identical tails"
          checked={omitDupes}
          onChange={(e) => {
            setOmitDupes(e.currentTarget.checked);
            setSelectedTailIdx(0);
          }}
        />
        <Checkbox
          size="xs"
          label="Highlight identical columns"
          checked={highlightSame}
          disabled={displayTails.length < 2}
          onChange={(e) => setHighlightSame(e.currentTarget.checked)}
        />
        {displayTails.length > 1 && (
          <Button size="compact-xs" variant="default" onClick={duplicateAllRows}>
            Dup all
          </Button>
        )}
        <Button
          size="compact-xs"
          variant="default"
          disabled={!anyTailDirty}
          title="Restore all tails to last pasted or typed values"
          onClick={resetAllTails}
        >
          Reset all
        </Button>
        {valueMode === 'cells' && (
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
        )}
        <Button
          size="compact-xs"
          variant="light"
          color="cyan"
          disabled={!displayTails.length}
          onClick={() => {
            const packets = displayTails
              .map((t) => {
                const assembled = assembleForTail(t.bytes || []);
                return { bytes: assembled.bytes, hex: assembled.hex };
              })
              .filter((p) => p.bytes.length);
            onSendToAnalyzer?.(packets);
          }}
        >
          Send to Analyze
        </Button>
        <Button
          size="compact-xs"
          variant="default"
          disabled={!displayTails.length}
          title="Copy assembled packets (envelope + timing + colors + tail), one compact hex line each"
          onClick={() => void handleCopyPackets()}
        >
          {packetCopyMsg || 'Copy packets'}
        </Button>
      </Group>
      {displayTails.length > 0 && (
        <Stack gap={4}>
          {specs.map((spec, si) => (
              <Group key={spec.id} gap={6} wrap="wrap" align="flex-end">
                <NumberInput
                  size="xs"
                  label={si === 0 ? 'Byte' : undefined}
                  min={0}
                  max={Math.max(0, tailMaxLen - 1)}
                  clampBehavior="strict"
                  value={spec.byteIdx}
                  onChange={(v) => patchNibbleSpec(spec.id, { byteIdx: Number(v) || 0 })}
                  w={72}
                  styles={{ input: { fontFamily: 'monospace' } }}
                />
                <NumberInput
                  size="xs"
                  label={si === 0 ? 'Start' : undefined}
                  min={0}
                  max={7}
                  clampBehavior="strict"
                  value={spec.bitStart}
                  onChange={(v) => patchNibbleSpec(spec.id, { bitStart: Number(v) || 0 })}
                  w={64}
                  styles={{ input: { fontFamily: 'monospace' } }}
                />
                <NumberInput
                  size="xs"
                  label={si === 0 ? 'Bits' : undefined}
                  min={1}
                  max={8 - spec.bitStart}
                  clampBehavior="strict"
                  value={spec.bitCount}
                  onChange={(v) => patchNibbleSpec(spec.id, { bitCount: Number(v) || 1 })}
                  w={64}
                  styles={{ input: { fontFamily: 'monospace' } }}
                />
                <Text size="xs" c="dimmed" ff="monospace" pb={6}>
                  {bitRangeLabel(spec.bitStart, spec.bitCount)}
                </Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="red"
                  title={`Remove ${nibbleSpecLabel(spec)}`}
                  onClick={() => removeNibbleSpec(spec.id)}
                >
                  ✕
                </Button>
                {specs.length === 1 && displayTails.length <= 12 && (
                  <Text size="xs" c="dimmed" ff="monospace" pb={6}>
                    {displayTails.map((t) => {
                      const v = nibbleDec(t.bytes, spec);
                      return v == null ? '—' : String(v);
                    }).join(' · ')}
                  </Text>
                )}
              </Group>
          ))}
          <Group gap={6} wrap="wrap">
            <Button
              size="compact-xs"
              variant="default"
              disabled={specs.length >= MAX_NIBBLE_SPECS}
              onClick={() => {
                const next = nextNibblePlacement(specs, tailMaxLen);
                addNibbleSpec(next.byteIdx, next.bitStart, next.bitCount);
              }}
            >
              + Field
            </Button>
            <Button
              size="compact-xs"
              variant="default"
              disabled={!displayTails.length || !specs.length}
              title="Copy nibble decimals, one row per tail (tab-separated columns)"
              onClick={() => void handleCopyNibbleDecimals()}
            >
              {nibbleCopyMsg || 'Copy decimals'}
            </Button>
          </Group>
        </Stack>
      )}
      <Text size="xs" c="dimmed">
        {valueMode === 'cells'
          ? 'Click a cell to flip hex ↔ bits. Click a column header to flip the whole column. Alt/⌘-click a header to add a nibble column. Log writes that assembled tail into the observation log.'
          : 'One hex tail per line. Reset all restores the last pasted or typed list.'}
      </Text>
      {valueMode === 'text' && (
        <Textarea
          autosize
          minRows={3}
          ff="monospace"
          value={tailRaw}
          onChange={(e) => commitEnteredTails(e.currentTarget.value, selectedTailIdx)}
          placeholder={DEFAULT_TAIL_RAW}
          styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
        />
      )}
      {valueMode === 'cells' && displayTails.length > 0 && (
        <Stack gap={4}>
          <Text size="xs" fw={600} tt="uppercase" c="dimmed">
            Tail values
          </Text>
          <Table.ScrollContainer minWidth={640}>
            <Table striped highlightOnHover withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={36}>#</Table.Th>
                  {Array.from({ length: tailMaxLen }).map((_, i) => {
                    const c = constancy[i];
                    const isSame = showSameHighlight && !!c?.constant;
                    const isNibbleCol = nibbleByteSet.has(i);
                    return (
                      <Table.Th
                        key={i}
                        w={columnHasBitView(bitColumns, bitCells, i) ? BIT_COL_PX : HEX_COL_PX}
                        p={4}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (e.altKey || e.metaKey) {
                            addNibbleFromColumn(i);
                            return;
                          }
                          flipColumn(i);
                        }}
                        style={{
                          cursor: 'pointer',
                          boxShadow: isNibbleCol ? 'inset 0 -2px 0 var(--mantine-color-cyan-6)' : undefined,
                        }}
                      >
                        <Tooltip
                          label={
                            displayTails.length > 1
                              ? `byte[${i}] · ${c?.distinctCount ?? 0} distinct value(s) across ${c?.coverage ?? 0} row(s) · Alt/⌘-click to add a nibble column`
                              : `Click to flip column ${i}. Alt/⌘-click to add a nibble column`
                          }
                        >
                          <Box>
                            <BitColumnHeader
                              index={i}
                              showBits={columnHasBitView(bitColumns, bitCells, i)}
                              constant={isSame}
                              tagColor={isNibbleCol ? 'cyan' : isSame ? 'teal' : undefined}
                            />
                          </Box>
                        </Tooltip>
                      </Table.Th>
                    );
                  })}
                  <Table.Th w={48}>Len</Table.Th>
                  {specs.map((spec) => (
                    <Table.Th
                      key={spec.id}
                      w={72}
                      title={`byte ${spec.byteIdx} ${bitRangeLabel(spec.bitStart, spec.bitCount)}`}
                    >
                      <Text size="xs" ff="monospace">
                        {nibbleSpecLabel(spec)}
                      </Text>
                    </Table.Th>
                  ))}
                  <Table.Th w={240} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {displayTails.map((t, i) => {
                  const isSelected = i === safeIdx;
                  const dirty = rowIsDirty(i);
                  const rowKey = String(i);
                  return (
                    <Table.Tr
                      key={`tail-${i}`}
                      onClick={() => setSelectedTailIdx(i)}
                      style={{
                        cursor: 'pointer',
                        background: isSelected
                          ? 'color-mix(in srgb, var(--mantine-color-teal-filled) 14%, transparent)'
                          : dirty
                            ? 'color-mix(in srgb, var(--primary) 10%, transparent)'
                            : undefined,
                      }}
                    >
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {i + 1}
                        </Text>
                        {isSelected && (
                          <Badge size="xs" color="teal" variant="light">
                            Sel
                          </Badge>
                        )}
                      </Table.Td>
                      {Array.from({ length: tailMaxLen }).map((_, bi) => {
                        const byte = bi < t.bytes.length ? t.bytes[bi] : null;
                        const showBits =
                          byte != null && cellHasBitView(bitColumns, bitCells, rowKey, bi);
                        return (
                          <Table.Td key={bi} p={4}>
                            <ByteBitCell
                              byteValue={byte ?? 0}
                              empty={byte == null}
                              showBits={showBits}
                              onToggleBits={() =>
                                setBitCells((prev) => toggleBitCellMap(prev, rowKey, bi))
                              }
                              editable
                              onByteChange={
                                byte != null ? (v) => patchTailByte(i, bi, v) : undefined
                              }
                              tagColor={
                                showSameHighlight && !!constancy[bi]?.constant ? 'teal' : undefined
                              }
                            />
                          </Table.Td>
                        );
                      })}
                      <Table.Td>
                        <Text size="xs" ff="monospace">
                          {t.bytes.length}
                        </Text>
                      </Table.Td>
                      {specs.map((spec) => {
                        const dec = nibbleDec(t.bytes, spec);
                        return (
                          <Table.Td key={spec.id} p={4} onClick={(e) => e.stopPropagation()}>
                            {dec == null ? (
                              <Text size="xs" c="dimmed" ff="monospace">—</Text>
                            ) : (
                              <NumberInput
                                size="xs"
                                min={0}
                                max={customBitFieldMax(spec.bitCount)}
                                clampBehavior="strict"
                                allowDecimal={false}
                                value={dec}
                                onChange={(v) => patchNibbleDec(i, spec, v)}
                                w={72}
                                styles={{ input: { fontFamily: 'monospace', textAlign: 'center', paddingInline: 4 } }}
                              />
                            )}
                          </Table.Td>
                        );
                      })}
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          <Button
                            size="compact-xs"
                            variant="default"
                            disabled={!dirty}
                            title="Restore this tail to its last entered values"
                            onClick={(e) => {
                              e.stopPropagation();
                              resetRow(i);
                            }}
                          >
                            Reset
                          </Button>
                          <Button
                            size="compact-xs"
                            variant="default"
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicateRow(i);
                            }}
                          >
                            Dup
                          </Button>
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="teal"
                            disabled={!simIp || sendingAll}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleSendRow(i);
                            }}
                          >
                            Send
                          </Button>
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="cyan"
                            disabled={!onLogTail}
                            title="Log this assembled tail in the observation log"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleLogRow(i);
                            }}
                          >
                            Log
                          </Button>
                          <Button
                            size="compact-xs"
                            variant="default"
                            title="Copy this assembled packet as compact hex"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleCopyRowPacket(i);
                            }}
                          >
                            Copy
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      )}

      <Button
        size="compact-xs"
        variant={assemblyOpen ? 'filled' : 'default'}
        onClick={() => setAssemblyOpen((v) => !v)}
        w="fit-content"
      >
        {assemblyOpen ? 'Hide packet assembly' : 'Timing, colors & envelope'}
      </Button>
      <Collapse expanded={!!assemblyOpen} keepMounted={false}>
        <Stack gap="md">
          <Field label="Timing byte">
            <TimingByteFields byteValue={timingByte} onChange={setTimingByte} />
          </Field>

          <Field label="Color format">
            <SearchableSelect
              value={colorFormat}
              allowEmpty={false}
              onChange={(v) => setFormat(v || '0f')}
              options={TAIL_BUILDER_COLOR_FORMATS.map((o) => ({
                value: o.value,
                label: o.label,
                searchText: o.label,
              }))}
            />
          </Field>

          <Group gap="md" align="flex-end" wrap="wrap">
            <Field label="Color count" style={{ marginBottom: 0 }}>
              <SegmentedControl
                size="xs"
                value={String(colorCount)}
                onChange={(v) => setColorCountSafe(parseInt(v, 10))}
                data={['1', '2', '3', '4', '5', '6', '7']}
              />
            </Field>
            {!isRgb && (
              <Switch
                size="xs"
                label="Mask = color count"
                checked={maskFollowsColorCount}
                onChange={(e) => setMaskFollowsColorCount(e.currentTarget.checked)}
                title="When on, every color slot’s mask is set to the selected color count (1–7)"
              />
            )}
          </Group>

          <Stack gap="sm">
            {activeColors.map((c, idx) => {
              const packetColor = colorsForPacket[idx] || c;
              const swatch = isRgb
                ? `rgb(${Number(c.r ?? 0)}, ${Number(c.g ?? 0)}, ${Number(c.b ?? 0)})`
                : DEFAULT_MB_WLED_COLORS[c.paletteIdx ?? 0] || '#000';
              const paletteByte = encodeTailColorByte(packetColor);
              return (
                <Stack
                  key={idx}
                  gap={6}
                  p={8}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    background: 'var(--surface2)',
                  }}
                >
                  <Group gap="xs" align="center">
                    <Text size="xs" c="dimmed" w={52}>
                      Color {idx + 1}
                    </Text>
                    <ColorSwatchBox background={swatch} />
                  </Group>
                  {isRgb ? (
                    <Stack gap={6}>
                      {['r', 'g', 'b'].map((ch) => (
                        <Group key={ch} gap="xs" align="flex-end" wrap="wrap">
                          <Field
                            label={ch.toUpperCase()}
                            style={{ marginBottom: 0, flex: '0 1 72px' }}
                          >
                            <NumberInput
                              size="xs"
                              min={0}
                              max={255}
                              value={c[ch] ?? 0}
                              onChange={(v) =>
                                patchColor(idx, {
                                  [ch]: Math.max(0, Math.min(255, Number(v) || 0)),
                                })
                              }
                            />
                          </Field>
                          <ByteHexBitsEditor
                            byteValue={c[ch] ?? 0}
                            onChange={(byte) => patchColor(idx, { [ch]: byte })}
                          />
                        </Group>
                      ))}
                    </Stack>
                  ) : (
                    <Group gap="xs" align="flex-end" wrap="wrap">
                      <ByteHexBitsEditor
                        byteValue={paletteByte}
                        onChange={(byte) => applyPaletteByte(idx, byte)}
                      />
                      <Field label="Palette" style={{ marginBottom: 0, flex: '1 1 180px' }}>
                        <SearchableSelect
                          value={String(c.paletteIdx ?? 0)}
                          allowEmpty={false}
                          onChange={(v) => patchColor(idx, { paletteIdx: parseInt(v, 10) || 0 })}
                          options={palOpts}
                        />
                      </Field>
                      <Field label="Mask (0–7)" style={{ marginBottom: 0, flex: '0 1 88px' }}>
                        <NumberInput
                          size="xs"
                          min={0}
                          max={7}
                          disabled={maskFollowsColorCount}
                          value={packetColor.mask ?? 0}
                          onChange={(v) =>
                            patchColor(idx, { mask: Math.max(0, Math.min(7, Number(v) || 0)) })
                          }
                        />
                      </Field>
                    </Group>
                  )}
                </Stack>
              );
            })}
          </Stack>

          <Field label="Vibration">
            <SearchableSelect
              value={vibration == null ? 'none' : String(vibration)}
              allowEmpty={false}
              onChange={(v) => setVibration(parseVibrationValue(v))}
              options={VIBRATION_OPTIONS}
              placeholder="None (omit byte)"
            />
          </Field>

          <Field label="Envelope">
            <SegmentedControl
              size="xs"
              value={envelope}
              onChange={setEnvelope}
              data={[
                { value: 'e1', label: 'E1' },
                { value: 'e2', label: 'E2' },
              ]}
            />
          </Field>

          <Stack gap={4}>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed">
              Assembled payload
            </Text>
            <Text size="sm" ff="monospace" style={{ wordBreak: 'break-all' }}>
              {tailBytesToDisplayHex(assembled.bytes) || '(empty)'}
            </Text>
            <Text size="xs" ff="monospace" c="dimmed">
              Derived sub-opcode: 0x{assembled.subOpcodeHex} (packet length:{' '}
              {assembled.bytes.length} bytes)
            </Text>
            {assembled.warnings.map((w) => (
              <Text key={w} size="xs" c="yellow.6">
                {w}
              </Text>
            ))}
          </Stack>

          <Group gap="xs" wrap="wrap" align="flex-end">
            <Button
              onClick={handleSend}
              disabled={!simIp || assembled.bytes.length === 0 || sendingAll}
            >
              Send{displayTails.length > 1 ? ` #${safeIdx + 1}` : ''}
            </Button>
            {displayTails.length > 1 && (
              <>
                <Button
                  variant="default"
                  onClick={handleStepNext}
                  disabled={!simIp || sendingAll || safeIdx + 1 >= displayTails.length}
                >
                  Step next
                </Button>
                {sendingAll ? (
                  <Button color="red" variant="light" onClick={stopSendAll}>
                    Stop send-all
                  </Button>
                ) : (
                  <Button variant="default" onClick={handleSendAll} disabled={!simIp}>
                    Send all
                  </Button>
                )}
                <NumberInput
                  label="Wait (ms)"
                  size="xs"
                  w={110}
                  min={50}
                  max={60000}
                  step={50}
                  value={sendWaitMs}
                  onChange={(v) => setSendWaitMs(Math.max(50, Number(v) || 1000))}
                  disabled={sendingAll}
                />
              </>
            )}
            <Button
              variant="default"
              onClick={() => onLoadToByteEditor?.(assembled.bytes)}
              disabled={assembled.bytes.length === 0}
            >
              Load into byte editor
            </Button>
            <Button variant="default" onClick={handleCopy} disabled={assembled.bytes.length === 0}>
              {copyMsg || 'Copy hex'}
            </Button>
          </Group>
        </Stack>
      </Collapse>
    </Stack>
  );
}
