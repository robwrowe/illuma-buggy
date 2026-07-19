/**
 * MagicBand+ rule-engine decode primitives.
 * Mirrors firmware StrollerController/MbRuleEngine.cpp formulas.
 */

/** @param {string} hex */
export function hexToBytes(hex) {
  const clean = String(hex || '').replace(/[^0-9a-fA-F]/g, '');
  const out = [];
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

/** @param {number[]|Uint8Array} bytes */
export function bytesToHex(bytes) {
  return Array.from(bytes || [])
    .map((b) => (b & 0xff).toString(16).padStart(2, '0'))
    .join('');
}

/** Strip Disney CID 8301 if present — firmware evaluates payload after CID. */
export function disneyPayload(bytes) {
  const arr = Array.from(bytes || []);
  if (arr.length >= 2 && arr[0] === 0x83 && arr[1] === 0x01) return arr.slice(2);
  return arr;
}

/**
 * LSB-first bit extraction within a single byte (matches firmware extractBits).
 * @param {number[]} payload
 * @param {number} offset
 * @param {number} bitStart
 * @param {number} bitCount
 */
export function extractBits(payload, offset, bitStart, bitCount) {
  const plen = payload?.length ?? 0;
  if (!payload || offset >= plen || bitCount <= 0 || bitCount > 32 || bitStart > 7) return 0;
  const byte = payload[offset] & 0xff;
  let count = bitCount;
  const avail = 8 - bitStart;
  if (count > avail) count = avail;
  const mask = count === 32 ? 0xffffffff : (1 << count) - 1;
  return (byte >>> bitStart) & mask;
}

/**
 * @param {number} rawValue
 * @param {{ type?: string, inMin?: number, inMax?: number, outMin?: number, outMax?: number, exponent?: number }} curve
 */
export function applyCurve(rawValue, curve = {}) {
  const inMin = Number(curve.inMin ?? 0);
  const inMax = Number(curve.inMax ?? 15);
  const outMin = Number(curve.outMin ?? 0);
  const outMax = Number(curve.outMax ?? 255);
  if (inMax === inMin) return outMin;
  let v = Number(rawValue) || 0;
  if (v < inMin) v = inMin;
  if (v > inMax) v = inMax;
  let t = (v - inMin) / (inMax - inMin);
  if (curve.type === 'exponential') {
    let exponent = Number(curve.exponent ?? 2);
    if (!(exponent > 0)) exponent = 2;
    t = t ** exponent;
  }
  return outMin + t * (outMax - outMin);
}

function compareOp(lhs, op, rhs) {
  switch (op) {
    case 'eq': return lhs === rhs;
    case 'gt': return lhs > rhs;
    case 'gte': return lhs >= rhs;
    case 'lt': return lhs < rhs;
    case 'lte': return lhs <= rhs;
    default: return false;
  }
}

/** Case-insensitive hex prefix match (even-length hex only). */
export function matchHexPrefix(payload, hex) {
  if (!payload || hex == null) return false;
  const clean = String(hex).replace(/[^0-9a-fA-F]/g, '');
  if (!clean.length || (clean.length & 1)) return false;
  const need = clean.length / 2;
  if (need > payload.length) return false;
  for (let i = 0; i < need; i++) {
    const want = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if ((payload[i] & 0xff) !== want) return false;
  }
  return true;
}

/**
 * @param {number[]} payloadBytes
 * @param {object} leaf
 */
export function evaluateLeaf(payloadBytes, leaf) {
  if (!leaf || !payloadBytes) return false;
  const type = leaf.type || '';
  if (type === 'hexPrefix') {
    return matchHexPrefix(payloadBytes, leaf.value ?? '');
  }
  if (type === 'length') {
    return compareOp(payloadBytes.length, leaf.op || 'eq', Number(leaf.value ?? 0));
  }
  if (type === 'byte') {
    const offset = Number(leaf.offset ?? 0);
    const op = leaf.op || 'eq';
    if (op === 'maskEq') {
      if (offset >= payloadBytes.length) return false;
      const mask = Number(leaf.mask ?? 0xff) & 0xff;
      const want = Number(leaf.value ?? 0) & 0xff;
      return ((payloadBytes[offset] & mask) & 0xff) === want;
    }
    const v = extractBits(payloadBytes, offset, 0, 8);
    return compareOp(v, op, Number(leaf.value ?? 0));
  }
  if (type === 'bits') {
    const offset = Number(leaf.offset ?? 0);
    const bitStart = Number(leaf.bitStart ?? 0);
    const bitCount = Number(leaf.bitCount ?? 1);
    const v = extractBits(payloadBytes, offset, bitStart, bitCount);
    return compareOp(v, leaf.op || 'eq', Number(leaf.value ?? 0));
  }
  return false;
}

/**
 * Recursive all/some condition groups. Leaf nodes have `type`; groups have `mode` + `children`.
 * @param {number[]} payloadBytes
 * @param {object} groupNode
 */
export function evaluateConditionGroup(payloadBytes, groupNode) {
  if (!groupNode || typeof groupNode !== 'object') return false;
  if (groupNode.type) return evaluateLeaf(payloadBytes, groupNode);

  const mode = groupNode.mode || 'all';
  const children = Array.isArray(groupNode.children) ? groupNode.children : [];
  if (!children.length) return false;

  const isAll = mode === 'all';
  for (const child of children) {
    const ok = evaluateConditionGroup(payloadBytes, child);
    if (isAll && !ok) return false;
    if (!isAll && ok) return true;
  }
  return isAll;
}

/**
 * Enabled rules, sort by priority ascending (then array order), return first match.
 * @param {number[]} payloadBytes
 * @param {object[]} rules
 * @returns {object|null}
 */
export function findMatchingRule(payloadBytes, rules) {
  if (!payloadBytes?.length || !Array.isArray(rules)) return null;
  const indexed = [];
  rules.forEach((rule, index) => {
    if (!rule || rule.enabled === false) return;
    indexed.push({
      rule,
      index,
      priority: Number.isFinite(rule.priority) ? Number(rule.priority) : 100,
    });
  });
  indexed.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.index - b.index;
  });
  for (const { rule } of indexed) {
    if (rule.match && evaluateConditionGroup(payloadBytes, rule.match)) return rule;
  }
  return null;
}

/**
 * Preview extract slots: raw bit value + mapped (palette index or curve output).
 * @param {number[]} payloadBytes
 * @param {object[]} extracts
 * @returns {{ name: string, raw: number, mapped: number|null, paletteIndex?: number, rgb?: [number,number,number]|null, target: object }[]}
 */
export function previewExtracts(payloadBytes, extracts, colors) {
  if (!Array.isArray(extracts)) return [];
  return extracts.map((ex) => {
    const name = ex?.name || '';
    const offset = Number(ex?.offset ?? 0);
    const bitStart = Number(ex?.bitStart ?? 0);
    const bitCount = Number(ex?.bitCount ?? 8);
    const raw = extractBits(payloadBytes, offset, bitStart, bitCount);
    const target = ex?.target && typeof ex.target === 'object' ? ex.target : {};
    let mapped = raw;
    let paletteIndex;
    let rgb = null;

    if (ex?.paletteMap) {
      paletteIndex = raw & 0x1f;
      mapped = paletteIndex;
      if (Array.isArray(colors) && colors[paletteIndex]) {
        const hex = colors[paletteIndex];
        if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
          rgb = [
            parseInt(hex.slice(1, 3), 16),
            parseInt(hex.slice(3, 5), 16),
            parseInt(hex.slice(5, 7), 16),
          ];
        }
      }
    } else if (ex?.curve && typeof ex.curve === 'object') {
      mapped = applyCurve(raw, ex.curve);
    }

    return { name, raw, mapped, paletteIndex, rgb, target };
  });
}

/**
 * Match one or more packets against rules for live preview.
 * @param {string|number[]} hexOrBytes
 * @param {object[]} rules
 * @param {{ colors?: string[], extractFromRule?: object|null, matchAllRules?: boolean }} [opts]
 */
export function previewPacketAgainstRules(hexOrBytes, rules, opts = {}) {
  const bytes = disneyPayload(
    typeof hexOrBytes === 'string' ? hexToBytes(hexOrBytes) : Array.from(hexOrBytes || []),
  );
  const hex = bytesToHex(bytes);
  const matching = [];
  if (opts.matchAllRules) {
    (rules || []).forEach((rule, index) => {
      if (!rule || rule.enabled === false) return;
      if (rule.match && evaluateConditionGroup(bytes, rule.match)) {
        matching.push({ rule, index });
      }
    });
  }
  const first = findMatchingRule(bytes, rules || []);
  const extractRule = opts.extractFromRule || first;
  const extracts = extractRule
    ? previewExtracts(bytes, extractRule.extract || [], opts.colors)
    : [];
  return {
    hex,
    bytes,
    matched: !!first,
    matchedRule: first,
    matchingRules: matching.length
      ? matching
      : first
        ? [{ rule: first, index: (rules || []).indexOf(first) }]
        : [],
    extracts,
  };
}
