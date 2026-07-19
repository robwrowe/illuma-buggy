import { DEFAULT_MB_WLED_COLORS, MB_SEG_KEYS, MB_SEGMENT_META, defaultRandomPaletteIndices, normalizeRandomPool } from './mbConstants';
import { activeSegmentsFromPreset, buildRecalledSegment, formatSegRange } from '../wled/capture';

const BYTE_OPS = new Set(['eq', 'gt', 'gte', 'lt', 'lte', 'maskEq']);
const CMP_OPS = new Set(['eq', 'gt', 'gte', 'lt', 'lte']);
const MB_SEG_KEY_SET = new Set(MB_SEG_KEYS);
const BLEND_MODES = new Set(['normal', 'add']);
const COOLDOWN_RESET_MODES = new Set(['onMatch', 'fixed']);
const START_TRANSITION_TYPES = new Set(['fade', 'instant']);

export function shortRuleId() {
  return `r${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`;
}

export function shortSegmentMapId() {
  return `sm${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`;
}

export function shortSegmentId() {
  return `seg${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`;
}

export function createEmptyMatchGroup(mode = 'all') {
  return { mode: mode === 'some' ? 'some' : 'all', children: [] };
}

export function createEmptyCondition(type = 'hexPrefix') {
  if (type === 'length') return { type: 'length', op: 'eq', value: 0 };
  if (type === 'byte') return { type: 'byte', offset: 0, op: 'eq', value: 0, mask: 0xff };
  if (type === 'bits') return { type: 'bits', offset: 0, bitStart: 0, bitCount: 1, op: 'eq', value: 0 };
  return { type: 'hexPrefix', value: '' };
}

export function createEmptyExtractTarget(kind = 'maskColor') {
  if (kind === 'segmentColor') return { kind: 'segmentColor', segmentId: '', colorSlot: 0 };
  if (kind === 'segmentField') return { kind: 'segmentField', segmentId: '', field: '' };
  if (kind === 'ignore') return { kind: 'ignore' };
  return { kind: 'maskColor', mask: 'all' };
}

export function createEmptyExtract(name = '') {
  return {
    name,
    offset: 0,
    bitStart: 0,
    bitCount: 5,
    paletteMap: true,
    targets: [{ kind: 'maskColor', mask: 'all' }],
  };
}

export function createEmptySegment(overrides = {}) {
  return {
    id: shortSegmentId(),
    wledSegId: 0,
    start: 0,
    stop: 100,
    grp: 1,
    spc: 0,
    of: 0,
    rev: false,
    mi: false,
    blend: 'normal',
    fx: -1,
    sx: 128,
    ix: 128,
    pal: -1,
    presetId: '',
    presetVariables: {},
    colors: ['', '', ''],
    maskAssignment: 'all',
    ...overrides,
  };
}

/** RGB array from WLED `col[i]` → `#rrggbb`, or '' if missing. */
export function rgbArrayToHex(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return '';
  const clamp = (n) => Math.max(0, Math.min(255, Number(n) || 0));
  return `#${[rgb[0], rgb[1], rgb[2]].map((n) => clamp(n).toString(16).padStart(2, '0')).join('')}`;
}

/** Map a live WLED segment (from fetchWledSegmentsFromIp) into a segment-map entry. */
export function wledSegmentToSegmentMapSegment(raw) {
  const colSrc = Array.isArray(raw?.col) ? raw.col : [];
  return createEmptySegment({
    wledSegId: Number(raw?.id ?? 0),
    start: Number(raw?.start ?? 0),
    stop: Number(raw?.stop ?? 0),
    grp: raw?.grp ?? 1,
    spc: raw?.spc ?? 0,
    of: raw?.of ?? 0,
    rev: !!raw?.rev,
    mi: !!raw?.mi,
    blend: raw?.bm === 1 ? 'add' : 'normal',
    fx: raw?.fx ?? -1,
    pal: raw?.pal ?? -1,
    sx: raw?.sx ?? 128,
    ix: raw?.ix ?? 128,
    colors: [0, 1, 2].map((i) => rgbArrayToHex(colSrc[i])),
  });
}

/**
 * Merge imported WLED segments into a map: update by wledSegId (preserve mask/preset
 * fields), append new ones. Returns { segments, updated, added }.
 */
export function mergeImportedSegmentsIntoMap(existingSegments, importedSegments) {
  const merged = [...(existingSegments || [])];
  let updated = 0;
  let added = 0;
  (importedSegments || []).forEach((seg) => {
    const idx = merged.findIndex((s) => s.wledSegId === seg.wledSegId);
    if (idx >= 0) {
      merged[idx] = {
        ...merged[idx],
        ...seg,
        id: merged[idx].id,
        maskAssignment: merged[idx].maskAssignment,
        presetId: merged[idx].presetId,
        presetVariables: merged[idx].presetVariables,
      };
      updated += 1;
    } else {
      merged.push(seg);
      added += 1;
    }
  });
  return { segments: merged, updated, added };
}

export function createEmptySegmentMap(overrides = {}) {
  return {
    id: shortSegmentMapId(),
    name: 'New segment map',
    segments: [createEmptySegment()],
    ...overrides,
  };
}

export function createEmptyRuleTiming() {
  return {
    enabled: false,
    offset: 5,
    cooldownSec: 10,
    cooldownResetMode: 'onMatch',
  };
}

export function createEmptyStartTransition() {
  return { type: 'fade', timeMs: 400 };
}

export function createEmptyRule(overrides = {}) {
  return {
    id: shortRuleId(),
    name: 'New rule',
    enabled: true,
    priority: 0,
    match: createEmptyMatchGroup('all'),
    extract: [],
    presetId: '',
    segmentMapId: '',
    timing: createEmptyRuleTiming(),
    startTransition: createEmptyStartTransition(),
    ...overrides,
  };
}

export const DEFAULT_MB_MAPPING = {
  version: 1,
  rules: [],
  segmentMaps: [],
  defaultPresetId: '',
  colors: [...DEFAULT_MB_WLED_COLORS],
  randomPool: {
    paletteIndices: defaultRandomPaletteIndices(),
    custom: [],
  },
  segments: {
    all: [{ id: 0, start: 0, stop: 100 }],
    inner: [{ id: 1, start: 35, stop: 65 }],
    outer: [{ id: 2, start: 0, stop: 35 }, { id: 3, start: 65, stop: 100 }],
    topLeft: [{ id: 4, start: 0, stop: 25 }],
    topRight: [{ id: 5, start: 25, stop: 50 }],
    bottomLeft: [{ id: 6, start: 50, stop: 75 }],
    bottomRight: [{ id: 7, start: 75, stop: 100 }],
    center: [{ id: 8, start: 48, stop: 52 }],
    band0: [{ id: 9, start: 0, stop: 20 }],
    band1: [{ id: 10, start: 20, stop: 40 }],
    band2: [{ id: 11, start: 40, stop: 60 }],
    band3: [{ id: 12, start: 60, stop: 80 }],
    band4: [{ id: 13, start: 80, stop: 100 }],
    band5: [{ id: 14, start: 80, stop: 87 }],
    band6: [{ id: 15, start: 87, stop: 94 }],
    band7: [{ id: 16, start: 94, stop: 100 }],
  },
  paradeDetection: {
    enabled: true,
    beaconOpcodeHexPrefix: 'cd07',
    rssiThreshold: -70,
    cooldownSec: 30,
  },
};

export function normalizeParadeDetection(raw) {
  const d = DEFAULT_MB_MAPPING.paradeDetection;
  const prefix = typeof raw?.beaconOpcodeHexPrefix === 'string'
    ? raw.beaconOpcodeHexPrefix.trim().toLowerCase()
    : d.beaconOpcodeHexPrefix;
  return {
    enabled: raw?.enabled !== undefined ? !!raw.enabled : d.enabled,
    beaconOpcodeHexPrefix: prefix || d.beaconOpcodeHexPrefix,
    rssiThreshold: Number.isFinite(raw?.rssiThreshold) ? Number(raw.rssiThreshold) : d.rssiThreshold,
    cooldownSec: Number.isFinite(raw?.cooldownSec) ? Math.max(1, Number(raw.cooldownSec)) : d.cooldownSec,
  };
}

export function findMbSegIdConflicts(mapping) {
  const seen = new Map();
  const conflicts = [];
  Object.entries(mapping?.segments || {}).forEach(([region, refs]) => {
    (refs || []).forEach(ref => {
      const key = Number(ref.id ?? -1);
      const range = formatSegRange(ref);
      if (!seen.has(key)) {
        seen.set(key, { region, range });
        return;
      }
      const prior = seen.get(key);
      if (prior.range !== range) {
        conflicts.push({
          id: key,
          a: `${prior.region}: ${prior.range}`,
          b: `${region}: ${range}`,
        });
      }
    });
  });
  return conflicts;
}

function normalizeCurve(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type === 'exponential' ? 'exponential' : 'linear';
  return {
    type,
    inMin: Number.isFinite(raw.inMin) ? Number(raw.inMin) : 0,
    inMax: Number.isFinite(raw.inMax) ? Number(raw.inMax) : 15,
    outMin: Number.isFinite(raw.outMin) ? Number(raw.outMin) : 0,
    outMax: Number.isFinite(raw.outMax) ? Number(raw.outMax) : 255,
    exponent: Number.isFinite(raw.exponent) ? Number(raw.exponent) : 2,
  };
}

function normalizeHexOrEmpty(raw) {
  if (typeof raw !== 'string') return '';
  const v = raw.trim();
  if (!v) return '';
  const hex = v.startsWith('#') ? v : `#${v}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : '';
}

export function normalizeExtractTarget(raw) {
  if (!raw || typeof raw !== 'object') return createEmptyExtractTarget('maskColor');
  const kind = raw.kind;
  if (kind === 'segmentColor') {
    const slot = Number(raw.colorSlot);
    return {
      kind: 'segmentColor',
      segmentId: typeof raw.segmentId === 'string' ? raw.segmentId : '',
      colorSlot: slot === 1 || slot === 2 ? slot : 0,
    };
  }
  if (kind === 'maskColor') {
    const mask = typeof raw.mask === 'string' && MB_SEG_KEY_SET.has(raw.mask) ? raw.mask : 'all';
    return { kind: 'maskColor', mask };
  }
  if (kind === 'segmentField') {
    return {
      kind: 'segmentField',
      segmentId: typeof raw.segmentId === 'string' ? raw.segmentId : '',
      field: typeof raw.field === 'string' ? raw.field : '',
    };
  }
  if (kind === 'ignore') return { kind: 'ignore' };
  return createEmptyExtractTarget('maskColor');
}

export function normalizeExtract(raw) {
  if (!raw || typeof raw !== 'object') return createEmptyExtract();
  const paletteMap = !!raw.paletteMap;
  const curve = paletteMap ? null : normalizeCurve(raw.curve);
  // Legacy single `target` is ignored (no migration) — prefer `targets[]`.
  const targets = Array.isArray(raw.targets)
    ? raw.targets.map(normalizeExtractTarget)
    : [createEmptyExtractTarget('maskColor')];
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    offset: Number.isFinite(raw.offset) ? Math.max(0, Number(raw.offset)) : 0,
    bitStart: Number.isFinite(raw.bitStart) ? Math.min(7, Math.max(0, Number(raw.bitStart))) : 0,
    bitCount: Number.isFinite(raw.bitCount) ? Math.min(32, Math.max(1, Number(raw.bitCount))) : 8,
    paletteMap,
    ...(curve ? { curve } : {}),
    targets,
  };
}

export function normalizeConditionNode(raw) {
  if (!raw || typeof raw !== 'object') return createEmptyCondition('hexPrefix');

  if (raw.type) {
    const type = raw.type;
    if (type === 'hexPrefix') {
      return { type: 'hexPrefix', value: typeof raw.value === 'string' ? raw.value.replace(/[^0-9a-fA-F]/g, '') : '' };
    }
    if (type === 'length') {
      const op = CMP_OPS.has(raw.op) ? raw.op : 'eq';
      return { type: 'length', op, value: Number.isFinite(raw.value) ? Number(raw.value) : 0 };
    }
    if (type === 'byte') {
      const op = BYTE_OPS.has(raw.op) ? raw.op : 'eq';
      return {
        type: 'byte',
        offset: Number.isFinite(raw.offset) ? Math.max(0, Number(raw.offset)) : 0,
        op,
        value: Number.isFinite(raw.value) ? Number(raw.value) : 0,
        mask: Number.isFinite(raw.mask) ? Number(raw.mask) & 0xff : 0xff,
      };
    }
    if (type === 'bits') {
      const op = CMP_OPS.has(raw.op) ? raw.op : 'eq';
      return {
        type: 'bits',
        offset: Number.isFinite(raw.offset) ? Math.max(0, Number(raw.offset)) : 0,
        bitStart: Number.isFinite(raw.bitStart) ? Math.min(7, Math.max(0, Number(raw.bitStart))) : 0,
        bitCount: Number.isFinite(raw.bitCount) ? Math.min(32, Math.max(1, Number(raw.bitCount))) : 1,
        op,
        value: Number.isFinite(raw.value) ? Number(raw.value) : 0,
      };
    }
    return createEmptyCondition('hexPrefix');
  }

  const mode = raw.mode === 'some' ? 'some' : 'all';
  const children = Array.isArray(raw.children)
    ? raw.children.map(normalizeConditionNode)
    : [];
  return { mode, children };
}

export function normalizePresetVariables(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (typeof key !== 'string' || !key.trim()) return;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key.trim()] = value;
    } else if (value == null) {
      out[key.trim()] = '';
    } else {
      out[key.trim()] = String(value);
    }
  });
  return out;
}

export function normalizeSegment(raw) {
  const d = createEmptySegment();
  if (!raw || typeof raw !== 'object') return d;
  const maskRaw = typeof raw.maskAssignment === 'string' ? raw.maskAssignment : d.maskAssignment;
  const maskAssignment = maskRaw === 'ignore' || MB_SEG_KEY_SET.has(maskRaw) ? maskRaw : 'all';
  const colorsSrc = Array.isArray(raw.colors) ? raw.colors : [];
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : shortSegmentId(),
    wledSegId: Number.isFinite(raw.wledSegId) ? Math.max(0, Number(raw.wledSegId)) : d.wledSegId,
    start: Number.isFinite(raw.start) ? Math.max(0, Number(raw.start)) : d.start,
    stop: Number.isFinite(raw.stop) ? Math.max(0, Number(raw.stop)) : d.stop,
    grp: Number.isFinite(raw.grp) ? Math.max(1, Number(raw.grp)) : d.grp,
    spc: Number.isFinite(raw.spc) ? Math.max(0, Number(raw.spc)) : d.spc,
    of: Number.isFinite(raw.of) ? Number(raw.of) : d.of,
    rev: !!raw.rev,
    mi: !!raw.mi,
    blend: BLEND_MODES.has(raw.blend) ? raw.blend : 'normal',
    fx: Number.isFinite(raw.fx) ? Number(raw.fx) : d.fx,
    sx: Number.isFinite(raw.sx) ? Math.min(255, Math.max(0, Number(raw.sx))) : d.sx,
    ix: Number.isFinite(raw.ix) ? Math.min(255, Math.max(0, Number(raw.ix))) : d.ix,
    pal: Number.isFinite(raw.pal) ? Number(raw.pal) : d.pal,
    presetId: typeof raw.presetId === 'string' ? raw.presetId : '',
    presetVariables: normalizePresetVariables(raw.presetVariables),
    colors: [0, 1, 2].map((i) => normalizeHexOrEmpty(colorsSrc[i])),
    maskAssignment,
  };
}

export function normalizeSegmentMap(raw) {
  if (!raw || typeof raw !== 'object') return createEmptySegmentMap();
  const segments = Array.isArray(raw.segments) && raw.segments.length
    ? raw.segments.map(normalizeSegment)
    : [createEmptySegment()];
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : shortSegmentMapId(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Untitled map',
    segments,
  };
}

export function normalizeRuleTiming(raw) {
  const d = createEmptyRuleTiming();
  if (!raw || typeof raw !== 'object') return { ...d };
  return {
    enabled: !!raw.enabled,
    offset: Number.isFinite(raw.offset) ? Math.max(0, Number(raw.offset)) : d.offset,
    cooldownSec: Number.isFinite(raw.cooldownSec) ? Math.max(0, Number(raw.cooldownSec)) : d.cooldownSec,
    cooldownResetMode: COOLDOWN_RESET_MODES.has(raw.cooldownResetMode) ? raw.cooldownResetMode : d.cooldownResetMode,
  };
}

export function normalizeStartTransition(raw) {
  const d = createEmptyStartTransition();
  if (!raw || typeof raw !== 'object') return { ...d };
  return {
    type: START_TRANSITION_TYPES.has(raw.type) ? raw.type : d.type,
    timeMs: Number.isFinite(raw.timeMs) ? Math.max(0, Number(raw.timeMs)) : d.timeMs,
  };
}

export function normalizeMbRule(raw, index = 0) {
  const d = createEmptyRule();
  if (!raw || typeof raw !== 'object') {
    return { ...d, priority: index * 10 };
  }
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : shortRuleId(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `Rule ${index + 1}`,
    enabled: raw.enabled !== false,
    priority: Number.isFinite(raw.priority) ? Number(raw.priority) : index * 10,
    match: normalizeConditionNode(raw.match || createEmptyMatchGroup('all')),
    extract: Array.isArray(raw.extract) ? raw.extract.map(normalizeExtract) : [],
    presetId: typeof raw.presetId === 'string' ? raw.presetId : '',
    segmentMapId: typeof raw.segmentMapId === 'string' ? raw.segmentMapId : '',
    timing: normalizeRuleTiming(raw.timing),
    startTransition: normalizeStartTransition(raw.startTransition),
  };
}

/** Re-assign priority to 0, 10, 20, … preserving array order. */
export function reindexRulePriorities(rules) {
  return (rules || []).map((rule, i) => ({ ...rule, priority: i * 10 }));
}

export function normalizeMbMapping(raw) {
  const d = DEFAULT_MB_MAPPING;
  if (!raw || typeof raw !== 'object') return JSON.parse(JSON.stringify(d));

  const colors = Array.from({ length: 32 }, (_, i) => {
    const c = raw.colors?.[i];
    return c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : d.colors[i];
  });

  const segments = {};
  MB_SEGMENT_META.forEach(({ id }) => {
    const src = raw.segments?.[id];
    segments[id] = src?.length
      ? src.map(s => withSegRefDefaults(s))
      : d.segments[id].map(s => withSegRefDefaults(s));
  });

  const rulesSrc = Array.isArray(raw.rules) ? raw.rules : [];
  const rules = rulesSrc.map((r, i) => normalizeMbRule(r, i));
  const segmentMaps = (raw.segmentMaps || []).map(normalizeSegmentMap);

  return {
    version: 1,
    rules,
    segmentMaps,
    defaultPresetId: typeof raw.defaultPresetId === 'string' ? raw.defaultPresetId : '',
    colors,
    randomPool: normalizeRandomPool(raw.randomPool),
    segments,
    paradeDetection: normalizeParadeDetection(raw.paradeDetection),
  };
}

/** BLE / NVS document shape expected by firmware set_mb_rules / mb_mapping_config. */
export function mbMappingToBlePayload(config) {
  const synced = normalizeMbMapping(config);
  const colors = {};
  synced.colors.forEach((hex, i) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    colors[String(i)] = [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  });
  return {
    version: 1,
    rules: synced.rules,
    segmentMaps: synced.segmentMaps,
    defaultPresetId: synced.defaultPresetId || '',
    colors,
    randomPool: {
      palettes: synced.randomPool.paletteIndices,
      custom: (synced.randomPool.custom || []).map(c => ({
        id: c.id,
        name: c.name,
        rgb: [
          parseInt(c.hex.slice(1, 3), 16),
          parseInt(c.hex.slice(3, 5), 16),
          parseInt(c.hex.slice(5, 7), 16),
        ],
      })),
    },
    segments: synced.segments,
    paradeDetection: normalizeParadeDetection(synced.paradeDetection),
  };
}

export function presetWledForBoard(preset, customSegmentLayouts) {
  const wled = JSON.parse(JSON.stringify(preset.wled || { on: true }));
  const always = () => true;
  const m = { effect: true, palette: true, parameters: true, color: true, segments: true };
  const activeSegments = activeSegmentsFromPreset(preset, customSegmentLayouts);
  if (activeSegments.length > 0) {
    wled.seg = activeSegments.map((seg, i) => buildRecalledSegment(seg, wled, always, m, i));
  } else {
    wled.seg = [buildRecalledSegment({ id: 0 }, wled, always, m, 0)];
  }
  return wled;
}

export function withSegRefDefaults(ref) {
  return {
    id: ref.id, start: ref.start, stop: ref.stop,
    grp: ref.grp ?? 1,
    spc: ref.spc ?? 0,
    of: ref.of ?? 0,
    rev: ref.rev ?? false,
    mi: ref.mi ?? false,
    fx: ref.fx ?? -1,
    sx: ref.sx ?? 128,
    ix: ref.ix ?? 128,
    pal: ref.pal ?? -1,
  };
}

export function migrateWandLabDefaults(data) {
  if (data.wandLab) return data;
  return { ...data, wandLab: { simIp: '', log: [] } };
}
