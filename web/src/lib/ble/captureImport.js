import {
  buildShowBodyFromCaptureRows,
  hasCompanyIdPrefix,
  parseHexToBytes,
  stripCompanyId,
} from './wandSimClient';

const CAPTURE_HEX_FIELD = 6;

/** Parse pasted text — single hex, tab-separated capture row, or multi-line capture. */
export function parseCapturePaste(raw) {
  const text = (raw || '').trim();
  if (!text) return { mode: 'empty' };

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 || lines[0].includes('\t')) {
    const rows = lines.map(parseCaptureLine).filter((r) => r.hex);
    if (rows.length) return { mode: 'capture', rows };
  }

  if (lines[0].includes('\t')) {
    const row = parseCaptureLine(lines[0]);
    if (row.hex) return { mode: 'capture', rows: [row] };
  }

  return { mode: 'hex', hex: lines[0] };
}

function parseCaptureLine(line) {
  if (line.includes('\t')) {
    const fields = line.split('\t');
    const hexField = fields[CAPTURE_HEX_FIELD] || fields[fields.length - 1] || '';
    const ts = fields[0] && /^\d+$/.test(fields[0]) ? Number(fields[0]) : null;
    const hex = hexField.replace(/[^0-9a-fA-F]/g, '');
    return { ts_ms: ts, hex };
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
