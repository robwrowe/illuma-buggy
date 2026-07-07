import {
  buildShowBodyFromCaptureRows,
  hasCompanyIdPrefix,
  parseHexToBytes,
  stripCompanyId,
} from './wandSimClient';

const SHOW_LINE_RE = /^(\d+)\s+([0-9a-fA-F]+)$/i;
const CAPTURE_HEX_TAIL_RE = /(8301[0-9a-fA-F]{8,})\s*$/i;
const CAPTURE_HEAD_RE = /^(\d{10,})\s+(-?\d+)\s+(\S+)/;
const MAC_RE = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/i;

/** Column indices for tab-delimited Illuma capture exports. */
const CAPTURE_LAYOUTS = {
  legacy: { hex: 6, tag: 2, deviceId: null },
  new: { hex: 7, tag: 3, deviceId: 2 },
};

function hexAtField(fields, idx) {
  const h = (fields[idx] || '').replace(/[^0-9a-fA-F]/g, '');
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
  return (fields[layout.hex] || '').replace(/[^0-9a-fA-F]/g, '');
}

function isCaptureLine(line) {
  const t = (line || '').trim();
  if (!t || t.startsWith('#')) return false;
  if (t.includes('\t')) return true;
  return CAPTURE_HEAD_RE.test(t) && CAPTURE_HEX_TAIL_RE.test(t);
}

function contentLines(raw) {
  return (raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/** Read `# ts_ms …` header comment from a capture export. */
export function detectCaptureFormatFromHeader(raw) {
  for (const line of (raw || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('#')) continue;
    const hdr = t.replace(/^#\s*/, '').toLowerCase();
    if (!hdr.includes('ts_ms')) continue;
    if (hdr.includes('device_id')) return 'new';
    return 'legacy';
  }
  return null;
}

/** Infer layout from a single tab-separated data row. */
export function detectCaptureFormatFromFields(fields) {
  if (!fields?.length) return 'legacy';
  const at6 = hexAtField(fields, CAPTURE_LAYOUTS.legacy.hex);
  const at7 = hexAtField(fields, CAPTURE_LAYOUTS.new.hex);
  if (at7 && !at6) return 'new';
  if (at6 && !at7) return 'legacy';
  if (at7 && at6) {
    if (MAC_RE.test((fields[2] || '').trim())) return 'new';
    return 'legacy';
  }
  if (MAC_RE.test((fields[2] || '').trim()) && fields.length >= 9) return 'new';
  return 'legacy';
}

function captureFormatForRaw(raw) {
  const fromHeader = detectCaptureFormatFromHeader(raw);
  if (fromHeader) return fromHeader;
  const first = contentLines(raw).find((l) => l.includes('\t'));
  if (first) return detectCaptureFormatFromFields(first.split('\t'));
  return 'legacy';
}

function dedupeCaptureRows(rows) {
  const deduped = [];
  for (const row of rows) {
    if (deduped.length && deduped[deduped.length - 1].hex === row.hex) continue;
    deduped.push(row);
  }
  return deduped;
}

function hexToPayloadBytes(hex, strip8301) {
  let h = (hex || '').replace(/[^0-9a-fA-F]/g, '');
  if (!h) return [];
  if (strip8301 && hasCompanyIdPrefix(h)) h = stripCompanyId(h);
  return parseHexToBytes(h);
}

function captureRowsToPackets(rows, { defaultWaitMs, lastHoldMs, strip8301 }) {
  const deduped = dedupeCaptureRows(rows);
  return deduped.map((row, i) => {
    let waitMs = defaultWaitMs;
    if (i < deduped.length - 1) {
      const a = row.ts_ms;
      const b = deduped[i + 1].ts_ms;
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

  if (lines.some(isCaptureLine)) {
    const format = captureFormatForRaw(raw);
    const rows = lines
      .filter(isCaptureLine)
      .map((line) => parseCaptureLine(line, format))
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

  if (lines.length > 1 || lines[0].includes('\t') || isCaptureLine(lines[0])) {
    const format = captureFormatForRaw(raw);
    const rows = lines
      .filter(isCaptureLine)
      .map((line) => parseCaptureLine(line, format))
      .filter((r) => r.hex.length >= 12);
    if (rows.length) return { mode: 'capture', rows, format };
  }

  if (lines[0].includes('\t') || isCaptureLine(lines[0])) {
    const format = captureFormatForRaw(raw);
    const row = parseCaptureLine(lines[0], format);
    if (row.hex.length >= 12) return { mode: 'capture', rows: [row], format };
  }

  return { mode: 'hex', hex: lines[0].replace(/[^0-9a-fA-F]/g, '') };
}

function parseCaptureLine(line, format = 'legacy') {
  const trimmed = (line || '').trim();
  if (!trimmed) return { ts_ms: null, hex: '', tag: '' };

  if (trimmed.includes('\t')) {
    const fields = trimmed.split('\t');
    const fmt = format || detectCaptureFormatFromFields(fields);
    const layout = CAPTURE_LAYOUTS[fmt] || CAPTURE_LAYOUTS.legacy;
    const hex = extractCaptureHexFromFields(fields, fmt);
    const ts = fields[0] && /^\d+$/.test(fields[0]) ? Number(fields[0]) : null;
    const tag = fields[layout.tag] || '';
    const deviceId = layout.deviceId != null ? (fields[layout.deviceId] || '').trim() : undefined;
    return { ts_ms: ts, hex, tag, deviceId: deviceId || undefined };
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

  const hex = trimmed.replace(/[^0-9a-fA-F]/g, '');
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
