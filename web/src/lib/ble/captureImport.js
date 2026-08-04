import {
  buildShowBodyFromCaptureRows,
  bytesToHex,
  hasCompanyIdPrefix,
  parseHexToBytes,
  stripCompanyId,
} from './wandSimClient';

const SHOW_LINE_RE = /^(\d+)\s+([0-9a-fA-F]+)$/i;
const CAPTURE_HEX_TAIL_RE = /(8301[0-9a-fA-F]{8,})\s*$/i;
const CAPTURE_HEAD_RE = /^(\d{10,})\s+(-?\d+)\s+(\S+)/;
const MAC_RE = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/i;

/** Default Sheets / observation export header (tab- or comma-separated). */
export const SHEETS_CAPTURE_HEADER =
  'observation_id\tsession_id\tsession_name\thex\topcode\ttag\tboard_ts\tboard_ts_date\tboard_ts_time\treceived_at\treceived_at_date\treceived_at_time\trssi\tlen\tquality\tfunc\tlabel\tnote\tdevice_id\tlat\tlng\taccuracy_m\tgps_updated_at';

/** Column indices for legacy tab-delimited Illuma capture exports. */
const CAPTURE_LAYOUTS = {
  legacy: { hex: 6, tag: 2, deviceId: null, lat: null, lng: null, accuracyM: null },
  device: { hex: 7, tag: 3, deviceId: 2, lat: null, lng: null, accuracyM: null },
  gps: { hex: 10, tag: 6, deviceId: 2, lat: 3, lng: 4, accuracyM: 5 },
  // Compact paste: hex, [opcode], tag, board_ts  — or hex, tag, board_ts
  compact: { hex: 0, tag: -1, deviceId: null, lat: null, lng: null, accuracyM: null },
};

function looksLikeEpochMs(s) {
  const t = String(s || '').trim();
  // Epoch ms (~13 digits) or high-res board clocks; exclude short counters.
  return /^\d{12,}$/.test(t);
}

function looksLikeHexPayload(s) {
  const h = cleanHex(s);
  return h.length >= 12 && h.toLowerCase().startsWith('8301');
}

/**
 * Compact / sheets-subset row: hex in first column (or soon after), epoch ms in last column.
 * Examples:
 *   hex\topcode\ttag\tboard_ts
 *   hex\ttag\tboard_ts
 */
function isCompactCaptureFields(fields) {
  if (!fields || fields.length < 2) return false;
  if (!looksLikeHexPayload(fields[0])) return false;
  return looksLikeEpochMs(fields[fields.length - 1]);
}

function parseCompactCaptureLine(line) {
  const fields = splitDelimited(line);
  const hex = cleanHex(fields[0] || '');
  const ts = parseTimestampMs(fields[fields.length - 1]);
  // tag is usually the last non-empty text field before the timestamp.
  let tag = '';
  for (let i = fields.length - 2; i >= 1; i--) {
    const v = (fields[i] || '').trim();
    if (!v) continue;
    // Skip opcode-looking tokens (E90E, CC03) if a later text tag exists; prefer MB+/DISNEY.
    if (/^[0-9a-fA-F]{4}$/.test(v) && i === 1 && fields.length >= 4) continue;
    tag = v;
    break;
  }
  if (!tag && fields.length >= 3) tag = (fields[fields.length - 2] || '').trim();
  return { ts_ms: ts, hex, tag };
}

function splitDelimited(line) {
  if ((line || '').includes('\t')) return line.split('\t');
  if ((line || '').includes(',')) return line.split(',');
  return [line];
}

function normalizeHeaderCell(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, '');
}

/** True when the first content line is the observation/sheets column header. */
export function isSheetsCaptureHeader(line) {
  const cells = splitDelimited(line).map(normalizeHeaderCell);
  if (!cells.includes('hex')) return false;
  // Prefer the full observation export; also accept close variants with session_id.
  return cells.includes('observation_id') || cells.includes('session_id');
}

function sheetsColumnMap(headerLine) {
  const cells = splitDelimited(headerLine).map(normalizeHeaderCell);
  const idx = (name) => {
    const i = cells.indexOf(name);
    return i >= 0 ? i : null;
  };
  return {
    hex: idx('hex'),
    tag: idx('tag'),
    label: idx('label'),
    boardTs: idx('board_ts'),
    boardTsDate: idx('board_ts_date'),
    boardTsTime: idx('board_ts_time'),
    receivedAt: idx('received_at'),
    receivedAtDate: idx('received_at_date'),
    receivedAtTime: idx('received_at_time'),
    deviceId: idx('device_id'),
    lat: idx('lat'),
    lng: idx('lng'),
    accuracyM: idx('accuracy_m'),
    opcode: idx('opcode'),
    note: idx('note'),
  };
}

function fieldAt(fields, idx) {
  if (idx == null || idx < 0 || idx >= fields.length) return '';
  return (fields[idx] || '').trim();
}

function parseTimestampMs(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  // Pure integers are epoch/board ms (boot millis can be short; epoch is 13 digits).
  if (/^\d+$/.test(s)) return Number(s);
  // ISO / date strings only — never Date.parse bare numbers (year 1000, etc.).
  if (/[T\-\/:]/.test(s)) {
    const parsed = Date.parse(s);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Combine YYYY-MM-DD + HH:MM:SS sheet columns into epoch ms. */
function parseSplitDateTimeMs(dateStr, timeStr) {
  const d = String(dateStr || '').trim();
  const t = String(timeStr || '').trim();
  if (!d) return null;
  return parseTimestampMs(t ? `${d}T${t}` : d);
}

function cleanHex(raw) {
  return String(raw || '').replace(/[^0-9a-fA-F]/g, '');
}

function hexAtField(fields, idx) {
  const h = cleanHex(fields[idx] || '');
  return h.length >= 12 && h.toLowerCase().startsWith('8301') ? h : '';
}

function extractCaptureHexFromFields(fields, format) {
  const layout = CAPTURE_LAYOUTS[format] || CAPTURE_LAYOUTS.legacy;
  const fromCol = hexAtField(fields, layout.hex);
  if (fromCol) return fromCol;
  for (let i = fields.length - 1; i >= 0; i--) {
    const h = hexAtField(fields, i);
    if (h) return h;
  }
  return cleanHex(fields[layout.hex] || '');
}

function isCaptureLine(line) {
  const t = (line || '').trim();
  if (!t || t.startsWith('#')) return false;
  if (isSheetsCaptureHeader(t)) return false;
  if (t.includes('\t') || (t.includes(',') && /[0-9a-fA-F]{12,}/i.test(t))) return true;
  // One Disney packet hex per line (no tabs/spaces) — common paste from spreadsheets / exports.
  if (isPlainHexPacketLine(t)) return true;
  return CAPTURE_HEAD_RE.test(t) && CAPTURE_HEX_TAIL_RE.test(t);
}

/** True when the whole line is a single hex payload (optional 8301 prefix). */
function isPlainHexPacketLine(line) {
  const t = String(line || '').trim();
  if (!t || /[\s,]/.test(t)) return false;
  const h = cleanHex(t);
  return h.length >= 12 && h.length === t.length;
}

function contentLines(raw) {
  return (raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function isCoordLat(s) {
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= -90 && n <= 90;
}

function isCoordLng(s) {
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

function parseOptionalFloat(s) {
  if (s == null || s === '') return undefined;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Detect capture layout from a `# ts_ms …` comment header or a sheets column header.
 * Returns 'sheets' | 'gps' | 'device' | 'legacy' | null.
 */
export function detectCaptureFormatFromHeader(raw) {
  const lines = (raw || '').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (isSheetsCaptureHeader(t)) return 'sheets';
    if (!t.startsWith('#')) continue;
    const hdr = t.replace(/^#\s*/, '').toLowerCase();
    if (!hdr.includes('ts_ms')) continue;
    if (hdr.includes('device_id') && (hdr.includes('\tlat') || hdr.includes(' lat') || hdr.includes('lng'))) {
      return 'gps';
    }
    if (hdr.includes('device_id')) return 'device';
    return 'legacy';
  }
  return null;
}

/** Infer layout from a single tab-separated data row (legacy fixed-column formats). */
export function detectCaptureFormatFromFields(fields) {
  if (!fields?.length) return 'legacy';

  // hex … board_ts (no header) — common Sheets column subset paste
  if (isCompactCaptureFields(fields)) return 'compact';

  if (hexAtField(fields, CAPTURE_LAYOUTS.gps.hex)) return 'gps';

  const at6 = hexAtField(fields, CAPTURE_LAYOUTS.legacy.hex);
  const at7 = hexAtField(fields, CAPTURE_LAYOUTS.device.hex);
  if (at7 && !at6) return 'device';
  if (at6 && !at7) return 'legacy';
  if (at7 && at6) {
    if (MAC_RE.test((fields[2] || '').trim())) return 'device';
    return 'legacy';
  }
  if (MAC_RE.test((fields[2] || '').trim()) && fields.length >= 9) {
    if (isCoordLat(fields[3]) && isCoordLng(fields[4])) return 'gps';
    return 'device';
  }
  return 'legacy';
}

function captureFormatForRaw(raw) {
  const fromHeader = detectCaptureFormatFromHeader(raw);
  if (fromHeader) return fromHeader;
  const first = contentLines(raw).find((l) => l.includes('\t') || l.includes(','));
  if (first) {
    if (isSheetsCaptureHeader(first)) return 'sheets';
    // Prefer sheets-like rows that have a hex-looking cell even without a header
    // when pasted without the header line (rare) — fall through to field detect.
    return detectCaptureFormatFromFields(splitDelimited(first));
  }
  return 'legacy';
}

function findSheetsHeaderLine(raw) {
  for (const line of (raw || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    if (isSheetsCaptureHeader(t)) return t;
  }
  return null;
}

function parseSheetsCaptureLine(line, colMap) {
  const fields = splitDelimited(line);
  let hex = cleanHex(fieldAt(fields, colMap.hex));
  if (hex.length < 12) {
    // Fallback: scan for an 8301… cell if the hex column was empty/misaligned.
    for (let i = 0; i < fields.length; i++) {
      const h = hexAtField(fields, i);
      if (h) { hex = h; break; }
    }
  }
  const tag = fieldAt(fields, colMap.tag) || fieldAt(fields, colMap.label) || '';
  const ts =
    parseTimestampMs(fieldAt(fields, colMap.boardTs)) ??
    parseSplitDateTimeMs(fieldAt(fields, colMap.boardTsDate), fieldAt(fields, colMap.boardTsTime)) ??
    parseTimestampMs(fieldAt(fields, colMap.receivedAt)) ??
    parseSplitDateTimeMs(fieldAt(fields, colMap.receivedAtDate), fieldAt(fields, colMap.receivedAtTime));
  const deviceId = fieldAt(fields, colMap.deviceId) || undefined;
  const lat = parseOptionalFloat(fieldAt(fields, colMap.lat));
  const lng = parseOptionalFloat(fieldAt(fields, colMap.lng));
  const accuracyM = parseOptionalFloat(fieldAt(fields, colMap.accuracyM));
  const note = fieldAt(fields, colMap.note) || undefined;
  const opcode = fieldAt(fields, colMap.opcode) || undefined;
  return {
    ts_ms: ts,
    hex,
    tag,
    deviceId: deviceId || undefined,
    lat,
    lng,
    accuracyM,
    note,
    opcode,
  };
}

function hexToPayloadBytes(hex, strip8301) {
  let h = cleanHex(hex);
  if (!h) return [];
  if (strip8301 && hasCompanyIdPrefix(h)) h = stripCompanyId(h);
  return parseHexToBytes(h);
}

function captureRowsToPackets(rows, { defaultWaitMs, lastHoldMs, strip8301 }) {
  // Keep every row — consecutive identical hex often has meaningful inter-arrival timing.
  // Callers that want consecutive-dedupe can use omitConsecutiveDuplicatePackets().
  return rows.map((row, i) => {
    let waitMs = defaultWaitMs;
    if (i < rows.length - 1) {
      const a = row.ts_ms;
      const b = rows[i + 1].ts_ms;
      if (a != null && b != null && b > a) waitMs = Math.max(50, b - a);
    } else {
      waitMs = lastHoldMs;
    }
    return {
      bytes: hexToPayloadBytes(row.hex, strip8301),
      waitMs,
      label: row.tag || '',
    };
  }).filter((p) => p.bytes.length);
}

/**
 * Collapse runs of identical payloads into one row, summing waitMs so total hold
 * until the next distinct packet stays roughly the same.
 * Non-consecutive repeats are kept (A B A stays three rows).
 */
export function omitConsecutiveDuplicatePackets(packets) {
  const out = [];
  for (const p of packets || []) {
    if (!p?.bytes?.length) continue;
    const hex = bytesToHex(p.bytes).toLowerCase();
    const prev = out[out.length - 1];
    if (prev && bytesToHex(prev.bytes).toLowerCase() === hex) {
      prev.waitMs = (Number(prev.waitMs) || 0) + (Number(p.waitMs) || 0);
      continue;
    }
    out.push({
      bytes: [...p.bytes],
      waitMs: Number(p.waitMs) || 0,
      label: p.label || '',
    });
  }
  return out;
}

/**
 * Parse pasted capture / hex / timed show text into packet rows with waitMs before next send.
 * @returns {{ ok: boolean, message: string, packets: { bytes: number[], waitMs: number, label?: string }[] }}
 */
export function parsePasteToPackets(raw, options = {}) {
  const {
    strip8301 = true,
    defaultWaitMs = 1000,
    lastHoldMs = 3000,
  } = options;

  const lines = contentLines(raw);
  if (!lines.length) {
    return { ok: false, message: 'Paste hex, capture rows, or timed show lines', packets: [] };
  }

  const showLines = lines.map((l) => l.replace(/\s+/g, ' ').trim());
  if (showLines.every((l) => SHOW_LINE_RE.test(l))) {
    const packets = showLines.map((line) => {
      const m = line.match(SHOW_LINE_RE);
      return {
        bytes: hexToPayloadBytes(m[2], strip8301),
        waitMs: Math.max(50, parseInt(m[1], 10) || defaultWaitMs),
      };
    }).filter((p) => p.bytes.length);
    return {
      ok: packets.length > 0,
      packets,
      message: packets.length
        ? `Parsed ${packets.length} timed show step${packets.length === 1 ? '' : 's'}`
        : 'No bytes in show lines',
    };
  }

  if (lines.some(isCaptureLine) || lines.some(isSheetsCaptureHeader)) {
    const format = captureFormatForRaw(raw);
    const rows = lines
      .filter(isCaptureLine)
      .map((line) => parseCaptureLine(line, format, raw))
      .filter((r) => r.hex.length >= 12);
    const packets = captureRowsToPackets(rows, { defaultWaitMs, lastHoldMs, strip8301 });
    return {
      ok: packets.length > 0,
      packets,
      message: packets.length
        ? `Parsed ${packets.length} packet${packets.length === 1 ? '' : 's'} from capture`
        : 'No valid hex in capture rows',
    };
  }

  if (lines.length > 1 && !lines.some(isCaptureLine)) {
    const packets = lines.map((line, i) => ({
      bytes: hexToPayloadBytes(line, strip8301),
      waitMs: i < lines.length - 1 ? defaultWaitMs : lastHoldMs,
    })).filter((p) => p.bytes.length);
    return {
      ok: packets.length > 0,
      packets,
      message: packets.length
        ? `Parsed ${packets.length} hex line${packets.length === 1 ? '' : 's'}`
        : 'No bytes parsed',
    };
  }

  const bytes = hexToPayloadBytes(lines[0], strip8301);
  if (!bytes.length) {
    return { ok: false, message: 'No bytes parsed', packets: [] };
  }
  return {
    ok: true,
    packets: [{ bytes, waitMs: lastHoldMs }],
    message: `Parsed 1 packet (${bytes.length} bytes)`,
  };
}

/** Parse pasted text — single hex, tab-separated capture row, or multi-line capture. */
export function parseCapturePaste(raw) {
  const lines = contentLines(raw);
  if (!lines.length) return { mode: 'empty' };

  if (lines.length > 1 || lines[0].includes('\t') || lines[0].includes(',') || isCaptureLine(lines[0])) {
    const format = captureFormatForRaw(raw);
    const rows = lines
      .filter(isCaptureLine)
      .map((line) => parseCaptureLine(line, format, raw))
      .filter((r) => r.hex.length >= 12);
    if (rows.length) return { mode: 'capture', rows, format };
  }

  // Multi-line plain hex list (one packet per line) — do not collapse to lines[0].
  if (lines.length > 1) {
    const rows = lines
      .map((line) => {
        const hex = cleanHex(line);
        return hex.length >= 12 ? { ts_ms: null, hex, tag: '' } : null;
      })
      .filter(Boolean);
    if (rows.length) return { mode: 'capture', rows, format: 'hex-list' };
  }

  if (lines[0].includes('\t') || lines[0].includes(',') || isCaptureLine(lines[0])) {
    const format = captureFormatForRaw(raw);
    const row = parseCaptureLine(lines[0], format, raw);
    if (row.hex.length >= 12) return { mode: 'capture', rows: [row], format };
  }

  return { mode: 'hex', hex: cleanHex(lines[0]) };
}

function parseCaptureLine(line, format = 'legacy', rawForHeader = '') {
  const trimmed = (line || '').trim();
  if (!trimmed) return { ts_ms: null, hex: '', tag: '' };
  if (isSheetsCaptureHeader(trimmed)) return { ts_ms: null, hex: '', tag: '' };

  const fmt = format || 'legacy';

  // Named-column Sheets / observation export (default when header is present).
  if (fmt === 'sheets') {
    const headerLine = findSheetsHeaderLine(rawForHeader) || SHEETS_CAPTURE_HEADER;
    return parseSheetsCaptureLine(trimmed, sheetsColumnMap(headerLine));
  }

  // hex / opcode / tag / board_ts (headerless subset paste)
  if (fmt === 'compact' || (trimmed.includes('\t') && isCompactCaptureFields(splitDelimited(trimmed)))) {
    return parseCompactCaptureLine(trimmed);
  }

  if (trimmed.includes('\t')) {
    const fields = trimmed.split('\t');
    const detected = (fmt === 'legacy' || fmt === 'device' || fmt === 'gps')
      ? fmt
      : detectCaptureFormatFromFields(fields);
    if (detected === 'compact') return parseCompactCaptureLine(trimmed);
    const layout = CAPTURE_LAYOUTS[detected] || CAPTURE_LAYOUTS.legacy;
    const hex = extractCaptureHexFromFields(fields, detected);
    const ts = fields[0] && /^\d+$/.test(fields[0]) ? Number(fields[0]) : null;
    const tag = fields[layout.tag] || '';
    const deviceId = layout.deviceId != null ? (fields[layout.deviceId] || '').trim() : undefined;
    const lat = layout.lat != null ? parseOptionalFloat(fields[layout.lat]) : undefined;
    const lng = layout.lng != null ? parseOptionalFloat(fields[layout.lng]) : undefined;
    const accuracyM = layout.accuracyM != null ? parseOptionalFloat(fields[layout.accuracyM]) : undefined;
    return {
      ts_ms: ts,
      hex,
      tag,
      deviceId: deviceId || undefined,
      lat,
      lng,
      accuracyM,
    };
  }

  const hexTail = trimmed.match(CAPTURE_HEX_TAIL_RE);
  if (hexTail) {
    const hex = hexTail[1];
    const head = trimmed.slice(0, hexTail.index).trim();
    const headMatch = head.match(CAPTURE_HEAD_RE);
    const parts = head.split(/\s+/);
    return {
      ts_ms: headMatch ? Number(headMatch[1]) : null,
      hex,
      tag: headMatch ? headMatch[3] : (parts[2] || ''),
    };
  }

  const hex = cleanHex(trimmed);
  return { ts_ms: null, hex };
}

/**
 * @param {'editor'|'show'} destination — editor = payload-only (/send); show = full bytes
 */
export function importHexForDestination(raw, destination, strip8301 = null) {
  const parsed = parseCapturePaste(raw);
  if (parsed.mode === 'empty') return { ok: false, message: 'Paste valid hex or capture rows' };

  if (parsed.mode === 'capture' && destination === 'show') {
    const body = buildShowBodyFromCaptureRows(parsed.rows);
    if (!body) return { ok: false, message: 'No valid hex in capture rows' };
    const firstHex = parsed.rows[0].hex;
    return {
      ok: true,
      kind: 'show',
      showBody: body,
      stepCount: body.split('\n').length,
      message: `Queued ${body.split('\n').length} show steps (8301 kept for /show)`,
      previewHex: firstHex,
    };
  }

  let hex = parsed.mode === 'capture' ? parsed.rows[0].hex : parsed.hex;
  const shouldStrip = strip8301 ?? (destination === 'editor');
  if (shouldStrip && hasCompanyIdPrefix(hex)) {
    hex = stripCompanyId(hex);
  }
  const bytes = parseHexToBytes(hex);
  if (!bytes.length) return { ok: false, message: 'No bytes parsed' };

  const stripped = shouldStrip && hasCompanyIdPrefix(parsed.mode === 'capture' ? parsed.rows[0].hex : parsed.hex);
  const message = destination === 'editor'
    ? `Loaded ${bytes.length} bytes${stripped ? ' (stripped 8301 for /send)' : ''}`
    : `Loaded ${bytes.length} bytes (8301 kept for /show)`;

  return { ok: true, kind: 'bytes', bytes, message };
}
