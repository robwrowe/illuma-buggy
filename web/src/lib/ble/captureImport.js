import {
  buildShowBodyFromCaptureRows,
  hasCompanyIdPrefix,
  parseHexToBytes,
  stripCompanyId,
} from './wandSimClient';

const CAPTURE_HEX_FIELD = 6;
const SHOW_LINE_RE = /^(\d+)\s+([0-9a-fA-F]+)$/i;

function contentLines(raw) {
  return (raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
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

  if (lines.some((l) => l.includes('\t'))) {
    const rows = lines
      .map(parseCaptureLine)
      .filter((r) => r.hex.length >= 4);
    const packets = captureRowsToPackets(rows, { defaultWaitMs, lastHoldMs, strip8301 });
    return {
      ok: packets.length > 0,
      packets,
      message: packets.length
        ? `Parsed ${packets.length} packet${packets.length === 1 ? '' : 's'} from capture`
        : 'No valid hex in capture rows',
    };
  }

  if (lines.length > 1) {
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

  if (lines.length > 1 || lines[0].includes('\t')) {
    const rows = lines.map(parseCaptureLine).filter((r) => r.hex);
    if (rows.length) return { mode: 'capture', rows };
  }

  if (lines[0].includes('\t')) {
    const row = parseCaptureLine(lines[0]);
    if (row.hex) return { mode: 'capture', rows: [row] };
  }

  return { mode: 'hex', hex: lines[0].replace(/[^0-9a-fA-F]/g, '') };
}

function parseCaptureLine(line) {
  if (line.includes('\t')) {
    const fields = line.split('\t');
    const hexField = fields[CAPTURE_HEX_FIELD] || fields[fields.length - 1] || '';
    const ts = fields[0] && /^\d+$/.test(fields[0]) ? Number(fields[0]) : null;
    const hex = hexField.replace(/[^0-9a-fA-F]/g, '');
    const tag = fields[2] || '';
    return { ts_ms: ts, hex, tag };
  }
  const hex = line.replace(/[^0-9a-fA-F]/g, '');
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
