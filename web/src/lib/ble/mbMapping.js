import { DEFAULT_MB_WLED_COLORS, MB_ANIMATION_META, MB_EFFECT_CLASS_META, MB_PATTERN_META, MB_SEGMENT_META, SW_ANIMATION_META, defaultRandomPaletteIndices, normalizeRandomPool } from './mbConstants';
import { activeSegmentsFromPreset, buildRecalledSegment, formatSegRange } from '../wled/capture';

export const DEFAULT_MB_EFFECT_CLASSES = {
  singleColor: { presetId: '', useMbColors: true },
  dualColor: { presetId: '', useMbColors: true },
  sixBitColor: { presetId: '', useMbColors: true },
  fivePositionPalette: { presetId: '', useMbColors: true },
  fivePositionFlash: { presetId: '', useMbColors: true },
  unclassified: { presetId: '', useMbColors: false },
  unclassifiedOpcodes: {},
};

export const DEFAULT_MB_MAPPING = {
  version: 1,
  effectClasses: JSON.parse(JSON.stringify(DEFAULT_MB_EFFECT_CLASSES)),
  defaultPresetId: '',
  colors: [...DEFAULT_MB_WLED_COLORS],
  randomPool: {
    paletteIndices: defaultRandomPaletteIndices(),
    custom: [],
  },
  animations: {
    E90C: { presetId: '', colorSlots: [] },
    E90E: { presetId: '', colorSlots: [] },
    E90F: { presetId: '', colorSlots: [] },
    E910: { presetId: '', colorSlots: [] },
    E911: { presetId: '', colorSlots: [] },
    E912: { presetId: '', colorSlots: [] },
    E913: { presetId: '', colorSlots: [] },
    wand: { presetId: '', colorSlots: [] },
  },
  swAnimations: {
    wand: { presetId: '', colorSlots: [] },
    rainbow: { presetId: '', colorSlots: [] },
    blink: { presetId: '', colorSlots: [] },
    palette5: { presetId: '', colorSlots: [] },
    flash: { presetId: '', colorSlots: [] },
    sparkle: { presetId: '', colorSlots: [] },
    pulse: { presetId: '', colorSlots: [] },
    circle: { presetId: '', colorSlots: [] },
    fade: { presetId: '', colorSlots: [] },
    fade2: { presetId: '', colorSlots: [] },
  },
  patterns: {
    '3': { presetId: '', colorSlots: [] },
    '4': { presetId: '', colorSlots: [] },
    '5': { presetId: '', colorSlots: [] },
    '8': { presetId: '', colorSlots: [] },
    'B': { presetId: '', colorSlots: [] },
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
};

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

export function normalizeEffectClassMapping(v, fallback) {
  if (!v) return { ...fallback };
  return {
    presetId: typeof v.presetId === 'string' ? v.presetId : fallback.presetId,
    useMbColors: typeof v.useMbColors === 'boolean' ? v.useMbColors : fallback.useMbColors,
  };
}

export function normalizeEffectClasses(raw) {
  const d = DEFAULT_MB_EFFECT_CLASSES;
  const unclassifiedOpcodes = {};
  if (raw?.unclassifiedOpcodes && typeof raw.unclassifiedOpcodes === 'object') {
    Object.entries(raw.unclassifiedOpcodes).forEach(([k, v]) => {
      unclassifiedOpcodes[k] = normalizeEffectClassMapping(v, d.unclassified);
    });
  }
  return {
    singleColor: normalizeEffectClassMapping(raw?.singleColor, d.singleColor),
    dualColor: normalizeEffectClassMapping(raw?.dualColor, d.dualColor),
    sixBitColor: normalizeEffectClassMapping(raw?.sixBitColor, d.sixBitColor),
    fivePositionPalette: normalizeEffectClassMapping(raw?.fivePositionPalette, d.fivePositionPalette),
    fivePositionFlash: normalizeEffectClassMapping(raw?.fivePositionFlash, d.fivePositionFlash),
    unclassified: normalizeEffectClassMapping(raw?.unclassified, d.unclassified),
    unclassifiedOpcodes,
  };
}

export function mirrorEffectClassesToLegacy(config) {
  const ec = config.effectClasses;
  if (!ec) return config;
  const animations = { ...config.animations };
  const patterns = { ...config.patterns };
  const mirrorAnim = (opcode, cls) => {
    if (cls.presetId && animations[opcode]) animations[opcode] = { ...animations[opcode], presetId: cls.presetId };
  };
  mirrorAnim('E90E', ec.fivePositionFlash);
  Object.entries(ec.unclassifiedOpcodes || {}).forEach(([opcode, mapping]) => {
    if (mapping?.presetId && animations[opcode]) animations[opcode] = { ...animations[opcode], presetId: mapping.presetId };
  });
  if (ec.unclassified.presetId) {
    MB_ANIMATION_META.forEach(({ key }) => {
      if (key === 'wand') return;
      if (!ec.unclassifiedOpcodes?.[key] && !animations[key].presetId) {
        animations[key] = { ...animations[key], presetId: ec.unclassified.presetId };
      }
    });
  }
  if (ec.fivePositionPalette.presetId) {
    MB_PATTERN_META.forEach(({ key }) => {
      if (!patterns[key].presetId) patterns[key] = { ...patterns[key], presetId: ec.fivePositionPalette.presetId };
    });
  }
  return { ...config, animations, patterns };
}

export function normalizeMbMapping(raw) {
  const d = DEFAULT_MB_MAPPING;
  if (!raw || raw.version !== 1) return JSON.parse(JSON.stringify(d));
  const colors = Array.from({ length: 32 }, (_, i) => {
    const c = raw.colors?.[i];
    return c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : d.colors[i];
  });
  const normEffect = (key, fallback, src) => {
    const v = src?.[key];
    if (!v) return { ...fallback };
    if (typeof v === 'string') return { presetId: v, colorSlots: [...fallback.colorSlots] };
    return {
      presetId: v.presetId ?? '',
      colorSlots: Array.isArray(v.colorSlots) ? [...v.colorSlots] : [...fallback.colorSlots],
    };
  };
  const animations = {};
  MB_ANIMATION_META.forEach(({ key }) => { animations[key] = normEffect(key, d.animations[key], raw.animations); });
  const normEffectDirect = (v, fallback) => {
    if (!v) return { ...fallback };
    if (typeof v === 'string') return { presetId: v, colorSlots: [...fallback.colorSlots] };
    return {
      presetId: v.presetId ?? '',
      colorSlots: Array.isArray(v.colorSlots) ? [...v.colorSlots] : [...fallback.colorSlots],
    };
  };
  const swAnimations = {};
  SW_ANIMATION_META.forEach(({ key }) => {
    const fromSw = raw.swAnimations?.[key];
    const fromLegacy = key === 'wand' ? raw.animations?.wand : undefined;
    swAnimations[key] = normEffectDirect(fromSw ?? fromLegacy, d.swAnimations[key]);
  });
  const patterns = {};
  MB_PATTERN_META.forEach(({ key }) => { patterns[key] = normEffect(key, d.patterns[key], raw.patterns); });
  const segments = {};
  MB_SEGMENT_META.forEach(({ id }) => {
    const src = raw.segments?.[id];
    segments[id] = src?.length
      ? src.map(s => withSegRefDefaults(s))
      : d.segments[id].map(s => withSegRefDefaults(s));
  });
  const base = {
    version: 1,
    effectClasses: normalizeEffectClasses(raw.effectClasses),
    defaultPresetId: typeof raw.defaultPresetId === 'string' ? raw.defaultPresetId : '',
    colors,
    randomPool: normalizeRandomPool(raw.randomPool),
    animations, swAnimations, patterns, segments,
  };
  return mirrorEffectClassesToLegacy(base);
}

export function mbMappingToBlePayload(config) {
  const synced = mirrorEffectClassesToLegacy(normalizeMbMapping(config));
  const colors = {};
  synced.colors.forEach((hex, i) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    colors[String(i)] = [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  });
  const mapEffect = (m) => ({ presetId: m.presetId, colorSlots: m.colorSlots });
  const animations = {};
  Object.entries(synced.animations).forEach(([k, v]) => { animations[k] = mapEffect(v); });
  const swAnimations = {};
  Object.entries(synced.swAnimations || {}).forEach(([k, v]) => { swAnimations[k] = mapEffect(v); });
  const patterns = {};
  Object.entries(synced.patterns).forEach(([k, v]) => { patterns[k] = mapEffect(v); });
  const mapClass = (m) => ({ presetId: m.presetId, useMbColors: m.useMbColors });
  const effectClasses = {};
  MB_EFFECT_CLASS_META.forEach(({ key }) => { effectClasses[key] = mapClass(synced.effectClasses[key]); });
  const unclassifiedOpcodes = {};
  Object.entries(synced.effectClasses.unclassifiedOpcodes || {}).forEach(([k, v]) => {
    if (v) unclassifiedOpcodes[k] = mapClass(v);
  });
  return {
    version: 1,
    defaultPresetId: synced.defaultPresetId || '',
    effectClasses: { ...effectClasses, unclassifiedOpcodes },
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
    animations,
    swAnimations,
    patterns,
    segments: synced.segments,
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
