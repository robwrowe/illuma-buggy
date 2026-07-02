import { withSegRefDefaults } from './configMigration';

export type MbEffectClassKey =
  | 'singleColor'
  | 'dualColor'
  | 'sixBitColor'
  | 'fivePositionPalette'
  | 'fivePositionFlash'
  | 'unclassified';

export interface WledSegRef {
  id: number;
  start: number;
  stop: number;
  grp?: number;
  spc?: number;
  of?: number;
  rev?: boolean;
  mi?: boolean;
  fx?: number;
  sx?: number;
  ix?: number;
  pal?: number;
}

export type MbSegmentId =
  | 'all'
  | 'inner'
  | 'outer'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight'
  | 'center'
  | 'band0'
  | 'band1'
  | 'band2'
  | 'band3'
  | 'band4'
  | 'band5'
  | 'band6'
  | 'band7';

/** MB animation opcode key (E90C, E90E, …) or wand */
export type MbAnimationKey =
  | 'E90C'
  | 'E90E'
  | 'E90F'
  | 'E910'
  | 'E911'
  | 'E912'
  | 'E913'
  | 'wand';

/** E909 pattern nibble (top 3 bits), hex digit */
export type MbPatternKey = '3' | '4' | '5' | '8' | 'B';

/** Named Starlight Wand / WandSimulator `sw fx` presets (higher priority than MB+) */
export type SwAnimationKey =
  | 'rainbow'
  | 'blink'
  | 'palette5'
  | 'flash'
  | 'sparkle'
  | 'pulse'
  | 'circle'
  | 'fade'
  | 'fade2'
  | 'wand';

export interface MbEffectMapping {
  /** Saved Illuma preset id, or empty for built-in segment colors */
  presetId: string;
  /**
   * Maps MB color slots (0..n-1 in the packet) → MB palette index (0–31).
   * If fewer slots than preset colors: repeat cyclically.
   * If more slots than preset: truncate.
   */
  colorSlots: number[];
}

/** Per animation-class WLED binding (Tier 1 + Tier 2) */
export interface MbEffectClassMapping {
  presetId: string;
  /** Tier 1: apply decoded MB palette colors vs preset's own colors */
  useMbColors: boolean;
}

export interface MbEffectClassesConfig {
  singleColor: MbEffectClassMapping;
  dualColor: MbEffectClassMapping;
  sixBitColor: MbEffectClassMapping;
  fivePositionPalette: MbEffectClassMapping;
  fivePositionFlash: MbEffectClassMapping;
  unclassified: MbEffectClassMapping;
  /** Optional per-opcode Tier 2 bindings (e.g. E910, E913) */
  unclassifiedOpcodes: Partial<Record<string, MbEffectClassMapping>>;
}

export interface MbMappingConfig {
  version: 1;
  /** Animation-class → preset bindings (additive; empty = legacy firmware fallback) */
  effectClasses?: MbEffectClassesConfig;
  /** Fallback preset when an effect has no presetId — same list as GPS zones */
  defaultPresetId: string;
  /** WLED hex per MB palette index 0–31 */
  colors: string[];
  /** When MB sends palette 31 (random), pick from this pool */
  randomPool: MbRandomPool;
  animations: Record<MbAnimationKey, MbEffectMapping>;
  /** Starlight Wand named effects — checked before MB+ when Starlight is enabled */
  swAnimations: Record<SwAnimationKey, MbEffectMapping>;
  patterns: Record<MbPatternKey, MbEffectMapping>;
  segments: Record<MbSegmentId, WledSegRef[]>;
}

/** MB palette index 29 = off, 30 = unique, 31 = random (resolved at runtime) */
export const MB_PAL_OFF = 29;
export const MB_PAL_UNIQUE = 30;
export const MB_PAL_RANDOM = 31;

export interface MbRandomCustomColor {
  id: string;
  name: string;
  hex: string;
}

export interface MbRandomPool {
  /** Palette indices 0–30 eligible for random picks (never include 29/30/31) */
  paletteIndices: number[];
  /** Extra colors used only when random is triggered */
  custom: MbRandomCustomColor[];
}

export function mbPaletteEligibleForRandom(idx: number): boolean {
  return Number.isInteger(idx) && idx >= 0 && idx <= 30 && idx !== MB_PAL_OFF && idx !== MB_PAL_UNIQUE;
}

export function defaultRandomPaletteIndices(): number[] {
  return Array.from({ length: MB_PAL_RANDOM }, (_, i) => i).filter(mbPaletteEligibleForRandom);
}

export function normalizeRandomPool(raw: Partial<MbRandomPool> | undefined): MbRandomPool {
  const defaultPalettes = defaultRandomPaletteIndices();
  const paletteIndices = Array.isArray(raw?.paletteIndices)
    ? [...new Set(raw!.paletteIndices.filter(mbPaletteEligibleForRandom))].sort((a, b) => a - b)
    : defaultPalettes;
  const custom: MbRandomCustomColor[] = [];
  if (Array.isArray(raw?.custom)) {
    for (const entry of raw.custom) {
      if (!entry || typeof entry !== 'object') continue;
      const hex = typeof entry.hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(entry.hex) ? entry.hex : '';
      if (!hex) continue;
      const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Custom';
      const id = typeof entry.id === 'string' && entry.id ? entry.id : `custom-${custom.length}`;
      custom.push({ id, name, hex });
      if (custom.length >= 16) break;
    }
  }
  return {
    paletteIndices: paletteIndices.length > 0 || custom.length > 0 ? paletteIndices : defaultPalettes,
    custom,
  };
}

export const MB_COLOR_NAMES: string[] = [
  'cyan', 'purple', 'blue', 'midnight blue', 'blue 2', 'bright purple', 'lavender', 'purple',
  'pink', 'pink 2', 'pink 3', 'pink 4', 'pink 5', 'pink 6', 'pink 7', 'yellow orange',
  'off yellow', 'yellow orange 2', 'lime', 'orange', 'red orange', 'red',
  'cyan 2', 'cyan 3', 'cyan 4', 'green', 'lime green', 'white', 'white 2',
  'off', 'unique', 'random',
];

/** Sensible WLED defaults for each MB palette index */
export const DEFAULT_MB_WLED_COLORS: string[] = [
  '#00ffff', '#9900ff', '#0000ff', '#000080', '#0066ff', '#cc44ff', '#cc99ff', '#7700cc',
  '#ff66b2', '#ff5aa8', '#ff509e', '#ff4a94', '#ff6e96', '#ff82a0', '#ffa0aa', '#ffaa00',
  '#cccc00', '#ff8800', '#aaff00', '#ff6600', '#ff3300', '#ff0000',
  '#3cffff', '#28f0ff', '#14c8ff', '#00ff00', '#66ff28', '#ffffff', '#f0f0f0',
  '#000000', '#ff9933', '#ff00ff',
];

const emptyMapping = (): MbEffectMapping => ({ presetId: '', colorSlots: [] });
const emptyClassMapping = (): MbEffectClassMapping => ({ presetId: '', useMbColors: true });

export const DEFAULT_MB_EFFECT_CLASSES: MbEffectClassesConfig = {
  singleColor: emptyClassMapping(),
  dualColor: emptyClassMapping(),
  sixBitColor: emptyClassMapping(),
  fivePositionPalette: emptyClassMapping(),
  fivePositionFlash: emptyClassMapping(),
  unclassified: { presetId: '', useMbColors: false },
  unclassifiedOpcodes: {},
};

export const MB_EFFECT_CLASS_META: {
  key: MbEffectClassKey;
  label: string;
  description: string;
  badge: 'Fully Decoded' | 'Partially Decoded' | 'Unmapped Bytes — Preset Only';
  tier: 1 | 2;
}[] = [
  {
    key: 'singleColor',
    label: 'Single Color',
    description: 'One palette color lights selected band LEDs (E905).',
    badge: 'Fully Decoded',
    tier: 1,
  },
  {
    key: 'dualColor',
    label: 'Dual Color',
    description: 'Inner and outer ring colors from palette (E906).',
    badge: 'Fully Decoded',
    tier: 1,
  },
  {
    key: 'sixBitColor',
    label: '6-bit Color',
    description: 'Raw RGB encoded as 6-bit channels (E908).',
    badge: 'Fully Decoded',
    tier: 1,
  },
  {
    key: 'fivePositionPalette',
    label: '5-Position Palette',
    description: 'Five corner/center slots each pick a palette color (E909, E90C palette mode).',
    badge: 'Fully Decoded',
    tier: 1,
  },
  {
    key: 'fivePositionFlash',
    label: '5-Position Flash Pattern',
    description: 'Subset of the five positions lights up and can flash or hold steady (E90E).',
    badge: 'Partially Decoded',
    tier: 1,
  },
  {
    key: 'unclassified',
    label: 'Unclassified / Unknown',
    description: 'Opcodes we cannot decode yet — map to a preset look blindly (E910, E913, E90C animation mode, etc.).',
    badge: 'Unmapped Bytes — Preset Only',
    tier: 2,
  },
];

/** Preset IDs referenced by MB/SW mapping — must exist on board NVS before wand/MB effects fire. */
export function collectMappingPresetIds(mbMapping: MbMappingConfig): string[] {
  const ids = new Set<string>();
  if (mbMapping.defaultPresetId) ids.add(mbMapping.defaultPresetId);
  const addBlock = (block: Record<string, MbEffectMapping> | undefined) => {
    if (!block) return;
    for (const m of Object.values(block)) {
      if (m?.presetId) ids.add(m.presetId);
    }
  };
  addBlock(mbMapping.animations);
  addBlock(mbMapping.swAnimations);
  addBlock(mbMapping.patterns);
  const ec = mbMapping.effectClasses;
  if (ec) {
    for (const { key } of MB_EFFECT_CLASS_META) {
      if (ec[key]?.presetId) ids.add(ec[key].presetId);
    }
    for (const m of Object.values(ec.unclassifiedOpcodes ?? {})) {
      if (m?.presetId) ids.add(m.presetId);
    }
  }
  return [...ids];
}

export const TIER2_OPCODE_OPTIONS = [
  'E90C', 'E90F', 'E910', 'E911', 'E912', 'E913', 'E914', 'E91B',
] as const;

export const DEFAULT_MB_MAPPING: MbMappingConfig = {
  version: 1,
  effectClasses: JSON.parse(JSON.stringify(DEFAULT_MB_EFFECT_CLASSES)) as MbEffectClassesConfig,
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
    wand:     { presetId: '', colorSlots: [] },
    rainbow:  { presetId: '', colorSlots: [] },
    blink:    { presetId: '', colorSlots: [] },
    palette5: { presetId: '', colorSlots: [] },
    flash:    { presetId: '', colorSlots: [] },
    sparkle:  { presetId: '', colorSlots: [] },
    pulse:    { presetId: '', colorSlots: [] },
    circle:   { presetId: '', colorSlots: [] },
    fade:     { presetId: '', colorSlots: [] },
    fade2:    { presetId: '', colorSlots: [] },
  },
  patterns: {
    '3': { presetId: '', colorSlots: [] },  // spin → segment solids unless preset set
    '4': { presetId: '', colorSlots: [] },  // solid
    '5': { presetId: '', colorSlots: [] },  // all on
    '8': { presetId: '', colorSlots: [] },  // corners
    'B': { presetId: '', colorSlots: [] },  // all palette B
  },
  segments: {
    all:         [{ id: 0, start: 0, stop: 100 }],
    inner:       [{ id: 1, start: 35, stop: 65 }],
    outer:       [{ id: 2, start: 0, stop: 35 }, { id: 3, start: 65, stop: 100 }],
    topLeft:     [{ id: 4, start: 0, stop: 25 }],
    topRight:    [{ id: 5, start: 25, stop: 50 }],
    bottomLeft:  [{ id: 6, start: 50, stop: 75 }],
    bottomRight: [{ id: 7, start: 75, stop: 100 }],
    center:      [{ id: 8, start: 48, stop: 52 }],
    band0:       [{ id: 9, start: 0, stop: 20 }],
    band1:       [{ id: 10, start: 20, stop: 40 }],
    band2:       [{ id: 11, start: 40, stop: 60 }],
    band3:       [{ id: 12, start: 60, stop: 80 }],
    band4:       [{ id: 13, start: 80, stop: 100 }],
    band5:       [{ id: 14, start: 80, stop: 87 }],
    band6:       [{ id: 15, start: 87, stop: 94 }],
    band7:       [{ id: 16, start: 94, stop: 100 }],
  },
};

export const MB_SEGMENT_META: { id: MbSegmentId; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'E905 mask 000, full strip' },
  { id: 'inner', label: 'Inner ring', hint: 'E906 inner' },
  { id: 'outer', label: 'Outer ring', hint: 'E906 outer' },
  { id: 'topLeft', label: 'Top left', hint: 'E909 TL' },
  { id: 'topRight', label: 'Top right', hint: 'E909 TR' },
  { id: 'bottomLeft', label: 'Bottom left', hint: 'E909 BL' },
  { id: 'bottomRight', label: 'Bottom right', hint: 'E909 BR' },
  { id: 'center', label: 'Center', hint: 'E909 center' },
  { id: 'band0', label: 'Band LED 0', hint: 'E905 mask bit 0' },
  { id: 'band1', label: 'Band LED 1', hint: 'E905 mask bit 1' },
  { id: 'band2', label: 'Band LED 2', hint: 'E905 mask bit 2' },
  { id: 'band3', label: 'Band LED 3', hint: 'E905 mask bit 3' },
  { id: 'band4', label: 'Band LED 4', hint: 'E905 mask bit 4' },
  { id: 'band5', label: 'Band LED 5', hint: 'reserved — not yet wired to a trigger' },
  { id: 'band6', label: 'Band LED 6', hint: 'reserved — not yet wired to a trigger' },
  { id: 'band7', label: 'Band LED 7', hint: 'reserved — not yet wired to a trigger' },
];

export const MB_ANIMATION_META: { key: MbAnimationKey; label: string }[] = [
  { key: 'E90C', label: 'Show FX (Taste the Rainbow)' },
  { key: 'E90E', label: 'Flash' },
  { key: 'E90F', label: 'Animation F' },
  { key: 'E910', label: 'Animation 10' },
  { key: 'E911', label: 'Cross-fade' },
  { key: 'E912', label: 'Circle' },
  { key: 'E913', label: 'Pulse' },
  { key: 'wand', label: 'Starlight Wand cast (legacy — use SW Animations)' },
];

export const SW_ANIMATION_META: { key: SwAnimationKey; label: string; hint: string }[] = [
  { key: 'wand',     label: 'Color cast',              hint: 'CF0B / CF9B palette transfer' },
  { key: 'rainbow',  label: 'rainbow',                 hint: 'E90C Taste the Rainbow' },
  { key: 'blink',    label: 'blink',                   hint: 'E90C white blink' },
  { key: 'palette5', label: 'palette5',              hint: 'E90C five-palette cycle' },
  { key: 'flash',    label: 'flash',                   hint: 'E90E purple/white flash' },
  { key: 'sparkle',  label: 'sparkle',                 hint: 'E910 blue sparkle' },
  { key: 'pulse',    label: 'pulse',                   hint: 'E913 purple pulse' },
  { key: 'circle',   label: 'circle',                  hint: 'E912 blue circle' },
  { key: 'fade',     label: 'fade',                    hint: 'E911 cyan → pink' },
  { key: 'fade2',    label: 'fade2',                   hint: 'E911 pink → green' },
];

export const MB_PATTERN_META: { key: MbPatternKey; label: string }[] = [
  { key: '3', label: 'Spin (palette B)' },
  { key: '4', label: 'Solid palette A' },
  { key: '5', label: 'All LEDs on' },
  { key: '8', label: 'Four / five corners' },
  { key: 'B', label: 'All on palette B' },
];

function normalizeEffectClassMapping(
  v: Partial<MbEffectClassMapping> | undefined,
  fallback: MbEffectClassMapping,
): MbEffectClassMapping {
  if (!v) return { ...fallback };
  return {
    presetId: typeof v.presetId === 'string' ? v.presetId : fallback.presetId,
    useMbColors: typeof v.useMbColors === 'boolean' ? v.useMbColors : fallback.useMbColors,
  };
}

function normalizeEffectClasses(raw: Partial<MbEffectClassesConfig> | undefined): MbEffectClassesConfig {
  const d = DEFAULT_MB_EFFECT_CLASSES;
  const unclassifiedOpcodes: Partial<Record<string, MbEffectClassMapping>> = {};
  if (raw?.unclassifiedOpcodes && typeof raw.unclassifiedOpcodes === 'object') {
    for (const [k, v] of Object.entries(raw.unclassifiedOpcodes)) {
      unclassifiedOpcodes[k] = normalizeEffectClassMapping(v, d.unclassified);
    }
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

/** Mirror effect-class presets into legacy animations/patterns for firmware compat */
export function mirrorEffectClassesToLegacy(config: MbMappingConfig): MbMappingConfig {
  const ec = config.effectClasses;
  if (!ec) return config;
  const animations = { ...config.animations };
  const patterns = { ...config.patterns };

  const mirrorAnim = (opcode: MbAnimationKey, cls: MbEffectClassMapping) => {
    if (cls.presetId && animations[opcode]) {
      animations[opcode] = { ...animations[opcode], presetId: cls.presetId };
    }
  };

  mirrorAnim('E90E', ec.fivePositionFlash);
  for (const [opcode, mapping] of Object.entries(ec.unclassifiedOpcodes)) {
    const k = opcode as MbAnimationKey;
    if (mapping?.presetId && animations[k]) {
      animations[k] = { ...animations[k], presetId: mapping.presetId };
    }
  }
  if (ec.unclassified.presetId) {
    for (const { key } of MB_ANIMATION_META) {
      if (key === 'wand') continue;
      if (!ec.unclassifiedOpcodes[key] && !animations[key].presetId) {
        animations[key] = { ...animations[key], presetId: ec.unclassified.presetId };
      }
    }
  }
  if (ec.fivePositionPalette.presetId) {
    for (const { key } of MB_PATTERN_META) {
      if (!patterns[key].presetId) {
        patterns[key] = { ...patterns[key], presetId: ec.fivePositionPalette.presetId };
      }
    }
  }

  return { ...config, animations, patterns };
}

export function normalizeMbMapping(raw: Partial<MbMappingConfig> | undefined): MbMappingConfig {
  const d = DEFAULT_MB_MAPPING;
  if (!raw || raw.version !== 1) {
    return JSON.parse(JSON.stringify(d)) as MbMappingConfig;
  }
  const colors = Array.from({ length: 32 }, (_, i) => {
    const c = raw.colors?.[i];
    return c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : d.colors[i];
  });
  const normEffect = (key: string, fallback: MbEffectMapping): MbEffectMapping => {
    const v = (raw.animations as Record<string, MbEffectMapping> | undefined)?.[key]
      ?? (raw.patterns as Record<string, MbEffectMapping> | undefined)?.[key];
    if (!v) return { ...fallback };
    if (typeof v === 'string') return { presetId: v, colorSlots: [...fallback.colorSlots] };
    return {
      presetId: v.presetId ?? '',
      colorSlots: Array.isArray(v.colorSlots) ? [...v.colorSlots] : [...fallback.colorSlots],
    };
  };
  const normEffectDirect = (v: MbEffectMapping | undefined, fallback: MbEffectMapping): MbEffectMapping => {
    if (!v) return { ...fallback };
    if (typeof v === 'string') return { presetId: v, colorSlots: [...fallback.colorSlots] };
    return {
      presetId: v.presetId ?? '',
      colorSlots: Array.isArray(v.colorSlots) ? [...v.colorSlots] : [...fallback.colorSlots],
    };
  };
  const animations = {} as Record<MbAnimationKey, MbEffectMapping>;
  for (const { key } of MB_ANIMATION_META) {
    animations[key] = normEffect(key, d.animations[key]);
  }
  const swAnimations = {} as Record<SwAnimationKey, MbEffectMapping>;
  for (const { key } of SW_ANIMATION_META) {
    const fromSw = (raw as MbMappingConfig).swAnimations?.[key];
    const fromLegacy = key === 'wand' ? raw.animations?.wand : undefined;
    swAnimations[key] = normEffectDirect(fromSw ?? fromLegacy, d.swAnimations[key]);
  }
  const patterns = {} as Record<MbPatternKey, MbEffectMapping>;
  for (const { key } of MB_PATTERN_META) {
    patterns[key] = normEffect(key, d.patterns[key]);
  }
  const segments = {} as Record<MbSegmentId, WledSegRef[]>;
  for (const { id } of MB_SEGMENT_META) {
    const src = raw.segments?.[id];
    segments[id] = src?.length
      ? src.map(s => withSegRefDefaults(s))
      : d.segments[id].map(s => withSegRefDefaults(s));
  }
  const effectClasses = normalizeEffectClasses(raw.effectClasses);
  const base: MbMappingConfig = {
    version: 1,
    effectClasses,
    defaultPresetId: typeof raw.defaultPresetId === 'string' ? raw.defaultPresetId : '',
    colors,
    randomPool: normalizeRandomPool(raw.randomPool),
    animations, swAnimations, patterns, segments,
  };
  return mirrorEffectClassesToLegacy(base);
}

/** Firmware BLE payload */
export function mbMappingToBlePayload(config: MbMappingConfig): object {
  const synced = mirrorEffectClassesToLegacy(normalizeMbMapping(config));
  const colors: Record<string, number[]> = {};
  synced.colors.forEach((hex, i) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    colors[String(i)] = [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  });
  const mapEffect = (m: MbEffectMapping) => ({
    presetId: m.presetId,
    colorSlots: m.colorSlots,
  });
  const animations: Record<string, object> = {};
  for (const [k, v] of Object.entries(synced.animations)) {
    animations[k] = mapEffect(v);
  }
  const swAnimations: Record<string, object> = {};
  for (const [k, v] of Object.entries(synced.swAnimations)) {
    swAnimations[k] = mapEffect(v);
  }
  const patterns: Record<string, object> = {};
  for (const [k, v] of Object.entries(synced.patterns)) {
    patterns[k] = mapEffect(v);
  }
  const mapClass = (m: MbEffectClassMapping) => ({
    presetId: m.presetId,
    useMbColors: m.useMbColors,
  });
  const effectClasses: Record<string, object> = {};
  const ec = synced.effectClasses ?? DEFAULT_MB_EFFECT_CLASSES;
  for (const { key } of MB_EFFECT_CLASS_META) {
    effectClasses[key] = mapClass(ec[key]);
  }
  const unclassifiedOpcodes: Record<string, object> = {};
  for (const [k, v] of Object.entries(ec.unclassifiedOpcodes)) {
    if (v) unclassifiedOpcodes[k] = mapClass(v);
  }
  return {
    version: 1,
    defaultPresetId: synced.defaultPresetId || '',
    effectClasses: { ...effectClasses, unclassifiedOpcodes },
    colors,
    randomPool: {
      palettes: synced.randomPool.paletteIndices,
      custom: synced.randomPool.custom.map(c => ({
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
