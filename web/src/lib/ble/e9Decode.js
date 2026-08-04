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

/** E9 opcode from Disney payload (mirrors app/src/utils/e9Parser.ts). */
export function extractE9Opcode(payload) {
  const p = Array.from(payload || []);
  if (p.length >= 4 && (p[0] === 0xe1 || p[0] === 0xe2) && p[2] === 0xe9) {
    return (p[2] << 8) | p[3];
  }
  if (p.length >= 2 && p[0] === 0xe9) return (p[0] << 8) | p[1];
  return null;
}

export function opcodeToHex(op) {
  if (op == null || Number.isNaN(op)) return '';
  return Number(op).toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Display opcode from a hex packet (optional 8301 CID OK).
 * Strips 8301, then reads E9 (incl. E1/E2 wrap), CD##, or CF##.
 * e.g. 8301cd07… → CD07, 8301e200e905… → E905.
 */
export function deriveOpcodeFromHex(hex) {
  const payload = disneyPayload(hexToBytes(hex));
  if (payload.length < 2) return '';
  const e9 = extractE9Opcode(payload);
  if (e9 != null) return opcodeToHex(e9);
  if (payload[0] === 0xcd || payload[0] === 0xcf) {
    return opcodeToHex((payload[0] << 8) | payload[1]);
  }
  return '';
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

/** Matches firmware scale6To8 (bit-replicate 6→8). */
export function scale6To8(v) {
  const n = (Number(v) || 0) & 0x3f;
  return ((n << 2) | (n >> 4)) & 0xff;
}

/**
 * WLED Chase (fx=28 / FX_MODE_CHASE_COLOR) cycle → sx.
 * FX.cpp: counter = now * ((sx>>2)+1); full lap when counter += 65536
 *   → T_ms = 65536 / ((sx>>2)+1)
 * Inverse: sx = round(4 * (65536/T_ms - 1)), clamped 0–255.
 * Use Disney on_time_ms as T_ms so one chase lap matches wand on-time (step ≈ on/5).
 * @param {number} cycleMs
 * @returns {number} sx 0–255
 */
export function chaseSxFromCycleMs(cycleMs) {
  const ms = Number(cycleMs);
  if (!Number.isFinite(ms) || ms <= 0) return 255;
  let rate = 65536 / ms;
  if (rate < 1) rate = 1;
  if (rate > 64) rate = 64;
  return Math.max(0, Math.min(255, Math.round((rate - 1) * 4)));
}

/** Build per-tval speedBuckets for E9 0C chase (maskBits = tval nibble). */
export function e90cChaseSpeedBuckets(mult = 1.5) {
  const m = Number(mult);
  const buckets = [];
  for (let t = 1; t <= 15; t++) {
    buckets.push({ maxByte: t, value: chaseSxFromCycleMs(m * t * 1000) });
  }
  return {
    enabled: true,
    field: 'sx',
    maskBits: { bitStart: 0, bitCount: 4 },
    buckets,
  };
}

function hexToRgb(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function previewChannelGroupRgb(channelGroup, payloadBytes) {
  if (!channelGroup || typeof channelGroup !== 'object') return [0, 0, 0];
  const scale = channelGroup.scale || 'bitReplicate6to8';
  const one = (key) => {
    const ch = channelGroup[key] || {};
    const offset = resolveOffsetOrAnchor(payloadBytes, ch, 0);
    if (offset < 0) {
      const fb = tryFallbackColor(ch);
      if (fb) {
        if (key === 'r') return fb[0];
        if (key === 'g') return fb[1];
        return fb[2];
      }
    }
    const raw = offset < 0
      ? fallbackValueOrZero(ch)
      : extractBits(
        payloadBytes,
        offset,
        Number(ch.bitStart ?? (scale === 'direct8' ? 0 : 1)),
        Number(ch.bitCount ?? (scale === 'direct8' ? 8 : 6)),
      );
    if (scale === 'bitReplicate6to8') return scale6To8(raw);
    return raw & 0xff;
  };
  return [one('r'), one('g'), one('b')];
}

function previewColorSource(srcObj, payloadBytes, colors) {
  if (!srcObj || typeof srcObj !== 'object') return [0, 0, 0];
  if (srcObj.kind === 'fixed') {
    return hexToRgb(srcObj.value) || [0, 0, 0];
  }
  if (srcObj.kind === 'rgb' || srcObj.channelGroup) {
    return previewChannelGroupRgb(srcObj.channelGroup, payloadBytes);
  }
  const offset = resolveOffsetOrAnchor(payloadBytes, srcObj, 0);
  if (offset < 0) {
    const fb = tryFallbackColor(srcObj);
    if (fb) return fb;
  }
  const raw = offset < 0
    ? fallbackValueOrZero(srcObj)
    : extractBits(
      payloadBytes,
      offset,
      Number(srcObj.bitStart ?? 0),
      Number(srcObj.bitCount ?? 8),
    );
  if (srcObj.kind === 'palette' || srcObj.paletteMap !== false) {
    const pal = raw & 0x1f;
    return hexToRgb(Array.isArray(colors) ? colors[pal] : null) || [0, 0, 0];
  }
  return [raw & 0xff, raw & 0xff, raw & 0xff];
}

function previewBlendRatio(ratioObj, payloadBytes) {
  if (!ratioObj || typeof ratioObj !== 'object') return 0.5;
  if (ratioObj.mode === 'extract') {
    const offset = resolveOffsetOrAnchor(payloadBytes, ratioObj, 0);
    const bitCount = Number(ratioObj.bitCount ?? 8);
    const raw = offset < 0
      ? fallbackValueOrZero(ratioObj)
      : extractBits(
        payloadBytes,
        offset,
        Number(ratioObj.bitStart ?? 0),
        bitCount,
      );
    const maxVal = bitCount >= 32 ? 0xffffffff : (1 << bitCount) - 1;
    return maxVal > 0 ? raw / maxVal : 0.5;
  }
  const v = Number(ratioObj.value);
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

/** Resolve speedBuckets table for a timing byte (mirrors firmware). */
export function resolveSpeedBucketValue(model, timingByte) {
  const sb = model?.speedBuckets;
  if (!sb?.enabled || !Array.isArray(sb.buckets) || sb.buckets.length === 0) return null;
  let key = timingByte & 0xff;
  if (sb.maskBits && typeof sb.maskBits === 'object') {
    key = extractBits([timingByte & 0xff], 0, Number(sb.maskBits.bitStart ?? 0), Number(sb.maskBits.bitCount ?? 8));
  }
  let chosen = null;
  let chosenMax = 256;
  let fallback = null;
  let fallbackMax = -1;
  for (const b of sb.buckets) {
    if (!b || typeof b !== 'object') continue;
    const maxByte = Number.isFinite(b.maxByte) ? Number(b.maxByte) : 255;
    if (maxByte > fallbackMax) {
      fallbackMax = maxByte;
      fallback = b;
    }
    if (key <= maxByte && maxByte < chosenMax) {
      chosenMax = maxByte;
      chosen = b;
    }
  }
  const pick = chosen || fallback;
  if (!pick) return null;
  return {
    field: typeof sb.field === 'string' && sb.field ? sb.field : 'sx',
    value: Number.isFinite(pick.value) ? Number(pick.value) : 128,
    key,
  };
}

/**
 * @param {number} rawValue
 * @param {{ type?: string, inMin?: number, inMax?: number, outMin?: number, outMax?: number, exponent?: number, outScale?: number }} curve
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

  if (curve.type === 'reciprocal') {
    // rawValue is a rate/frequency (e.g. Hz); inMin/inMax clamp it.
    // out = outMax - outScale/hz  (WLED Strobe: sx = 255 - 50/hz when outScale=50).
    const hz = v;
    if (hz <= 0.01) return outMax;
    let outScale = Number(curve.outScale ?? 50);
    if (!(outScale > 0)) outScale = 50;
    let out = outMax - outScale / hz;
    if (out < outMin) out = outMin;
    if (out > outMax) out = outMax;
    return out;
  }

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
    case 'neq': return lhs !== rhs;
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
 * Mirrors firmware resolveAnchorOffset(). Returns -1 if not found.
 * @param {number[]} payloadBytes
 * @param {object} anchor
 */
export function resolveAnchorOffset(payloadBytes, anchor) {
  if (!anchor || !payloadBytes) return -1;
  const hex = String(anchor.byte || '').replace(/[^0-9a-fA-F]/g, '');
  if (hex.length < 2) return -1;
  const target = parseInt(hex.slice(0, 2), 16) & 0xff;

  const occurrence = Math.max(1, Number(anchor.occurrence ?? 1));
  const start = Math.min(Math.max(0, Number(anchor.searchFrom ?? 0)), payloadBytes.length);
  const searchLen = Number(anchor.searchLen ?? 0);
  const end = searchLen > 0 ? Math.min(payloadBytes.length, start + searchLen) : payloadBytes.length;

  let count = 0;
  for (let i = start; i < end; i++) {
    if ((payloadBytes[i] & 0xff) === target) {
      count++;
      if (count === occurrence) {
        const result = i + Number(anchor.deltaBytes ?? 0);
        if (result < 0 || result >= payloadBytes.length) return -1;
        return result;
      }
    }
  }
  return -1;
}

/**
 * Mirrors firmware resolveOffsetOrAnchor(). Returns -1 if an anchor is present but
 * not found; otherwise returns node.offset ?? fallbackOffset.
 * @param {number[]} payloadBytes
 * @param {object} node
 * @param {number} fallbackOffset
 */
export function resolveOffsetOrAnchor(payloadBytes, node, fallbackOffset) {
  if (node?.anchor) {
    return resolveAnchorOffset(payloadBytes, node.anchor);
  }
  return Number(node?.offset ?? fallbackOffset);
}

export function fallbackValueOrZero(node) {
  if (isFallbackColorValue(node?.fallbackValue)) return 0;
  const n = Number(node?.fallbackValue);
  return Number.isFinite(n) ? Math.max(0, Math.min(255, Math.round(n))) : 0;
}

function isFallbackColorValue(value) {
  return typeof value === 'string' && /^#?[0-9a-fA-F]{6}$/.test(value.trim());
}

function tryFallbackColor(node) {
  if (!isFallbackColorValue(node?.fallbackValue)) return null;
  return hexToRgb(node.fallbackValue.startsWith('#') ? node.fallbackValue : `#${node.fallbackValue}`);
}

function nodeRequiresUnresolvedAnchor(payloadBytes, node) {
  if (!node?.requireAnchor || !node?.anchor) return false;
  return resolveAnchorOffset(payloadBytes, node.anchor) < 0;
}

function channelGroupRequiresUnresolvedAnchor(payloadBytes, channelGroup) {
  if (!channelGroup || typeof channelGroup !== 'object') return false;
  return ['r', 'g', 'b'].some((key) => nodeRequiresUnresolvedAnchor(payloadBytes, channelGroup[key]));
}

/** Mirrors firmware ruleRequiredAnchorsOk — false when a requireAnchor marker is missing. */
export function ruleRequiredAnchorsOk(rule, payloadBytes) {
  if (!rule) return true;
  const colorSources = Array.isArray(rule.colorSources) ? rule.colorSources : [];
  for (const src of colorSources) {
    if (nodeRequiresUnresolvedAnchor(payloadBytes, src)) return false;
    if (channelGroupRequiresUnresolvedAnchor(payloadBytes, src?.channelGroup)) return false;
  }
  const extracts = Array.isArray(rule.extract) ? rule.extract : [];
  for (const ex of extracts) {
    if (nodeRequiresUnresolvedAnchor(payloadBytes, ex)) return false;
    if (channelGroupRequiresUnresolvedAnchor(payloadBytes, ex?.channelGroup)) return false;
    const blend = ex?.colorBlend;
    if (blend && typeof blend === 'object') {
      if (nodeRequiresUnresolvedAnchor(payloadBytes, blend.a)) return false;
      if (nodeRequiresUnresolvedAnchor(payloadBytes, blend.b)) return false;
      if (channelGroupRequiresUnresolvedAnchor(payloadBytes, blend.a?.channelGroup)) return false;
      if (channelGroupRequiresUnresolvedAnchor(payloadBytes, blend.b?.channelGroup)) return false;
      if (blend.ratio?.mode === 'extract' && nodeRequiresUnresolvedAnchor(payloadBytes, blend.ratio)) {
        return false;
      }
    }
  }
  if (rule.timing?.enabled && nodeRequiresUnresolvedAnchor(payloadBytes, rule.timing)) return false;
  return true;
}

/** Display label for an offset or anchor-relative node (extract / leaf / channel). */
export function formatOffsetOrAnchorLabel(node) {
  if (node?.anchor) {
    const a = node.anchor;
    const delta = Number(a.deltaBytes ?? 0);
    const deltaStr = delta ? (delta > 0 ? `+${delta}` : String(delta)) : '';
    return `anchor 0x${a.byte}×${a.occurrence ?? 1}${deltaStr}`;
  }
  return `off ${node?.offset ?? 0}`;
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
    const offset = resolveOffsetOrAnchor(payloadBytes, leaf, 0);
    if (offset < 0) return false;
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
    const offset = resolveOffsetOrAnchor(payloadBytes, leaf, 0);
    if (offset < 0) return false;
    const bitStart = Number(leaf.bitStart ?? 0);
    const bitCount = Number(leaf.bitCount ?? 1);
    const v = extractBits(payloadBytes, offset, bitStart, bitCount);
    return compareOp(v, leaf.op || 'eq', Number(leaf.value ?? 0));
  }
  if (type === 'byteCompare') {
    const left = leaf.left || {};
    const right = leaf.right || {};
    const leftOff = resolveOffsetOrAnchor(payloadBytes, left, 0);
    const rightOff = resolveOffsetOrAnchor(payloadBytes, right, 0);
    if (leftOff < 0 || rightOff < 0) return false;
    const lv = extractBits(payloadBytes, leftOff, Number(left.bitStart ?? 0), Number(left.bitCount ?? 8));
    const rv = extractBits(payloadBytes, rightOff, Number(right.bitStart ?? 0), Number(right.bitCount ?? 8));
    return compareOp(lv, leaf.op || 'eq', rv);
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
    if (!rule.match || !evaluateConditionGroup(payloadBytes, rule.match)) continue;
    if (!ruleRequiredAnchorsOk(rule, payloadBytes)) continue;
    return rule;
  }
  return null;
}

/**
 * True when an exclusive active rule should suppress applying `candidate`
 * (different rule id). Exact re-match of the active rule is never blocked.
 * @param {object|null} activeRule
 * @param {object} candidate
 * @param {string} phase  firmware-style phase name, or any non-'idle'
 */
export function exclusiveActiveBlocksRule(activeRule, candidate, phase = 'on') {
  if (!activeRule || !candidate) return false;
  if (!phase || phase === 'idle' || phase === 'IDLE') return false;
  const activeId = activeRule.id || '';
  const candId = candidate.id || '';
  if (activeId && candId && activeId === candId) return false;
  if (activeRule.ignoreAllOtherRules) return true;
  if (activeRule.ignoreLowerPriority) {
    const ap = Number.isFinite(activeRule.priority) ? Number(activeRule.priority) : 100;
    const cp = Number.isFinite(candidate.priority) ? Number(candidate.priority) : 100;
    if (cp > ap) return true;
  }
  return false;
}

/**
 * Lab-confirmed timing byte decode (docs/ble-packets-details/timing-byte.md).
 * bits[3:0]=t, bit6=scaler, bit7=extended (misnamed "always-on"), bits[5:4]=fadeBits.
 * @param {number} byte
 */
export function decodeTimingByte(byte) {
  const b = Number(byte) & 0xff;
  const t = b & 0x0f;
  const fadeBits = (b >> 4) & 0x03;
  const scaler = (b & 0x40) !== 0;
  const extended = (b & 0x80) !== 0;
  return { raw: b, t, fadeBits, scaler, extended };
}

/** E905 fade-out seconds by fadeBits when no timing-model stretch table is active. */
export const TIMING_FADE_BITS_SEC = [0, 0.5, 1.0, 1.5];

/**
 * @param {number} fadeBits
 * @param {object|null} [model]
 */
export function fadeBitsToFadeSec(fadeBits, model = null) {
  const arr = model?.fadeBitsStretchSec;
  if (Array.isArray(arr) && arr.some((x) => Number(x) > 0)) {
    return Number(arr[fadeBits & 3]) || 0;
  }
  return TIMING_FADE_BITS_SEC[fadeBits & 3] ?? 0;
}

/** @param {object} fields */
export function encodeTimingByte({ t, fadeBits, scaler, extended }) {
  let b = Number(t) & 0x0f;
  b |= (Number(fadeBits) & 0x03) << 4;
  if (scaler) b |= 0x40;
  if (extended) b |= 0x80;
  return b & 0xff;
}

/**
 * Human-friendly timing fields for Wand Lab byte editing (default E905 model).
 * @param {number} byte
 * @param {object|null} [model]
 */
export function timingByteToEditFields(byte, model = null) {
  const decoded = decodeTimingByte(byte);
  const life = computeTimingLifecycle(byte, 2, model);
  return {
    onSec: Math.round(life.onSec * 100) / 100,
    fadeSec: fadeBitsToFadeSec(decoded.fadeBits, model),
    scaler: decoded.scaler,
    extended: decoded.extended,
    t: decoded.t,
    fadeBits: decoded.fadeBits,
  };
}

/**
 * Encode timing byte from on-time, fade, and scaler flags.
 * @param {{ onSec: number, fadeSec: number, scaler: boolean, extended: boolean }} fields
 * @param {object|null} [model]
 */
export function timingByteFromEditFields(fields, model = null) {
  const multNormal = Number.isFinite(model?.multNormal) ? Number(model.multNormal) : 1.6;
  const multScaler = Number.isFinite(model?.multScaler) ? Number(model.multScaler) : 3.0;
  const multExtended = Number.isFinite(model?.multExtended) ? Number(model.multExtended) : 7.6;
  const t0Fallback = Number.isFinite(model?.t0FallbackSec) ? Number(model.t0FallbackSec) : 3.0;
  const scaler = !!fields.scaler;
  const extended = !!fields.extended;
  const mult = extended ? multExtended : (scaler ? multScaler : multNormal);

  const fadeOpts = (Array.isArray(model?.fadeBitsStretchSec) && model.fadeBitsStretchSec.some((x) => Number(x) > 0))
    ? model.fadeBitsStretchSec
    : TIMING_FADE_BITS_SEC;
  let fadeBits = 0;
  let bestDiff = Infinity;
  const targetFade = Number(fields.fadeSec) || 0;
  for (let i = 0; i < 4; i++) {
    const diff = Math.abs((Number(fadeOpts[i]) || 0) - targetFade);
    if (diff < bestDiff) {
      bestDiff = diff;
      fadeBits = i;
    }
  }

  const onSec = Math.max(0, Number(fields.onSec) || 0);
  let t;
  if (onSec <= 0) {
    t = 0;
  } else {
    const tRounded = Math.max(0, Math.min(15, Math.round(onSec / mult)));
    const onFromRounded = tRounded === 0 ? t0Fallback : mult * tRounded;
    const onFromZero = t0Fallback;
    t = Math.abs(onSec - onFromZero) < Math.abs(onSec - onFromRounded) ? 0 : tRounded;
  }

  return encodeTimingByte({ t, fadeBits, scaler, extended });
}

/** WLED Strobe: cycleTime_ms = (255 - sx) * 20 → sx = 255 - 50 / flashRateHz. */
export function strobeSxFromFlashRateHz(flashRateHz) {
  const hz = Number(flashRateHz);
  if (!Number.isFinite(hz) || hz <= 0) return 128;
  const sx = Math.round(255 - 50 / hz);
  return Math.min(255, Math.max(0, sx));
}

/**
 * On / stretch / cooldown lifecycle from a timing byte + optional timing model + rule cooldownSec.
 * When model is null/undefined, uses the same hardcoded defaults as firmware Config.h
 * (no final-cycle stretch — stretch is timing-model data, lab-confirmed on E9 0E).
 * @param {number} byte
 * @param {number} [cooldownSec=2]
 * @param {object|null} [model] normalized timing model (or null for firmware defaults)
 */
export function computeTimingLifecycle(byte, cooldownSec = 2, model = null) {
  const decoded = decodeTimingByte(byte);
  const { t, fadeBits, scaler, extended } = decoded;
  const m = model && typeof model === 'object' ? model : null;
  const multNormal = Number.isFinite(m?.multNormal) ? Number(m.multNormal) : 1.6;
  const multScaler = Number.isFinite(m?.multScaler) ? Number(m.multScaler) : 3.0;
  const multExtended = Number.isFinite(m?.multExtended) ? Number(m.multExtended) : 7.6;
  const t0Fallback = Number.isFinite(m?.t0FallbackSec) ? Number(m.t0FallbackSec) : 3.0;
  const fadeCurve = m?.fadeCurve === 'decelerating' ? 'decelerating' : 'linear';

  // fadeBits stretches the final flash cycle — stretchSec is extra length of that one
  // cycle over a normal cycle, not a separate fade phase after on-time.
  const stretchArr = Array.isArray(m?.fadeBitsStretchSec) ? m.fadeBitsStretchSec : [0, 0, 0, 0];
  const stretchAppliesToExtended = !!m?.fadeBitsStretchAppliesToExtended;
  const rawStretch = Number.isFinite(stretchArr[fadeBits]) ? Number(stretchArr[fadeBits]) : 0;
  const stretchSec = (extended && !stretchAppliesToExtended) ? 0 : Math.max(0, rawStretch);

  let onSec;
  if (extended) onSec = t === 0 ? t0Fallback : multExtended * t;
  else if (scaler) onSec = t === 0 ? t0Fallback : multScaler * t;
  else onSec = t === 0 ? t0Fallback : multNormal * t;
  onSec += stretchSec;

  const cooldown = Number.isFinite(cooldownSec) ? Math.max(0, Number(cooldownSec)) : 2;

  let strobe = null;
  let speedBucket = null;
  const bucket = resolveSpeedBucketValue(m, byte);
  if (bucket) {
    speedBucket = bucket;
  } else {
    const se = m?.strobeEffect;
    if (se?.enabled) {
      let hz = se.flashRateNormalHz ?? 2;
      if (extended) hz = se.flashRateExtendedHz ?? 0.35;
      else if (scaler) hz = se.flashRateScalerHz ?? 1;
      strobe = {
        fx: Number.isFinite(se.fx) ? se.fx : 23,
        sx: strobeSxFromFlashRateHz(hz),
        flashRateHz: hz,
      };
    }
  }

  return {
    ...decoded,
    onSec,
    stretchSec,
    /** @deprecated Alias of stretchSec — fade is folded into onSec. */
    fadeSec: stretchSec,
    fadeCurve,
    cooldownSec: cooldown,
    // Fade is inside onSec (final-cycle stretch); do not add a separate fade phase.
    totalSec: onSec + cooldown,
    strobe,
    speedBucket,
  };
}

/**
 * Human-readable label for one extract target (preview / UI).
 * @param {object} target
 * @param {{ segments?: object[] }} [segmentMap]
 */
export function formatExtractTargetLabel(target, segmentMap) {
  if (!target || typeof target !== 'object') return '(none)';
  const segs = Array.isArray(segmentMap?.segments) ? segmentMap.segments : [];
  const displayName = (s) => {
    const name = typeof s?.name === 'string' ? s.name.trim() : '';
    return name || s?.id || '';
  };
  const segName = (id) => {
    const s = segs.find((x) => x.id === id);
    if (!s) return id || '(no seg)';
    const base = displayName(s);
    return Number.isFinite(s.start) && Number.isFinite(s.stop)
      ? `${base} (${s.start}-${s.stop})`
      : base;
  };
  switch (target.kind) {
    case 'segmentColor': {
      const ids = Array.isArray(target.segmentIds) && target.segmentIds.length
        ? target.segmentIds
        : [target.segmentId];
      return `segColor ${ids.map(segName).join('+')} col${target.colorSlot ?? 0}`;
    }
    case 'maskColor': {
      const mask = target.mask || 'all';
      const hits = segs.filter((s) => s.maskAssignment === mask);
      if (!hits.length) return `maskColor ${mask} (no segments)`;
      return `maskColor ${mask} → ${hits.map(displayName).join(', ')}`;
    }
    case 'segmentField':
      return `segField ${segName(target.segmentId)}.${target.field || '?'}`;
    case 'ignore':
      return 'ignore';
    default:
      return target.kind || '?';
  }
}

/**
 * Decoded timing-derived scalar (Hz or seconds) for timing* extract sources.
 * Mirrors firmware resolveTimingDerivedValue.
 * @param {object|null} rule
 * @param {number[]} payloadBytes
 * @param {object[]} [timingModels]
 * @param {string} [source='timingFlashRate']
 * @returns {number}
 */
export function resolveTimingDerivedValue(rule, payloadBytes, timingModels = [], source = 'timingFlashRate') {
  const timing = rule?.timing;
  if (!timing?.enabled) return 0;
  const model = timing.timingModelId
    ? (Array.isArray(timingModels) ? timingModels.find((m) => m.id === timing.timingModelId) : null) || null
    : null;
  const bytes = Array.isArray(payloadBytes) ? payloadBytes : [];
  const offset = resolveOffsetOrAnchor(bytes, timing, 5);
  const byte = offset < 0
    ? fallbackValueOrZero(timing)
    : (offset < bytes.length ? bytes[offset] : 0);

  if (source === 'timingFlashRate') {
    return resolveFlashRateHz(rule, payloadBytes, timingModels);
  }
  if (source === 'timingOnSec' || source === 'timingFadeSec') {
    const life = computeTimingLifecycle(byte, timing.cooldownSec ?? 2, model);
    return source === 'timingOnSec' ? life.onSec : life.stretchSec;
  }
  return 0;
}

/**
 * Decoded flash rate (Hz) from rule timing byte + timing model rates.
 * @param {object|null} rule
 * @param {number[]} payloadBytes
 * @param {object[]} [timingModels]
 * @returns {number}
 */
export function resolveFlashRateHz(rule, payloadBytes, timingModels = []) {
  const timing = rule?.timing;
  if (!timing?.enabled) return 0;
  const model = timing.timingModelId
    ? (Array.isArray(timingModels) ? timingModels.find((m) => m.id === timing.timingModelId) : null) || null
    : null;
  const bytes = Array.isArray(payloadBytes) ? payloadBytes : [];
  const offset = resolveOffsetOrAnchor(bytes, timing, 5);
  const byte = offset < 0
    ? fallbackValueOrZero(timing)
    : (offset < bytes.length ? bytes[offset] : 0);
  const { scaler, extended } = decodeTimingByte(byte);
  const se = model?.strobeEffect;
  let hz = Number.isFinite(se?.flashRateNormalHz) ? Number(se.flashRateNormalHz) : 2;
  if (extended) {
    hz = Number.isFinite(se?.flashRateExtendedHz) ? Number(se.flashRateExtendedHz) : 0.35;
  } else if (scaler) {
    hz = Number.isFinite(se?.flashRateScalerHz) ? Number(se.flashRateScalerHz) : 1;
  }
  return hz;
}

export function previewNamedColorSources(colorSources, payloadBytes, colors) {
  const map = {};
  (colorSources || []).forEach((src) => {
    const name = typeof src?.name === 'string' ? src.name.trim() : '';
    if (!name || map[name]) return;
    if (src.kind === 'fixed') {
      map[name] = hexToRgb(src.value) || [0, 0, 0];
    } else if (src.kind === 'rgb' && src.channelGroup) {
      map[name] = previewChannelGroupRgb(src.channelGroup, payloadBytes);
    } else {
      map[name] = previewColorSource({
        offset: src.offset,
        anchor: src.anchor,
        fallbackValue: src.fallbackValue,
        requireAnchor: src.requireAnchor,
        bitStart: src.bitStart,
        bitCount: src.bitCount,
        paletteMap: true,
      }, payloadBytes, colors);
    }
  });
  return map;
}

/** Named color sources as a list for coverage-preview UI. */
export function previewColorSourcesList(colorSources, payloadBytes, colors) {
  const map = previewNamedColorSources(colorSources, payloadBytes, colors);
  return Object.entries(map).map(([name, rgb]) => ({ name, rgb }));
}

/**
 * Preview extract slots: raw bit value + mapped (palette index or curve output).
 * @param {number[]} payloadBytes
 * @param {object[]} extracts
 * @param {string[]} [colors]
 * @param {object|null} [segmentMap]
 * @param {{ rule?: object|null, timingModels?: object[] }} [opts]
 */
export function previewExtracts(payloadBytes, extracts, colors, segmentMap = null, opts = {}) {
  if (!Array.isArray(extracts)) return [];
  const rule = opts.rule || null;
  const timingModels = Array.isArray(opts.timingModels) ? opts.timingModels : [];
  const namedColors = previewNamedColorSources(rule?.colorSources, payloadBytes, colors);
  return extracts.map((ex) => {
    const name = ex?.name || '';
    const source = ex?.source || 'payloadBits';
    const isTiming = source === 'timingFlashRate' || source === 'timingOnSec' || source === 'timingFadeSec';
    const isColorSourceBlend = source === 'colorSourceBlend';
    const isFixedColor = source === 'fixedColor';
    const targets = Array.isArray(ex?.targets) ? ex.targets : [];
    let raw = 0;
    let derivedValue;
    let mapped;
    let paletteIndex;
    let rgb = null;
    const paletteMap = isTiming || isColorSourceBlend || isFixedColor ? false : !!ex?.paletteMap;
    const hasChannelGroup = !isTiming && !isColorSourceBlend && !isFixedColor
      && ex?.channelGroup && typeof ex.channelGroup === 'object';
    const hasColorBlend = !isTiming && !isColorSourceBlend && !isFixedColor && !hasChannelGroup
      && ex?.colorBlend && typeof ex.colorBlend === 'object';

    if (isTiming) {
      derivedValue = resolveTimingDerivedValue(rule, payloadBytes, timingModels, source);
      raw = derivedValue;
      mapped = derivedValue;
      if (ex?.curve && typeof ex.curve === 'object') {
        mapped = applyCurve(derivedValue, ex.curve);
      }
    } else if (isFixedColor) {
      rgb = hexToRgb(ex.value) || [0, 0, 0];
      mapped = 0;
      raw = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
    } else if (hasChannelGroup) {
      rgb = previewChannelGroupRgb(ex.channelGroup, payloadBytes);
      mapped = 0;
      raw = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
    } else if (hasColorBlend) {
      const a = previewColorSource(ex.colorBlend.a, payloadBytes, colors);
      const b = previewColorSource(ex.colorBlend.b, payloadBytes, colors);
      const ratio = previewBlendRatio(ex.colorBlend.ratio, payloadBytes);
      rgb = [
        Math.round(a[0] + (b[0] - a[0]) * ratio),
        Math.round(a[1] + (b[1] - a[1]) * ratio),
        Math.round(a[2] + (b[2] - a[2]) * ratio),
      ];
      mapped = ratio;
      raw = Math.round(ratio * 1000) / 1000;
    } else if (isColorSourceBlend) {
      const blend = Array.isArray(ex.blend) ? ex.blend : [];
      let sumWeight = blend.reduce((s, e) => s + (Number(e?.weightPct) || 0), 0);
      if (sumWeight <= 0) sumWeight = 100;
      let rf = 0;
      let gf = 0;
      let bf = 0;
      blend.forEach((entry) => {
        const srcRgb = namedColors[entry?.source];
        if (!srcRgb) return;
        const w = (Number(entry.weightPct) || 0) / sumWeight;
        rf += srcRgb[0] * w;
        gf += srcRgb[1] * w;
        bf += srcRgb[2] * w;
      });
      rgb = [Math.round(rf), Math.round(gf), Math.round(bf)];
      mapped = sumWeight;
      raw = Math.round(sumWeight * 10) / 10;
    } else {
      const offset = resolveOffsetOrAnchor(payloadBytes, ex, 0);
      const bitStart = Number(ex?.bitStart ?? 0);
      const bitCount = Number(ex?.bitCount ?? 8);
      if (offset < 0) {
        const fb = tryFallbackColor(ex);
        if (fb) {
          rgb = fb;
          raw = (fb[0] << 16) | (fb[1] << 8) | fb[2];
          mapped = 0;
        } else {
          raw = fallbackValueOrZero(ex);
          mapped = raw;
          if (paletteMap) {
            paletteIndex = raw & 0x1f;
            mapped = paletteIndex;
            rgb = hexToRgb(Array.isArray(colors) ? colors[paletteIndex] : null);
          } else if (ex?.curve && typeof ex.curve === 'object') {
            mapped = applyCurve(raw, ex.curve);
          }
        }
      } else {
        raw = extractBits(payloadBytes, offset, bitStart, bitCount);
        mapped = raw;
        if (paletteMap) {
          paletteIndex = raw & 0x1f;
          mapped = paletteIndex;
          rgb = hexToRgb(Array.isArray(colors) ? colors[paletteIndex] : null);
        } else if (ex?.curve && typeof ex.curve === 'object') {
          mapped = applyCurve(raw, ex.curve);
        }
      }
    }

    const targetLabels = targets.map((t) => formatExtractTargetLabel(t, segmentMap));
    return {
      name,
      source,
      raw,
      mapped,
      ...(derivedValue != null ? { derivedValue, flashRateHz: source === 'timingFlashRate' ? derivedValue : undefined } : {}),
      paletteIndex,
      rgb,
      targets,
      targetLabels,
    };
  });
}

/**
 * Match one or more packets against rules for live preview.
 * @param {string|number[]} hexOrBytes
 * @param {object[]} rules
 * @param {{ colors?: string[], extractFromRule?: object|null, matchAllRules?: boolean, segmentMaps?: object[] }} [opts]
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
  const segmentMaps = Array.isArray(opts.segmentMaps) ? opts.segmentMaps : [];
  const segmentMap = extractRule?.segmentMapId
    ? segmentMaps.find((m) => m.id === extractRule.segmentMapId) || null
    : null;
  const extracts = extractRule
    ? previewExtracts(bytes, extractRule.extract || [], opts.colors, segmentMap, {
      rule: extractRule,
      timingModels: opts.timingModels,
    })
    : [];
  const colorSources = extractRule
    ? previewColorSourcesList(extractRule.colorSources || [], bytes, opts.colors)
    : [];
  let timing = null;
  if (extractRule?.timing?.enabled) {
    const offset = resolveOffsetOrAnchor(bytes, extractRule.timing, 5);
    const timingByte = offset < 0
      ? fallbackValueOrZero(extractRule.timing)
      : (offset < bytes.length ? bytes[offset] : 0);
    const timingModels = Array.isArray(opts.timingModels) ? opts.timingModels : [];
    const model = extractRule.timing.timingModelId
      ? timingModels.find((m) => m.id === extractRule.timing.timingModelId) || null
      : null;
    timing = computeTimingLifecycle(timingByte, extractRule.timing.cooldownSec ?? 2, model);
  }
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
    colorSources,
    timing,
    segmentMap,
  };
}
