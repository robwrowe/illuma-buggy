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

export const MB_PALETTE: { color: string; description: string; hex: string }[] = [
  { color: 'Green', description: 'Very light mint green', hex: '#e0ffe6' },
  { color: 'Blue', description: 'Light sky blue', hex: '#99bdff' },
  { color: 'Blue', description: 'Medium royal blue', hex: '#576aff' },
  { color: 'Blue', description: 'Bright cornflower blue', hex: '#5985ff' },
  { color: 'Blue', description: 'Deep vivid blue', hex: '#1c33ff' },
  { color: 'Purple', description: 'Light lavender pink', hex: '#e2a3ff' },
  { color: 'Purple', description: 'Very light periwinkle', hex: '#d5baff' },
  { color: 'Purple', description: 'Light orchid', hex: '#d7a6ff' },
  { color: 'Purple', description: 'Bright purple-pink', hex: '#d470ff' },
  { color: 'Pink', description: 'Bright pink', hex: '#ffa3fc' },
  { color: 'Pink', description: 'Soft bright pink', hex: '#ec9eff' },
  { color: 'Pink', description: 'Vibrant hot pink', hex: '#f678ff' },
  { color: 'Pink', description: 'Bright pink-purple', hex: '#e485ff' },
  { color: 'Pink', description: 'Strong neon magenta', hex: '#f86eff' },
  { color: 'Red', description: 'Bright cherry red', hex: '#ff3856' },
  { color: 'Yellow', description: 'Bright golden yellow', hex: '#ffbb00' },
  { color: 'Yellow', description: 'Pale lemon yellow', hex: '#ffff8e' },
  { color: 'Yellow', description: 'Strong golden yellow', hex: '#ffdd00' },
  { color: 'Yellow', description: 'Electric chartreuse', hex: '#ccff00' },
  { color: 'Orange', description: 'Bright orange', hex: '#ff9d00' },
  { color: 'Orange', description: 'Vivid orange', hex: '#ff7300' },
  { color: 'Red', description: 'Bright red-orange', hex: '#ff2200' },
  { color: 'Teal', description: 'Bright cyan', hex: '#00ffea' },
  { color: 'Teal', description: 'Bright mint aqua', hex: '#66ffd1' },
  { color: 'Teal', description: 'Light cyan', hex: '#8fffee' },
  { color: 'Green', description: 'Bright lime green', hex: '#00ff26' },
  { color: 'Yellow', description: 'Bright neon yellow-green', hex: '#afff03' },
  { color: 'White', description: 'Very light lavender blue', hex: '#eceeff' },
  { color: 'White', description: 'Pure white', hex: '#ffffff' },
  { color: 'Black', description: 'Pure black', hex: '#000000' },
];

export const MB_COLOR_NAMES: string[] = [
  ...MB_PALETTE.map((p) => p.color),
  'Unique',
  'Random',
];

export function mbPaletteLabel(idx: number): string {
  if (!Number.isInteger(idx) || idx < 0) return String(idx);
  if (idx < MB_PALETTE.length) {
    const p = MB_PALETTE[idx];
    return `${idx} - ${p.color} - ${p.description}`;
  }
  if (idx === 30) return '30 - Unique - Runtime unique color';
  if (idx === 31) return '31 - Random - Runtime random from pool';
  return String(idx);
}

/** Sensible WLED defaults for each MB palette index */
export const DEFAULT_MB_WLED_COLORS: string[] = [
  ...MB_PALETTE.map((p) => p.hex),
  '#ff9933',
  '#ff00ff',
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

/** Firmware BLE payload (verbose editor shape — not for transport). */
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

/** Wire sentinel for segmentOverrides mode "default". Absent key = stored. */
const SEG_OVERRIDE_DEFAULT_SENTINEL = 'd';
const SEG_OVERRIDE_PROPS = ['fx', 'pal', 'sx', 'ix', 'blend'] as const;

function compactSegmentOverrides(segmentOverrides: unknown): Record<string, unknown> | undefined {
  if (!segmentOverrides || typeof segmentOverrides !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [segId, seg] of Object.entries(segmentOverrides as Record<string, unknown>)) {
    if (!seg || typeof seg !== 'object') continue;
    const segObj = seg as Record<string, unknown>;
    const compactSeg: Record<string, unknown> = {};
    for (const field of SEG_OVERRIDE_PROPS) {
      const ov = segObj[field] as { mode?: string; value?: unknown } | undefined;
      if (!ov || typeof ov !== 'object') continue;
      if (ov.mode === 'custom' && ov.value !== undefined && ov.value !== null && ov.value !== '') {
        compactSeg[field] = ov.value;
      } else if (ov.mode === 'default') {
        compactSeg[field] = SEG_OVERRIDE_DEFAULT_SENTINEL;
      }
    }
    if (Array.isArray(segObj.colors)) {
      const compactColors: { i: number; v: unknown }[] = [];
      (segObj.colors as { mode?: string; value?: unknown }[]).forEach((c, i) => {
        if (c?.mode === 'custom' && c.value) compactColors.push({ i, v: c.value });
      });
      if (compactColors.length) compactSeg.colors = compactColors;
    }
    if (Object.keys(compactSeg).length) out[segId] = compactSeg;
  }
  return Object.keys(out).length ? out : undefined;
}

function compactExtractTargets(targets: unknown): unknown[] | undefined {
  if (!Array.isArray(targets)) return undefined;
  const out: unknown[] = [];
  for (const t of targets) {
    if (!t || typeof t !== 'object') continue;
    const tgt = t as Record<string, unknown>;
    const kind = (tgt.kind as string) || 'segmentColor';
    if (kind === 'ignore') continue;
    if (kind === 'segmentColor') {
      const entry: Record<string, unknown> = {};
      if (typeof tgt.segmentId === 'string' && tgt.segmentId) entry.s = tgt.segmentId;
      if (Array.isArray(tgt.segmentIds) && tgt.segmentIds.length) entry.ss = tgt.segmentIds;
      if (tgt.colorSlot !== undefined && tgt.colorSlot !== null) entry.c = tgt.colorSlot;
      if (entry.s || entry.ss) out.push(entry);
      continue;
    }
    if (kind === 'maskColor') {
      out.push({ k: 'maskColor', m: tgt.mask || 'all' });
      continue;
    }
    out.push({ ...tgt });
  }
  return out.length ? out : undefined;
}

function compactRule(rule: unknown): unknown {
  if (!rule || typeof rule !== 'object') return rule;
  const r = rule as Record<string, unknown>;
  const next: Record<string, unknown> = { ...r };
  const ov = compactSegmentOverrides(r.segmentOverrides);
  if (ov) next.segmentOverrides = ov;
  else delete next.segmentOverrides;
  if (Array.isArray(r.extract)) {
    next.extract = r.extract.map((ex) => {
      if (!ex || typeof ex !== 'object') return ex;
      const e = ex as Record<string, unknown>;
      const targets = compactExtractTargets(e.targets);
      const { targets: _drop, ...rest } = e;
      return targets ? { ...rest, targets } : { ...rest };
    });
  }
  return next;
}

/**
 * Compact set_mb_rules payload for BLE transport.
 * Keep in sync with web compactMbPayloadForBle — see docs/ble-packets-details/mb-rules-wire-format.md.
 */
export function compactMbPayloadForBle(config: MbMappingConfig): object {
  const verbose = mbMappingToBlePayload(config) as Record<string, unknown>;
  const rules = Array.isArray(verbose.rules) ? verbose.rules.map(compactRule) : undefined;
  return rules ? { ...verbose, rules } : verbose;
}
