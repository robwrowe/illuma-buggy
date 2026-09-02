import { mbVibByte, encodeMbColorMaskByte } from './mbPayloads';

/** Color-format byte options for the block right after TB. */
export const TAIL_BUILDER_COLOR_FORMATS = [
  { value: '0f', label: '0x0F — palette, multi-slot (mask+palette byte per color)' },
  { value: '0e', label: '0x0E — palette, solid (mask+palette byte, single color)' },
  { value: 'd2', label: '0xD2 — RGB triple(s) (55 R G B per color group)' },
];

/**
 * One color slot in the builder.
 * @typedef {object} TailBuilderColor
 * @property {'palette'|'rgb'} kind
 * @property {number} [paletteIdx] - 0-31, used when kind === 'palette'
 * @property {number} [mask] - 0-7, used when kind === 'palette'
 * @property {number} [r] - 0-255, used when kind === 'rgb'
 * @property {number} [g]
 * @property {number} [b]
 */

/** Encode one palette-format color slot via encodeMbColorMaskByte (mask in bits[7:5], palette in bits[4:0]). */
export function encodeTailColorByte(color) {
  if (!color) return 0x00;
  if (color.kind === 'rgb') {
    // Only meaningful inside a D2 block; palette encode is a no-op fallback.
    return 0x00;
  }
  return encodeMbColorMaskByte(color.paletteIdx ?? 0, color.mask ?? 0);
}

/**
 * Build the color block bytes for N colors in a given format.
 * - '0f' / '0e': one byte per color (mask+palette).
 * - 'd2': for each color, emit [0x55, r, g, b].
 * @param {string} format - one of TAIL_BUILDER_COLOR_FORMATS values
 * @param {TailBuilderColor[]} colors
 * @returns {number[]}
 */
export function buildColorBlockBytes(format, colors) {
  const list = Array.isArray(colors) ? colors : [];
  if (format === 'd2') {
    const out = [];
    list.forEach((c) => {
      out.push(0x55);
      out.push(Number(c.r ?? 0) & 0xff);
      out.push(Number(c.g ?? 0) & 0xff);
      out.push(Number(c.b ?? 0) & 0xff);
    });
    return out;
  }
  return list.map(encodeTailColorByte);
}

/**
 * Parse a free-typed tail string into a byte array. Non-hex characters are ignored as separators.
 * Packed forms ("FFFFFFFF", "ffffffff", "FF FF FF FF") go through here.
 * Prefer parseTailLine() when the input may contain 0xNN tokens or TSV cells.
 * @param {string} raw
 * @returns {number[]}
 */
export function parseTailBytes(raw) {
  const clean = String(raw || '').replace(/[^0-9a-fA-F]/g, '');
  const out = [];
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

/** One token → a single byte (`0x30`, `30`, `7B`), or null if not a 1–2 digit hex byte. */
export function parseByteToken(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  const m = t.match(/^(?:0x)?([0-9a-fA-F]{1,2})$/i);
  if (!m) return null;
  return parseInt(m[1], 16);
}

function isHexByteToken(token) {
  return parseByteToken(token) != null;
}

/**
 * Parse one pasted line into tail bytes.
 * Accepts spreadsheet cells (`0x30\t0x7B\t0x02`), spaced 0x tokens,
 * spaced pairs (`FF FF FF FF` / `58 F4 48`), or packed hex (`FFFFFFFF`).
 * Empty TSV cells are ignored.
 * @param {string} line
 * @returns {number[]}
 */
export function parseTailLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return [];

  const hasDelim = /[\t,;]/.test(trimmed) || /0x/i.test(trimmed);
  if (hasDelim) {
    const parts = trimmed.split(/[\t,;]+|\s+/).map((s) => s.trim()).filter(Boolean);
    const bytes = [];
    for (const p of parts) {
      const one = parseByteToken(p);
      if (one != null) {
        bytes.push(one);
        continue;
      }
      bytes.push(...parseTailBytes(p));
    }
    return bytes;
  }

  const spaceTokens = trimmed.split(/\s+/).filter(Boolean);
  if (spaceTokens.length > 1 && spaceTokens.every(isHexByteToken)) {
    return spaceTokens.map(parseByteToken);
  }

  return parseTailBytes(trimmed);
}

function tailEntry(bytes) {
  const b = (bytes || []).map((x) => x & 0xff);
  return {
    bytes: b,
    hex: b.map((x) => x.toString(16).padStart(2, '0')).join(''),
    displayHex: tailBytesToDisplayHex(b),
  };
}

/**
 * Parse a paste (one tail per line) into an array of tail entries.
 * Blank lines are skipped. Lines with no parseable bytes are counted in `skipped`.
 * @param {string} raw
 * @returns {{ tails: { bytes: number[], hex: string, displayHex: string }[], skipped: number }}
 */
export function parseTailList(raw) {
  const tails = [];
  let skipped = 0;
  for (const line of String(raw || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const bytes = parseTailLine(line);
    if (!bytes.length) {
      skipped += 1;
      continue;
    }
    tails.push(tailEntry(bytes));
  }
  return { tails, skipped };
}

/** Collapse runs of identical consecutive tails (A A B A → A B A). */
export function omitConsecutiveDuplicateTails(tails) {
  const out = [];
  for (const t of tails || []) {
    const prev = out[out.length - 1];
    if (prev && prev.hex === t.hex) continue;
    out.push(t);
  }
  return out;
}

/** Format a byte array back into a spaced hex string for display / re-editing. */
export function tailBytesToDisplayHex(bytes) {
  return (bytes || [])
    .map((b) => (b & 0xff).toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

export function isPartEnabled(partEnabled, id) {
  return !partEnabled || partEnabled[id] !== false;
}

/** Envelope byte: `e1` / `e2` or a 1–2 digit hex string. */
export function envelopeByte(envelope) {
  const raw = String(envelope ?? 'e1').replace(/^0x/i, '').trim().toLowerCase();
  if (raw === 'e2') return 0xe2;
  if (raw === 'e1' || raw === '') return 0xe1;
  const n = parseInt(raw, 16);
  return Number.isFinite(n) ? n & 0xff : 0xe1;
}

function applyPartOverrides(parts, overrides) {
  if (!overrides || typeof overrides !== 'object') return parts;
  return parts.map((p) => {
    const v = overrides[p.id];
    if (v == null) return p;
    const n = Number(v);
    if (!Number.isFinite(n)) return p;
    return { ...p, byte: n & 0xff, baseByte: p.byte };
  });
}

export function tailPartId(index) {
  return `t${index}`;
}

export function colorPartIds(index, format) {
  if (format === 'd2') return [`c${index}.55`, `c${index}.r`, `c${index}.g`, `c${index}.b`];
  return [`c${index}`];
}

/**
 * Ordered labeled bytes for the assembled packet (before include-filters).
 * `sub` is a placeholder; assembleTailPayload fills it from the kept length.
 */
export function buildTailPayloadParts({
  timingByte,
  colorFormat,
  colors,
  tailBytes,
  vibration = null,
  envelope = 'e1',
}) {
  const envByte = envelopeByte(envelope);
  const tb = Number(timingByte) & 0xff;
  const formatByte = parseInt(String(colorFormat), 16) & 0xff;
  const parts = [
    { id: 'env', role: 'env', label: 'env', byte: envByte, editable: true },
    { id: 'envPad', role: 'fixed', label: 'pad', byte: 0x00, editable: false },
    { id: 'e9', role: 'fixed', label: 'E9', byte: 0xe9, editable: false },
    { id: 'sub', role: 'len', label: 'len', byte: 0, editable: false },
    { id: 'pad', role: 'fixed', label: 'pad', byte: 0x00, editable: false },
    { id: 'tb', role: 'timing', label: 'TB', byte: tb, editable: true },
    { id: 'fmt', role: 'format', label: 'fmt', byte: formatByte, editable: true },
  ];
  const list = Array.isArray(colors) ? colors : [];
  if (colorFormat === 'd2') {
    list.forEach((c, i) => {
      parts.push({ id: `c${i}.55`, role: 'color', colorIdx: i, label: `c${i}`, byte: 0x55, editable: false });
      parts.push({ id: `c${i}.r`, role: 'color', colorIdx: i, label: 'R', byte: Number(c.r ?? 0) & 0xff, editable: true });
      parts.push({ id: `c${i}.g`, role: 'color', colorIdx: i, label: 'G', byte: Number(c.g ?? 0) & 0xff, editable: true });
      parts.push({ id: `c${i}.b`, role: 'color', colorIdx: i, label: 'B', byte: Number(c.b ?? 0) & 0xff, editable: true });
    });
  } else {
    list.forEach((c, i) => {
      parts.push({
        id: `c${i}`,
        role: 'color',
        colorIdx: i,
        label: `c${i}`,
        byte: encodeTailColorByte(c),
        editable: true,
      });
    });
  }
  const tail = Array.isArray(tailBytes) ? tailBytes.map((b) => b & 0xff) : [];
  tail.forEach((b, i) => {
    parts.push({ id: tailPartId(i), role: 'tail', tailIdx: i, label: `[${i}]`, byte: b, editable: true });
  });
  if (vibration != null) {
    parts.push({ id: 'vib', role: 'vib', label: 'vib', byte: mbVibByte(vibration), editable: true });
  }
  return parts;
}

/**
 * Assemble the full on-air payload (envelope + opcode + length + TB +
 * format byte + color block + tail + optional vibration).
 *
 * Layout:
 *   [env] [00] [E9] [subOpcode] [00] [TB] [format] [...colors] [...tail] [vib?]
 *
 * subOpcode is derived: it equals the byte count after the sub-opcode byte
 * (confirmed `total_len_bytes = sub_opcode + 2`).
 *
 * `partEnabled` maps part id → false to omit that byte without deleting its
 * source value. Missing keys are included.
 * `partOverrides` maps part id → byte, applied after length is derived.
 *
 * @returns {{ bytes: number[], hex: string, subOpcode: number, subOpcodeHex: string, warnings: string[], parts: object[], kept: object[] }}
 */
export function assembleTailPayload({
  timingByte,
  colorFormat,
  colors,
  tailBytes,
  vibration = null,
  envelope = 'e1',
  partEnabled = null,
  partOverrides = null,
}) {
  const warnings = [];
  let parts = buildTailPayloadParts({
    timingByte,
    colorFormat,
    colors,
    tailBytes,
    vibration,
    envelope,
  });
  const withLen = parts.filter((p) => p.id === 'sub' || isPartEnabled(partEnabled, p.id));
  const subAt = withLen.findIndex((p) => p.id === 'sub');
  const subOpcode = subAt >= 0 ? (withLen.length - subAt - 1) & 0xff : 0;
  const partSub = parts.findIndex((p) => p.id === 'sub');
  if (partSub >= 0) {
    parts[partSub] = { ...parts[partSub], byte: subOpcode };
  }
  parts = applyPartOverrides(parts, partOverrides);
  const kept = parts.filter((p) => isPartEnabled(partEnabled, p.id));

  if (subOpcode > 0x1f) {
    warnings.push(
      `Derived sub-opcode 0x${subOpcode.toString(16).padStart(2, '0').toUpperCase()} is unusually large `
        + '(known captures top out around 0x14/20 bytes) — double check the tail length.',
    );
  }
  if (!kept.some((p) => p.role === 'color')) {
    warnings.push('No colors selected — color block is empty.');
  }
  if (!kept.some((p) => p.role === 'tail')) {
    warnings.push('Tail is empty — packet will end right after the color block.');
  }

  const bytes = kept.map((p) => p.byte & 0xff);
  return {
    bytes,
    hex: bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0')).join(''),
    parts,
    kept,
    subOpcode,
    subOpcodeHex: subOpcode.toString(16).padStart(2, '0').toUpperCase(),
    warnings,
  };
}
