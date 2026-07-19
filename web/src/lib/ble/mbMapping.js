import { DEFAULT_MB_WLED_COLORS, MB_SEGMENT_META, defaultRandomPaletteIndices, normalizeRandomPool } from './mbConstants';
import { activeSegmentsFromPreset, buildRecalledSegment, formatSegRange } from '../wled/capture';

const BYTE_OPS = new Set(['eq', 'gt', 'gte', 'lt', 'lte', 'maskEq']);
const CMP_OPS = new Set(['eq', 'gt', 'gte', 'lt', 'lte']);

export function shortRuleId() {
  return `r${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`;
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

export function createEmptyExtract(name = '') {
  return {
    name,
    offset: 0,
    bitStart: 0,
    bitCount: 5,
    paletteMap: true,
    target: { kind: 'color', segment: 'all' },
  };
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
    segmentLayoutId: '',
    ...overrides,
  };
}

export const DEFAULT_MB_MAPPING = {
  version: 1,
  rules: [],
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

export function buildMbKeyedSegmentsFromMapping(mbMapping) {
  const segments = {};
  const mb = mbMapping || DEFAULT_MB_MAPPING;
  MB_SEGMENT_META.forEach(({ id }) => {
    segments[id] = (mb.segments?.[id] || DEFAULT_MB_MAPPING.segments[id] || []).map(withSegRefDefaults);
  });
  return segments;
}

export function mbLayoutSetBlePayload(data) {
  const layouts = data.mbSegmentLayouts || [];
  const activeId = data.mbActiveSegmentLayoutId || layouts[0]?.id;
  const activeIdx = Math.max(0, layouts.findIndex(l => l.id === activeId));
  return {
    type: 'mb_layout_set',
    layouts: layouts.map(l => ({ name: l.name, segments: l.segments })),
    active: activeIdx,
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

function normalizeTarget(raw) {
  if (!raw || typeof raw !== 'object') return { kind: 'color', segment: 'all' };
  if (raw.kind === 'wledField') {
    return { kind: 'wledField', field: typeof raw.field === 'string' ? raw.field : '' };
  }
  const segment = typeof raw.segment === 'string' && raw.segment ? raw.segment : 'all';
  return { kind: 'color', segment };
}

export function normalizeExtract(raw) {
  if (!raw || typeof raw !== 'object') return createEmptyExtract();
  const paletteMap = !!raw.paletteMap;
  const curve = paletteMap ? null : normalizeCurve(raw.curve);
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    offset: Number.isFinite(raw.offset) ? Math.max(0, Number(raw.offset)) : 0,
    bitStart: Number.isFinite(raw.bitStart) ? Math.min(7, Math.max(0, Number(raw.bitStart))) : 0,
    bitCount: Number.isFinite(raw.bitCount) ? Math.min(32, Math.max(1, Number(raw.bitCount))) : 8,
    paletteMap,
    ...(curve ? { curve } : {}),
    target: normalizeTarget(raw.target),
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
    segmentLayoutId: typeof raw.segmentLayoutId === 'string' ? raw.segmentLayoutId : '',
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

  return {
    version: 1,
    rules,
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
