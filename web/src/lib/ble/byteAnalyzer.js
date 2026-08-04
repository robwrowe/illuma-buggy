import { hexToBytes, bytesToHex } from './e9Decode';
import { createEmptyRule, createEmptyExtract, createEmptyExtractTarget } from './mbMapping';
import { hasCompanyIdPrefix, stripCompanyId } from './wandSimClient';
import { deserializeByteTags, serializeByteTags } from '../sheets/wandLabSheetsClient';

export { deserializeByteTags, serializeByteTags };

/** One pasted line → one packet row for the analyzer grid. */
export function parseAnalyzerInput(text, { strip8301 = true } = {}) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      let hex = line;
      if (strip8301 && hasCompanyIdPrefix(hex)) hex = stripCompanyId(hex);
      const bytes = hexToBytes(hex);
      return { id: `row-${i}-${Date.now()}`, raw: line, bytes };
    })
    .filter((row) => row.bytes.length > 0);
}

/** True when paste looks like a Sheets `byte_tags` export (TSV), not bare hex lines. */
export function looksLikeByteTagsSheetPaste(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return false;
  const first = lines[0];
  if (/\bhex\b/i.test(first) && /\bbyte_tags\b/i.test(first)) return true;
  if (!first.includes('\t')) return false;
  // Headerless: a hex-ish column and a tags-ish column on the first data row
  const cols = first.split('\t').map((c) => c.trim());
  const hasHex = cols.some((c) => /^[0-9a-fA-F]{12,}$/i.test(c.replace(/\s/g, '')));
  const hasTags = cols.some((c) => /^\d+:[a-zA-Z]/.test(c) || /:\d+:/.test(c));
  return hasHex && hasTags;
}

function cleanHexField(raw) {
  return String(raw || '').replace(/[^0-9a-fA-F]/g, '');
}

function looksLikeHexField(raw) {
  const h = cleanHexField(raw);
  return h.length >= 12 && h.length % 2 === 0;
}

function looksLikeTagsField(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;
  return /^\d+:[a-zA-Z]/.test(s) || s.split(',').some((p) => /^\d+:[a-zA-Z]/.test(p.trim()));
}

/**
 * Parse a Sheets `byte_tags` tab copy (header optional).
 * @returns {{ ok: boolean, packets?: object[], message: string }}
 */
export function parseByteTagsSheetPaste(text, { strip8301 = true } = {}) {
  const lines = String(text || '').trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { ok: false, message: 'Nothing to import' };

  let start = 0;
  let col = {
    finding_id: -1,
    opcode: -1,
    hex: -1,
    byte_tags: -1,
    linked_rule_id: -1,
    notes: -1,
  };

  const headerCells = lines[0].split('\t').map((c) => c.trim().toLowerCase());
  const hasHeader = headerCells.includes('hex') && headerCells.includes('byte_tags');
  if (hasHeader) {
    headerCells.forEach((name, i) => {
      if (name in col) col[name] = i;
    });
    start = 1;
  }

  const packets = [];
  for (let li = start; li < lines.length; li++) {
    const cells = lines[li].split('\t').map((c) => c.trim());
    let hexRaw = '';
    let tagsRaw = '';
    let opcode = '';
    let notes = '';
    let findingId = '';
    let linkedRuleId = '';

    if (hasHeader) {
      hexRaw = col.hex >= 0 ? cells[col.hex] : '';
      tagsRaw = col.byte_tags >= 0 ? cells[col.byte_tags] : '';
      opcode = col.opcode >= 0 ? (cells[col.opcode] || '') : '';
      notes = col.notes >= 0 ? (cells[col.notes] || '') : '';
      findingId = col.finding_id >= 0 ? (cells[col.finding_id] || '') : '';
      linkedRuleId = col.linked_rule_id >= 0 ? (cells[col.linked_rule_id] || '') : '';
    } else {
      // Heuristic: first hex-looking col + first tags-looking col
      for (const c of cells) {
        if (!hexRaw && looksLikeHexField(c)) hexRaw = c;
        else if (!tagsRaw && looksLikeTagsField(c)) tagsRaw = c;
      }
      // Common subset: hex, opcode, tags  OR  hex, tags
      if (!hexRaw && cells[0]) hexRaw = cells[0];
      if (!tagsRaw) {
        const maybeTags = cells.find((c) => looksLikeTagsField(c));
        if (maybeTags) tagsRaw = maybeTags;
      }
    }

    let hex = cleanHexField(hexRaw);
    if (hex.length < 12) continue;
    if (strip8301 && hasCompanyIdPrefix(hex)) hex = stripCompanyId(hex);
    const bytes = hexToBytes(hex);
    if (!bytes.length) continue;

    const tagList = deserializeByteTags(tagsRaw, bytes.length);
    packets.push({
      id: `imp-${li}-${Date.now()}-${packets.length}`,
      raw: hex,
      bytes,
      tags: tagList,
      opcode: String(opcode || '').trim(),
      notes: String(notes || '').trim(),
      findingId: String(findingId || '').trim(),
      linkedRuleId: String(linkedRuleId || '').trim(),
      byteTagsSerialized: tagsRaw || serializeByteTags(tagList),
    });
  }

  if (!packets.length) {
    return {
      ok: false,
      message: 'No rows with hex + tags found — copy from the byte_tags sheet (include header if possible)',
    };
  }
  return {
    ok: true,
    packets,
    message: `Imported ${packets.length} tagged packet${packets.length === 1 ? '' : 's'}`,
  };
}

/**
 * Collapse identical tags across packets into columnTags; row-specific diffs → cellTags.
 * @param {{ id: string, bytes: number[], tags: object[] }[]} packets
 */
export function partitionImportedTags(packets) {
  const columnTags = {};
  const cellTags = {};
  const maxLen = packets.reduce((m, p) => Math.max(m, p.bytes?.length || 0), 0);

  for (let i = 0; i < maxLen; i++) {
    const present = packets
      .filter((p) => i < (p.bytes?.length || 0))
      .map((p) => ({ id: p.id, tag: p.tags?.[i] || null }));
    if (!present.length) continue;
    const key = (t) => JSON.stringify(t);
    const allSame = present.every((p) => key(p.tag) === key(present[0].tag));
    if (allSame && present[0].tag) {
      columnTags[i] = present[0].tag;
    } else {
      present.forEach(({ id, tag }) => {
        if (!tag) return;
        if (!cellTags[id]) cellTags[id] = {};
        cellTags[id][i] = tag;
      });
    }
  }
  return { columnTags, cellTags };
}

/**
 * Build analyzer rows + tag maps from imported / log packets.
 */
export function buildAnalyzerStateFromPackets(packets) {
  const rows = packets.map((p, i) => ({
    id: p.id || `row-${i}-${Date.now()}`,
    raw: p.raw || bytesToHex(p.bytes || []),
    bytes: p.bytes || [],
    opcode: p.opcode || '',
    notes: p.notes || '',
    findingId: p.findingId || '',
    linkedRuleId: p.linkedRuleId || '',
  }));
  const withIds = packets.map((p, i) => ({
    ...p,
    id: rows[i].id,
    tags: p.tags || deserializeByteTags(p.byteTagsSerialized || '', (p.bytes || []).length),
  }));
  const { columnTags, cellTags } = partitionImportedTags(withIds);
  return { rows, columnTags, cellTags };
}

/** Tag kinds, in UI display order. */
export const BYTE_TAG_KINDS = [
  { id: 'timing', label: 'Timing', color: 'orange' },
  { id: 'color', label: 'Color', color: 'grape' },
  { id: 'param', label: 'Param', color: 'blue' },
  { id: 'anchor', label: 'Anchor', color: 'yellow' },
  { id: 'signature', label: 'Signature', color: 'teal' },
  { id: 'vibration', label: 'Vibration', color: 'gray' },
];

export function createEmptyParamDetail() {
  return { bitStart: 0, bitCount: 8, paramName: '' };
}

export function createEmptyColorDetail() {
  return { mode: 'palette', channelRole: '', groupId: '' };
}

/** 1-based occurrence of bytes[index] within bytes[0..index]. */
export function byteOccurrenceAt(bytes, index) {
  if (!bytes?.length || index < 0 || index >= bytes.length) return 1;
  const v = bytes[index] & 0xff;
  let n = 0;
  for (let i = 0; i <= index; i++) {
    if ((bytes[i] & 0xff) === v) n++;
  }
  return Math.max(1, n);
}

/**
 * Nearest anchor-tagged index at or before `index`, or -1.
 * Used so extracts / colors / timing can be emitted relative to a marker.
 */
export function nearestAnchorIndex(byteTags, index) {
  if (!Array.isArray(byteTags) || index < 0) return -1;
  for (let j = Math.min(index, byteTags.length - 1); j >= 0; j--) {
    if (byteTags[j]?.kind === 'anchor') return j;
  }
  return -1;
}

/**
 * Absolute offset, or anchor-relative fields when an Anchor tag precedes this index.
 * @returns {{ offset: number, anchor?: object }}
 */
export function offsetOrAnchorFromTags(bytes, byteTags, index) {
  const offset = Math.max(0, index);
  const anchorIdx = nearestAnchorIndex(byteTags, index);
  if (anchorIdx < 0 || !bytes?.length || anchorIdx >= bytes.length) {
    return { offset };
  }
  return {
    offset,
    anchor: {
      byte: (bytes[anchorIdx] & 0xff).toString(16).padStart(2, '0').toUpperCase(),
      occurrence: byteOccurrenceAt(bytes, anchorIdx),
      searchFrom: 0,
      searchLen: 0,
      deltaBytes: index - anchorIdx,
    },
  };
}

/**
 * A cell override wins over the column default for that specific row+index.
 * @returns {{ kind: string, detail: object }|null}
 */
export function effectiveTag(byteIndex, rowId, columnTags, cellTags) {
  return cellTags?.[rowId]?.[byteIndex] ?? columnTags?.[byteIndex] ?? null;
}

/** For each byte index, is the value constant across all rows long enough to have that index? */
export function columnConstancy(rows) {
  const maxLen = rows.reduce((m, r) => Math.max(m, r.bytes.length), 0);
  const result = [];
  for (let i = 0; i < maxLen; i++) {
    const vals = rows.filter((r) => i < r.bytes.length).map((r) => r.bytes[i]);
    const distinct = new Set(vals);
    result.push({
      index: i,
      constant: distinct.size <= 1,
      distinctCount: distinct.size,
      coverage: vals.length,
    });
  }
  return result;
}

/**
 * Flattens column defaults + per-cell overrides into one array aligned to `bytes`.
 */
export function flattenRowTags(bytes, columnTags, cellTagsForRow) {
  return bytes.map((_, i) => cellTagsForRow?.[i] ?? columnTags?.[i] ?? null);
}

/**
 * Groups color/rgb-mode entries by detail.groupId.
 * @returns {{ complete: object[], incomplete: object[] }}
 */
export function groupRgbColorTags(colorRgbEntries) {
  const byGroup = new Map();
  colorRgbEntries.forEach(({ index, detail }) => {
    const g = detail.groupId || '(no group)';
    if (!byGroup.has(g)) byGroup.set(g, {});
    const slot = byGroup.get(g);
    const role = detail.channelRole;
    if (slot[role]) {
      slot[role] = {
        ...slot[role],
        duplicate: true,
        indices: [...(slot[role].indices || [slot[role].index]), index],
      };
    } else {
      slot[role] = { index };
    }
  });

  const complete = [];
  const incomplete = [];
  byGroup.forEach((roles, groupId) => {
    const hasDup = ['r', 'g', 'b'].some((role) => roles[role]?.duplicate);
    const missing = ['r', 'g', 'b'].filter((role) => !roles[role]);
    if (hasDup) {
      incomplete.push({ groupId, roles, issue: 'duplicate' });
    } else if (missing.length) {
      incomplete.push({ groupId, roles, issue: 'missing', missing });
    } else {
      complete.push({ groupId, r: roles.r.index, g: roles.g.index, b: roles.b.index });
    }
  });
  return { complete, incomplete };
}

/**
 * Builds a draft rule from one tagged row.
 * @returns {{ rule: object, warnings: string[] }}
 */
export function generateRuleFromTags(bytes, byteTags, { ruleName = '' } = {}) {
  const warnings = [];
  const sigIndices = [];
  const paletteColorIndices = [];
  const rgbColorEntries = [];
  const paramEntries = [];
  const anchorIndices = [];
  let timingIndex = -1;

  byteTags.forEach((t, i) => {
    if (!t) return;
    if (t.kind === 'signature') sigIndices.push(i);
    else if (t.kind === 'anchor') anchorIndices.push(i);
    else if (t.kind === 'color' && t.detail?.mode === 'rgb') rgbColorEntries.push({ index: i, detail: t.detail });
    else if (t.kind === 'color') paletteColorIndices.push(i);
    else if (t.kind === 'param') paramEntries.push({ index: i, detail: t.detail || {} });
    else if (t.kind === 'timing' && timingIndex === -1) timingIndex = i;
  });

  if (!sigIndices.length) {
    warnings.push('No signature bytes tagged — generated rule has an empty match group; add at least one condition before pushing.');
  }
  if (!paletteColorIndices.length && !rgbColorEntries.length && !paramEntries.length) {
    warnings.push('No color or param bytes tagged — this rule will only match, it will not drive any output yet.');
  }
  if (anchorIndices.length) {
    warnings.push(
      `${anchorIndices.length} anchor marker(s) tagged — extracts/colors/timing after a marker use anchor-relative offsets when generating.`,
    );
  }

  const loc = (index) => offsetOrAnchorFromTags(bytes, byteTags, index);

  const rule = createEmptyRule({
    name: ruleName || 'Generated from analyzer',
    match: {
      mode: 'all',
      children: sigIndices.map((i) => ({
        mode: 'some',
        children: [{ type: 'byte', offset: i, op: 'eq', value: bytes[i] }],
      })),
    },
  });

  paletteColorIndices.forEach((i, n) => {
    rule.extract.push({
      ...createEmptyExtract(`color${n}`),
      ...loc(i),
      bitStart: 0,
      bitCount: 8,
      paletteMap: true,
      targets: [{ kind: 'maskColor', mask: 'all' }],
    });
  });

  const { complete, incomplete } = groupRgbColorTags(rgbColorEntries);
  complete.forEach(({ groupId, r, g, b }) => {
    rule.colorSources.push({
      name: groupId,
      kind: 'rgb',
      channelGroup: {
        r: { ...loc(r), bitStart: 0, bitCount: 8 },
        g: { ...loc(g), bitStart: 0, bitCount: 8 },
        b: { ...loc(b), bitStart: 0, bitCount: 8 },
        scale: 'direct8',
      },
    });
  });
  incomplete.forEach(({ groupId, issue, missing }) => {
    warnings.push(
      issue === 'duplicate'
        ? `Color group "${groupId}" has more than one byte tagged with the same R/G/B role — that group was skipped; fix the role assignments and regenerate, or add colorSources manually in Rules.`
        : `Color group "${groupId}" is missing ${missing.map((role) => role.toUpperCase()).join('/')} — that group was skipped; tag the missing channel(s) or add colorSources manually in Rules.`,
    );
  });

  paramEntries.forEach(({ index, detail }) => {
    rule.extract.push({
      ...createEmptyExtract(detail.paramName || `param${index}`),
      source: 'payloadBits',
      ...loc(index),
      bitStart: detail.bitStart ?? 0,
      bitCount: detail.bitCount ?? 8,
      paletteMap: false,
      targets: [createEmptyExtractTarget('segmentField')],
    });
  });
  if (paramEntries.length) {
    warnings.push(`${paramEntries.length} param extract(s) generated with no target field selected — open each in the Rules tab and choose sx/ix/c1/etc.`);
  }

  if (timingIndex >= 0) {
    rule.timing = {
      ...rule.timing,
      ...loc(timingIndex),
      enabled: false,
      timingModelId: '',
    };
    warnings.push(`Timing byte tagged at offset ${timingIndex} — timing is left disabled; enable it and pick a timing model in the Rules → Timing Models tab once you've confirmed the byte's encoding.`);
  }

  return { rule, warnings };
}

export { hexToBytes, bytesToHex };
