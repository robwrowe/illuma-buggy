import { hexToBytes, bytesToHex } from './e9Decode';
import { createEmptyRule, createEmptyExtract, createEmptyExtractTarget } from './mbMapping';
import { hasCompanyIdPrefix, stripCompanyId } from './wandSimClient';

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

/** Tag kinds, in UI display order. */
export const BYTE_TAG_KINDS = [
  { id: 'timing', label: 'Timing', color: 'orange' },
  { id: 'color', label: 'Color', color: 'grape' },
  { id: 'param', label: 'Param', color: 'blue' },
  { id: 'signature', label: 'Signature', color: 'teal' },
  { id: 'vibration', label: 'Vibration', color: 'gray' },
];

export function createEmptyParamDetail() {
  return { bitStart: 0, bitCount: 8, paramName: '' };
}

export function createEmptyColorDetail() {
  return { mode: 'palette', channelRole: '', groupId: '' };
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
  let timingIndex = -1;

  byteTags.forEach((t, i) => {
    if (!t) return;
    if (t.kind === 'signature') sigIndices.push(i);
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
      offset: i,
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
        r: { offset: r, bitStart: 0, bitCount: 8 },
        g: { offset: g, bitStart: 0, bitCount: 8 },
        b: { offset: b, bitStart: 0, bitCount: 8 },
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
      offset: index,
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
    rule.timing = { ...rule.timing, offset: timingIndex, enabled: false, timingModelId: '' };
    warnings.push(`Timing byte tagged at offset ${timingIndex} — timing is left disabled; enable it and pick a timing model in the Rules → Timing Models tab once you've confirmed the byte's encoding.`);
  }

  return { rule, warnings };
}

export { hexToBytes, bytesToHex };
