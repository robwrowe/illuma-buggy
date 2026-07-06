/** WandSimulator HTTP client — single place for company-ID byte rules. */

const COMPANY_ID = '8301';
const SEND_TIMEOUT_MS = 8000;
const DEFAULT_LAST_HOLD_MS = 3000;

function baseUrl(ip) {
  const host = (ip || '').trim();
  if (!host) throw new Error('Set simulator IP first');
  return `http://${host}`;
}

export function bytesToHex(arr) {
  return (arr || []).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseHexToBytes(raw) {
  const clean = (raw || '').replace(/[^0-9a-fA-F]/g, '');
  if (clean.length < 2) return [];
  const arr = [];
  for (let i = 0; i + 1 < clean.length; i += 2) {
    arr.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return arr;
}

/** Payload-only hex for POST /send {"hex":...} — firmware prepends 8301. */
export function payloadToSendHex(byteArray) {
  return bytesToHex(byteArray);
}

/** Full on-air bytes for POST /show — includes 8301 prefix. */
export function payloadToShowHex(byteArray) {
  const payload = bytesToHex(byteArray).toLowerCase();
  if (payload.startsWith(COMPANY_ID)) return payload;
  return COMPANY_ID + payload;
}

/** Strip fixed 8301 envelope only; keep e1/e2 session byte. */
export function stripCompanyId(hex) {
  const clean = (hex || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (clean.startsWith(COMPANY_ID)) return clean.slice(4);
  return clean;
}

export function hasCompanyIdPrefix(hex) {
  return (hex || '').replace(/[^0-9a-fA-F]/gi, '').toLowerCase().startsWith(COMPANY_ID);
}

export function buildShowBodyFromPayloadRepeats(
  payloadBytes,
  repeatCount,
  dwellMs,
  lastHoldMs = DEFAULT_LAST_HOLD_MS,
) {
  const fullHex = payloadToShowHex(payloadBytes);
  const lines = [];
  const n = Math.max(1, Math.min(200, repeatCount | 0));
  for (let i = 0; i < n; i++) {
    const hold = i < n - 1 ? dwellMs : lastHoldMs;
    lines.push(`${hold} ${fullHex}`);
  }
  return lines.join('\n');
}

export function buildShowBodyFromSweep(
  baseBytes,
  sweepByteIndex,
  startVal,
  endVal,
  stepVal,
  dwellMs,
  lastHoldMs = DEFAULT_LAST_HOLD_MS,
) {
  const lines = [];
  const values = [];
  const step = Math.max(1, stepVal | 0);
  const forward = startVal <= endVal;

  for (let v = startVal; forward ? v <= endVal : v >= endVal; v += forward ? step : -step) {
    values.push(v & 0xff);
  }
  const uniq = [...new Set(values)];

  uniq.forEach((val, i) => {
    const bytes = [...baseBytes];
    if (sweepByteIndex >= 0 && sweepByteIndex < bytes.length) {
      bytes[sweepByteIndex] = val;
    }
    const hold = i < uniq.length - 1 ? dwellMs : lastHoldMs;
    lines.push(`${hold} ${payloadToShowHex(bytes)}`);
  });
  return { body: lines.join('\n'), values: uniq };
}

/** Build /show body from capture rows: [{ ts_ms?, hex }]. */
/** Build /show body from packet rows with per-step waitMs (payload bytes; 8301 added per step). */
export function buildShowBodyFromPackets(packets, lastHoldMs = DEFAULT_LAST_HOLD_MS) {
  if (!packets?.length) return '';
  const lines = [];
  for (let i = 0; i < packets.length; i++) {
    const p = packets[i];
    if (!p?.bytes?.length) continue;
    const hold = i < packets.length - 1
      ? Math.max(50, Number(p.waitMs) || DEFAULT_LAST_HOLD_MS)
      : Math.max(50, Number(p.waitMs) || lastHoldMs);
    lines.push(`${hold} ${payloadToShowHex(p.bytes)}`);
  }
  return lines.join('\n');
}

export function buildShowBodyFromCaptureRows(rows, fallbackHoldMs = DEFAULT_LAST_HOLD_MS) {
  const parsed = rows
    .map((r) => ({
      ts: r.ts_ms != null ? Number(r.ts_ms) : null,
      hex: (r.hex || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase(),
    }))
    .filter((r) => r.hex.length >= 4);

  const deduped = [];
  for (const row of parsed) {
    if (deduped.length && deduped[deduped.length - 1].hex === row.hex) continue;
    deduped.push(row);
  }
  if (!deduped.length) return '';

  const lines = [];
  for (let i = 0; i < deduped.length; i++) {
    let hold = fallbackHoldMs;
    if (i < deduped.length - 1) {
      const a = deduped[i].ts;
      const b = deduped[i + 1].ts;
      if (a != null && b != null && b > a) hold = Math.max(50, b - a);
    }
    const hex = deduped[i].hex.startsWith(COMPANY_ID) ? deduped[i].hex : COMPANY_ID + deduped[i].hex;
    lines.push(`${hold} ${hex}`);
  }
  return lines.join('\n');
}

export async function getStatus(ip) {
  const res = await fetch(`${baseUrl(ip)}/status`);
  if (!res.ok) throw new Error(`Status failed (${res.status})`);
  return res.json();
}

export async function sendLine(ip, line) {
  const res = await fetch(`${baseUrl(ip)}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ line }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  const j = await res.json();
  if (!j.ok) throw new Error('Simulator rejected command');
  return j;
}

export async function sendHex(ip, payloadBytes) {
  const res = await fetch(`${baseUrl(ip)}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hex: payloadToSendHex(payloadBytes) }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  const j = await res.json();
  if (!j.ok) throw new Error('Simulator rejected payload');
  return j;
}

export async function startShow(ip, body) {
  const res = await fetch(`${baseUrl(ip)}/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'Show rejected');
  return j;
}

export async function stopShow(ip) {
  const res = await fetch(`${baseUrl(ip)}/stop`, { method: 'POST' });
  const j = await res.json();
  if (!j.ok) throw new Error('Stop failed');
  return j;
}
