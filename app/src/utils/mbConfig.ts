import { withSegRefDefaults } from './configMigration';

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

/** Parade beacon detection — pushed with mb_mapping_config / rules. */
export interface ParadeDetectionConfig {
  enabled: boolean;
  beaconOpcodeHexPrefix: string;
  rssiThreshold: number;
  cooldownSec: number;
}

export const DEFAULT_PARADE_DETECTION: ParadeDetectionConfig = {
  enabled: true,
  beaconOpcodeHexPrefix: 'cd07',
  rssiThreshold: -70,
  cooldownSec: 30,
};

export function normalizeParadeDetection(raw: Partial<ParadeDetectionConfig> | undefined): ParadeDetectionConfig {
  const d = DEFAULT_PARADE_DETECTION;
  const prefix = typeof raw?.beaconOpcodeHexPrefix === 'string'
    ? raw.beaconOpcodeHexPrefix.trim().toLowerCase()
    : d.beaconOpcodeHexPrefix;
  return {
    enabled: raw?.enabled !== undefined ? !!raw.enabled : d.enabled,
    beaconOpcodeHexPrefix: prefix || d.beaconOpcodeHexPrefix,
    rssiThreshold: Number.isFinite(raw?.rssiThreshold) ? Number(raw!.rssiThreshold) : d.rssiThreshold,
    cooldownSec: Number.isFinite(raw?.cooldownSec) ? Math.max(1, Number(raw!.cooldownSec)) : d.cooldownSec,
  };
}

export interface MbMappingConfig {
  version: 1;
  /** Fallback preset when an effect has no presetId — same list as GPS zones */
  defaultPresetId: string;
  /** WLED hex per MB palette index 0–31 */
  colors: string[];
  /** When MB sends palette 31 (random), pick from this pool */
  randomPool: MbRandomPool;
  segments: Record<MbSegmentId, WledSegRef[]>;
  /** Rule engine — opaque; authored in web tool, pushed via set_mb_rules */
  rules?: unknown[];
  /** Shareable segment maps — opaque; authored in web tool */
  segmentMaps?: unknown[];
  /** Parade route beacon detection (firmware MbRuleEngine) */
  paradeDetection?: ParadeDetectionConfig;
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

/**
 * Preset IDs referenced by MB mapping config.
 * Currently only `defaultPresetId` — rules/segmentMaps are opaque and may hold
 * additional preset IDs; do not scrape those without an agreed schema walker.
 */
export function collectMappingPresetIds(mbMapping: MbMappingConfig): string[] {
  const ids = new Set<string>();
  if (mbMapping.defaultPresetId) ids.add(mbMapping.defaultPresetId);
  return [...ids];
}

export const DEFAULT_MB_MAPPING: MbMappingConfig = {
  version: 1,
  defaultPresetId: '',
  colors: [...DEFAULT_MB_WLED_COLORS],
  randomPool: {
    paletteIndices: defaultRandomPaletteIndices(),
    custom: [],
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
  paradeDetection: { ...DEFAULT_PARADE_DETECTION },
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

export function normalizeMbMapping(raw: Partial<MbMappingConfig> | undefined): MbMappingConfig {
  const d = DEFAULT_MB_MAPPING;
  if (!raw || raw.version !== 1) {
    return JSON.parse(JSON.stringify(d)) as MbMappingConfig;
  }
  const colors = Array.from({ length: 32 }, (_, i) => {
    const c = raw.colors?.[i];
    return c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : d.colors[i];
  });
  const segments = {} as Record<MbSegmentId, WledSegRef[]>;
  for (const { id } of MB_SEGMENT_META) {
    const src = raw.segments?.[id];
    segments[id] = src?.length
      ? src.map(s => withSegRefDefaults(s))
      : d.segments[id].map(s => withSegRefDefaults(s));
  }
  const base: MbMappingConfig = {
    version: 1,
    defaultPresetId: typeof raw.defaultPresetId === 'string' ? raw.defaultPresetId : '',
    colors,
    randomPool: normalizeRandomPool(raw.randomPool),
    segments,
    paradeDetection: normalizeParadeDetection(raw.paradeDetection),
  };
  if (Array.isArray((raw as { rules?: unknown }).rules)) {
    base.rules = (raw as { rules: unknown[] }).rules;
  }
  if (Array.isArray((raw as { segmentMaps?: unknown }).segmentMaps)) {
    base.segmentMaps = (raw as { segmentMaps: unknown[] }).segmentMaps;
  }
  return base;
}

/** Firmware BLE payload */
export function mbMappingToBlePayload(config: MbMappingConfig): object {
  const synced = normalizeMbMapping(config);
  const colors: Record<string, number[]> = {};
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
    defaultPresetId: synced.defaultPresetId || '',
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
    segments: synced.segments,
    ...(Array.isArray(synced.rules) ? { rules: synced.rules } : {}),
    ...(Array.isArray(synced.segmentMaps) ? { segmentMaps: synced.segmentMaps } : {}),
    paradeDetection: normalizeParadeDetection(synced.paradeDetection),
  };
}
