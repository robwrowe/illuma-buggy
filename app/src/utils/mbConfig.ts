/**
 * MagicBand+ → WLED mapping configuration (v1)
 * Synced to firmware via BLE `mb_mapping_config`.
 */

export interface WledSegRef {
  id: number;
  start: number;
  stop: number;
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
  | 'band4';

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

export interface MbMappingConfig {
  version: 1;
  /** WLED hex per MB palette index 0–31 */
  colors: string[];
  animations: Record<MbAnimationKey, MbEffectMapping>;
  /** Starlight Wand named effects — checked before MB+ when Starlight is enabled */
  swAnimations: Record<SwAnimationKey, MbEffectMapping>;
  patterns: Record<MbPatternKey, MbEffectMapping>;
  segments: Record<MbSegmentId, WledSegRef[]>;
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

export const DEFAULT_MB_MAPPING: MbMappingConfig = {
  version: 1,
  colors: [...DEFAULT_MB_WLED_COLORS],
  animations: {
    E90C: { presetId: '', colorSlots: [0, 2, 21, 8, 18] },
    E90E: { presetId: '', colorSlots: [27] },
    E90F: { presetId: '', colorSlots: [] },
    E910: { presetId: '', colorSlots: [] },
    E911: { presetId: '', colorSlots: [21, 0] },
    E912: { presetId: '', colorSlots: [2, 8] },
    E913: { presetId: '', colorSlots: [1, 5] },
    wand: { presetId: '', colorSlots: [] },
  },
  swAnimations: {
    wand:     { presetId: '', colorSlots: [] },
    rainbow:  { presetId: '', colorSlots: [0, 2, 21, 8, 18] },
    blink:    { presetId: '', colorSlots: [27] },
    palette5: { presetId: '', colorSlots: [0, 2, 8, 21, 18] },
    flash:    { presetId: '', colorSlots: [1, 27] },
    sparkle:  { presetId: '', colorSlots: [2] },
    pulse:    { presetId: '', colorSlots: [1] },
    circle:   { presetId: '', colorSlots: [2, 8] },
    fade:     { presetId: '', colorSlots: [0, 8] },
    fade2:    { presetId: '', colorSlots: [8, 18] },
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
      ? src.map(s => ({ id: s.id ?? 0, start: s.start, stop: s.stop }))
      : d.segments[id].map(s => ({ ...s }));
  }
  return { version: 1, colors, animations, swAnimations, patterns, segments };
}

/** Firmware BLE payload */
export function mbMappingToBlePayload(config: MbMappingConfig): object {
  const colors: Record<string, number[]> = {};
  config.colors.forEach((hex, i) => {
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
  for (const [k, v] of Object.entries(config.animations)) {
    animations[k] = mapEffect(v);
  }
  const swAnimations: Record<string, object> = {};
  for (const [k, v] of Object.entries(config.swAnimations)) {
    swAnimations[k] = mapEffect(v);
  }
  const patterns: Record<string, object> = {};
  for (const [k, v] of Object.entries(config.patterns)) {
    patterns[k] = mapEffect(v);
  }
  return {
    version: 1,
    colors,
    animations,
    swAnimations,
    patterns,
    segments: config.segments,
  };
}
