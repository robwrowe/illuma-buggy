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
    const raw = extractBits(
      payloadBytes,
      Number(ch.offset ?? 0),
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
  const raw = extractBits(
    payloadBytes,
    Number(srcObj.offset ?? 0),
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
    const bitCount = Number(ratioObj.bitCount ?? 8);
    const raw = extractBits(
      payloadBytes,
      Number(ratioObj.offset ?? 0),
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
  const segName = (id) => {
    const s = segs.find((x) => x.id === id);
    return s ? `${s.id} (${s.start}-${s.stop})` : id || '(no seg)';
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
      return `maskColor ${mask} → ${hits.map((s) => s.id).join(', ')}`;
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
  const offset = Number(timing.offset ?? 5);
  const bytes = Array.isArray(payloadBytes) ? payloadBytes : [];
  const byte = offset < bytes.length ? bytes[offset] : 0;

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
  const offset = Number(timing.offset ?? 5);
  const bytes = Array.isArray(payloadBytes) ? payloadBytes : [];
  const byte = offset < bytes.length ? bytes[offset] : 0;
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

function previewNamedColorSources(colorSources, payloadBytes, colors) {
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
        bitStart: src.bitStart,
        bitCount: src.bitCount,
        paletteMap: true,
      }, payloadBytes, colors);
    }
  });
  return map;
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
      const offset = Number(ex?.offset ?? 0);
      const bitStart = Number(ex?.bitStart ?? 0);
      const bitCount = Number(ex?.bitCount ?? 8);
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
  let timing = null;
  if (extractRule?.timing?.enabled && bytes.length > Number(extractRule.timing.offset ?? 0)) {
    const offset = Number(extractRule.timing.offset ?? 0);
    const timingModels = Array.isArray(opts.timingModels) ? opts.timingModels : [];
    const model = extractRule.timing.timingModelId
      ? timingModels.find((m) => m.id === extractRule.timing.timingModelId) || null
      : null;
    timing = computeTimingLifecycle(bytes[offset], extractRule.timing.cooldownSec ?? 2, model);
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
    timing,
    segmentMap,
  };
}
