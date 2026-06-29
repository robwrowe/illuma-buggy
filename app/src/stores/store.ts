/**
 * store.ts — v2.2
 * Adds: CustomPalette, PaletteSet (park-specific palettes), activeZoneIds
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type RecallValue = 'always' | 'never' | 'memory';

export interface RecallState {
  effect:     RecallValue;
  palette:    RecallValue;
  parameters: RecallValue;
  color:      RecallValue;
  segments:   RecallValue;
}

export interface WledEffect  { id: number; name: string; metadata: string; }
export interface WledPalette { id: number; name: string; }

export interface CustomColor {
  r: number; g: number; b: number; // 0-255
}

export interface CustomPalette {
  id:     string;
  name:   string;
  colors: string[]; // hex strings e.g. "#ff0000"
}

/** A named collection of custom palettes for a specific context (e.g. "Magic Kingdom") */
export interface PaletteSet {
  id:         string;
  name:       string;            // e.g. "Magic Kingdom", "EPCOT", "Home"
  paletteIds: string[];          // ordered list of CustomPalette IDs to push to WLED
}

export interface PresetWled {
  on:      boolean;
  bri?:    number;
  fx?:     number;
  fxName?: string;
  pal?:    number;
  palName?: string;
  sx?:     number;
  ix?:     number;
  c1?:     number;
  c2?:     number;
  c3?:     number;
  o1?:     boolean;
  o2?:     boolean;
  o3?:     boolean;
  col?:    number[][];
  seg?:    object[];
}

export interface PresetMemory {
  effect:     boolean;
  palette:    boolean;
  parameters: boolean;
  color:      boolean;
  segments:   boolean;
}

export interface Preset {
  id:        string;
  name:      string;
  wled:      PresetWled;
  memory:    PresetMemory;
  createdAt: number;
}

export interface LatLng { latitude: number; longitude: number; }

export interface Zone {
  id:       string;
  name:     string;
  polygon:  LatLng[];
  presetId: string;
  enabled:  boolean;
}

export interface IndoorZone {
  id:      string;
  name:    string;
  polygon: LatLng[];
  enabled: boolean;
}

export interface BrightnessConfig {
  daytime:           number;
  nighttime:         number;
  indoor:            number;
  transitionMinutes: number;
  solarThresholdDeg: number;
}

export interface DeviceStatus {
  override:           number;
  killOnZone:           boolean;
  brightness:           number;
  currentPreset:        string;
  wifiConnected:        boolean;
  starlightEnabled:     boolean;
  starlightTimeoutMs:   number;
  magicBandEnabled:     boolean;
  mbFivePoint:          boolean;
  mbTimeoutMs:          number;
}

import {
  MbMappingConfig, DEFAULT_MB_MAPPING, normalizeMbMapping, mbMappingToBlePayload,
} from '../utils/mbConfig';

export type { MbMappingConfig, MbSegmentId, MbAnimationKey, MbPatternKey, MbEffectMapping, WledSegRef } from '../utils/mbConfig';
export {
  DEFAULT_MB_MAPPING, MB_COLOR_NAMES, MB_SEGMENT_META, MB_ANIMATION_META, MB_PATTERN_META,
  normalizeMbMapping, mbMappingToBlePayload,
} from '../utils/mbConfig';

// ─────────────────────────────────────────────
// Store interface
// ─────────────────────────────────────────────

interface AppState {
  // Presets
  presets: Preset[];
  setPresets: (presets: Preset[]) => void;
  addOrUpdatePreset: (preset: Preset) => void;
  removePreset: (id: string) => void;

  // WLED library cache
  wledEffects:     WledEffect[];
  wledPalettes:    WledPalette[];
  wledFxData:      string[];
  setWledEffects:  (effects: WledEffect[]) => void;
  setWledPalettes: (palettes: WledPalette[]) => void;
  setWledFxData:   (fxdata: string[]) => void;

  // Custom palettes
  customPalettes:      CustomPalette[];
  addCustomPalette:    (p: CustomPalette) => void;
  updateCustomPalette: (id: string, p: Partial<CustomPalette>) => void;
  removeCustomPalette: (id: string) => void;

  // Palette sets (park profiles)
  paletteSets:       PaletteSet[];
  activePaletteSetId: string | null;
  addPaletteSet:     (s: PaletteSet) => void;
  updatePaletteSet:  (id: string, s: Partial<PaletteSet>) => void;
  removePaletteSet:  (id: string) => void;
  setActivePaletteSet: (id: string | null) => void;

  // Recall state
  recallState:    RecallState;
  setRecallState: (state: Partial<RecallState>) => void;

  // Zones
  zones:             Zone[];
  setZones:          (zones: Zone[]) => void;
  addZone:           (zone: Zone) => void;
  updateZone:        (id: string, zone: Partial<Zone>) => void;
  removeZone:        (id: string) => void;
  indoorZones:       IndoorZone[];
  addIndoorZone:     (zone: IndoorZone) => void;
  updateIndoorZone:  (id: string, zone: Partial<IndoorZone>) => void;
  removeIndoorZone:  (id: string) => void;

  // Active zones (set by useZoneManager)
  activeZoneIds:    string[];
  setActiveZoneIds: (ids: string[]) => void;

  // Brightness
  brightnessConfig:    BrightnessConfig;
  setBrightnessConfig: (config: Partial<BrightnessConfig>) => void;

  // Device status
  deviceStatus:    DeviceStatus | null;
  setDeviceStatus: (status: DeviceStatus) => void;
  overrideDetail:  string | null;
  setOverrideDetail: (detail: string | null) => void;

  // Settings
  overrideKillOnZone:    boolean;
  setOverrideKillOnZone: (val: boolean) => void;
  starlightEnabled:      boolean;
  setStarlightEnabled:   (val: boolean) => void;
  starlightTimeoutSec:   number;
  setStarlightTimeoutSec:(val: number) => void;
  magicBandEnabled:      boolean;
  setMagicBandEnabled:   (val: boolean) => void;
  magicBandFivePoint:    boolean;
  setMagicBandFivePoint: (val: boolean) => void;
  magicBandTimeoutSec:   number;
  setMagicBandTimeoutSec:(val: number) => void;
  mbMapping:             MbMappingConfig;
  setMbMapping:          (config: MbMappingConfig) => void;
  updateMbMapping:       (patch: Partial<MbMappingConfig>) => void;
  zonesEnabled:          boolean;
  setZonesEnabled:       (val: boolean) => void;

  // Persistence
  loadFromStorage: () => Promise<void>;
  saveToStorage:   () => Promise<void>;
  ingestWledEffectsRaw:  (raw: string) => void;
  ingestWledPalettesRaw: (raw: string) => void;
  ingestWledFxDataRaw:   (raw: string) => void;
  syncBoardPresets:      (raw: string) => void;

  // Export / Import
  exportData: () => object;
  importData: (data: object) => void;
}

// ─────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────

const DEFAULT_BRIGHTNESS: BrightnessConfig = {
  daytime: 200, nighttime: 80, indoor: 120, transitionMinutes: 30, solarThresholdDeg: 6,
};

const DEFAULT_RECALL: RecallState = {
  effect: 'always', palette: 'always', parameters: 'memory', color: 'memory', segments: 'never',
};

const DEFAULT_PRESET_MEMORY: PresetMemory = {
  effect: true, palette: true, parameters: true, color: false, segments: false,
};

/** Normalize preset from board sync or legacy imports (firmware stores id/name/wled only). */
export function normalizePreset(p: Partial<Preset> & { id: string; name: string }): Preset {
  return {
    id:        p.id,
    name:      p.name,
    wled:      p.wled ?? { on: true },
    memory:    p.memory ?? DEFAULT_PRESET_MEMORY,
    createdAt: p.createdAt ?? Date.now(),
  };
}

// ─────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────

export const useAppStore = create<AppState>((set, get) => ({
  presets:             [],
  wledEffects:         [],
  wledPalettes:        [],
  wledFxData:          [],
  customPalettes:      [],
  paletteSets:         [],
  activePaletteSetId:  null,
  recallState:         DEFAULT_RECALL,
  zones:               [],
  indoorZones:         [],
  activeZoneIds:       [],
  deviceStatus:        null,
  overrideDetail:      null,
  overrideKillOnZone:  false,
  starlightEnabled:    true,
  starlightTimeoutSec: 15,
  magicBandEnabled:    true,
  magicBandFivePoint:  true,
  magicBandTimeoutSec: 15,
  mbMapping:           DEFAULT_MB_MAPPING,
  zonesEnabled:        true,
  brightnessConfig:    DEFAULT_BRIGHTNESS,

  // Presets
  setPresets: (presets) => set({ presets }),
  addOrUpdatePreset: (preset) => set(s => {
    const idx = s.presets.findIndex(p => p.id === preset.id);
    if (idx >= 0) { const u = [...s.presets]; u[idx] = preset; return { presets: u }; }
    return { presets: [...s.presets, preset] };
  }),
  removePreset: (id) => set(s => ({ presets: s.presets.filter(p => p.id !== id) })),

  // WLED cache
  setWledEffects:  (wledEffects)  => set({ wledEffects }),
  setWledPalettes: (wledPalettes) => set({ wledPalettes }),
  setWledFxData:   (wledFxData)   => set({ wledFxData }),

  // Custom palettes
  addCustomPalette:    (p)     => set(s => ({ customPalettes: [...s.customPalettes, p] })),
  updateCustomPalette: (id, p) => set(s => ({ customPalettes: s.customPalettes.map(cp => cp.id === id ? { ...cp, ...p } : cp) })),
  removeCustomPalette: (id)    => set(s => ({ customPalettes: s.customPalettes.filter(cp => cp.id !== id) })),

  // Palette sets
  addPaletteSet:    (ps)    => set(s => ({ paletteSets: [...s.paletteSets, ps] })),
  updatePaletteSet: (id, s) => set(st => ({ paletteSets: st.paletteSets.map(ps => ps.id === id ? { ...ps, ...s } : ps) })),
  removePaletteSet: (id)    => set(s => ({ paletteSets: s.paletteSets.filter(ps => ps.id !== id) })),
  setActivePaletteSet: (id) => set({ activePaletteSetId: id }),

  // Recall
  setRecallState: (partial) => set(s => ({ recallState: { ...s.recallState, ...partial } })),

  // Zones
  setZones:         (zones)     => set({ zones }),
  addZone:          (zone)      => set(s => ({ zones: [...s.zones, zone] })),
  updateZone:       (id, zone)  => set(s => ({ zones: s.zones.map(z => z.id === id ? { ...z, ...zone } : z) })),
  removeZone:       (id)        => set(s => ({ zones: s.zones.filter(z => z.id !== id) })),
  addIndoorZone:    (zone)      => set(s => ({ indoorZones: [...s.indoorZones, zone] })),
  updateIndoorZone: (id, zone)  => set(s => ({ indoorZones: s.indoorZones.map(z => z.id === id ? { ...z, ...zone } : z) })),
  removeIndoorZone: (id)        => set(s => ({ indoorZones: s.indoorZones.filter(z => z.id !== id) })),
  setActiveZoneIds: (activeZoneIds) => set({ activeZoneIds }),

  // Brightness
  setBrightnessConfig: (config) => set(s => ({ brightnessConfig: { ...s.brightnessConfig, ...config } })),

  // Device
  setDeviceStatus:       (deviceStatus) => set({ deviceStatus }),
  setOverrideDetail:     (overrideDetail) => set({ overrideDetail }),
  setOverrideKillOnZone: (val)          => set({ overrideKillOnZone: val }),
  setStarlightEnabled:   (val)          => set({ starlightEnabled: val }),
  setStarlightTimeoutSec:(val)          => set({ starlightTimeoutSec: val }),
  setMagicBandEnabled:   (val)          => set({ magicBandEnabled: val }),
  setMagicBandFivePoint: (val)          => set({ magicBandFivePoint: val }),
  setMagicBandTimeoutSec:(val)          => set({ magicBandTimeoutSec: val }),
  setMbMapping:          (mbMapping)   => set({ mbMapping: normalizeMbMapping(mbMapping) }),
  updateMbMapping:       (patch)       => set(s => ({ mbMapping: normalizeMbMapping({ ...s.mbMapping, ...patch }) })),
  setZonesEnabled:       (val)          => set({ zonesEnabled: val }),

  // Persistence
  loadFromStorage: async () => {
    try {
      const keys = ['presets','zones','indoorZones','brightnessConfig','overrideKillOnZone',
                    'starlightEnabled','starlightTimeoutSec','magicBandEnabled',
                    'magicBandFivePoint','magicBandTimeoutSec','mbMapping',
                    'recallState',
                    'customPalettes','paletteSets','activePaletteSetId',
                    'wledEffects','wledPalettes','wledFxData'];
      const pairs = await AsyncStorage.multiGet(keys);
      const d: Record<string, any> = {};
      pairs.forEach(([k, v]) => { if (v) d[k] = JSON.parse(v); });
      set({
        presets:            (d.presets ?? []).map((p: Preset) => normalizePreset(p)),
        zones:              d.zones              ?? [],
        indoorZones:        d.indoorZones        ?? [],
        brightnessConfig:   d.brightnessConfig   ?? DEFAULT_BRIGHTNESS,
        overrideKillOnZone: d.overrideKillOnZone ?? false,
        starlightEnabled:   d.starlightEnabled   ?? true,
        starlightTimeoutSec:d.starlightTimeoutSec ?? 15,
        magicBandEnabled:   d.magicBandEnabled   ?? true,
        magicBandFivePoint: d.magicBandFivePoint ?? true,
        magicBandTimeoutSec:d.magicBandTimeoutSec ?? 15,
        mbMapping:          normalizeMbMapping(d.mbMapping),
        recallState:        d.recallState        ?? DEFAULT_RECALL,
        customPalettes:     d.customPalettes     ?? [],
        paletteSets:        d.paletteSets        ?? [],
        activePaletteSetId: d.activePaletteSetId ?? null,
        wledEffects:        d.wledEffects        ?? [],
        wledPalettes:       d.wledPalettes       ?? [],
        wledFxData:         d.wledFxData         ?? [],
      });
    } catch (e) { console.error('[Store] Load error:', e); }
  },

  saveToStorage: async () => {
    try {
      const s = get();
      await AsyncStorage.multiSet([
        ['presets',            JSON.stringify(s.presets)],
        ['zones',              JSON.stringify(s.zones)],
        ['indoorZones',        JSON.stringify(s.indoorZones)],
        ['brightnessConfig',   JSON.stringify(s.brightnessConfig)],
        ['overrideKillOnZone', JSON.stringify(s.overrideKillOnZone)],
        ['starlightEnabled',   JSON.stringify(s.starlightEnabled)],
        ['starlightTimeoutSec',JSON.stringify(s.starlightTimeoutSec)],
        ['magicBandEnabled',   JSON.stringify(s.magicBandEnabled)],
        ['magicBandFivePoint', JSON.stringify(s.magicBandFivePoint)],
        ['magicBandTimeoutSec',JSON.stringify(s.magicBandTimeoutSec)],
        ['mbMapping',          JSON.stringify(s.mbMapping)],
        ['recallState',        JSON.stringify(s.recallState)],
        ['customPalettes',     JSON.stringify(s.customPalettes)],
        ['paletteSets',        JSON.stringify(s.paletteSets)],
        ['activePaletteSetId', JSON.stringify(s.activePaletteSetId)],
        ['wledEffects',        JSON.stringify(s.wledEffects)],
        ['wledPalettes',       JSON.stringify(s.wledPalettes)],
        ['wledFxData',         JSON.stringify(s.wledFxData)],
      ]);
    } catch (e) { console.error('[Store] Save error:', e); }
  },

  ingestWledEffectsRaw: (raw) => {
    try {
      const fxData = get().wledFxData;
      const arr = JSON.parse(raw) as string[];
      const effects: WledEffect[] = arr
        .map((name, id) => ({ id, name, metadata: fxData[id] ?? '' }))
        .filter(e => e.name !== 'RSVD' && e.name !== '-');
      set({ wledEffects: effects });
      get().saveToStorage();
    } catch (e) { console.error('[Store] Effects ingest error:', e); }
  },

  ingestWledPalettesRaw: (raw) => {
    try {
      const arr = JSON.parse(raw) as string[];
      set({ wledPalettes: arr.map((name, id) => ({ id, name })) });
      get().saveToStorage();
    } catch (e) { console.error('[Store] Palettes ingest error:', e); }
  },

  ingestWledFxDataRaw: (raw) => {
    try {
      const arr = JSON.parse(raw) as string[];
      set({ wledFxData: arr });
      const effects = get().wledEffects;
      if (effects.length > 0) {
        set({ wledEffects: effects.map(e => ({ ...e, metadata: arr[e.id] ?? '' })) });
      }
      get().saveToStorage();
    } catch (e) { console.error('[Store] FxData ingest error:', e); }
  },

  syncBoardPresets: (raw) => {
    try {
      const trimmed = (raw ?? '').trim();
      if (!trimmed) return;
      const start = trimmed.indexOf('[');
      const end = trimmed.lastIndexOf(']');
      if (start === -1 || end <= start) return;
      const json = trimmed.slice(start, end + 1);
      if (json === '[]') return;
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) return;
      const existingById = Object.fromEntries(get().presets.map(p => [p.id, p]));
      const fromBoard = parsed.map((p: Partial<Preset> & { id: string; name: string }) => {
        const local = existingById[p.id];
        return normalizePreset({
          ...local,
          ...p,
          memory: p.memory ?? local?.memory,
        });
      });
      const boardIds = new Set(fromBoard.map(p => p.id));
      const phoneOnly = get().presets.filter(p => !boardIds.has(p.id));
      set({ presets: [...fromBoard, ...phoneOnly] });
      get().saveToStorage();
    } catch (e) { console.error('[Store] Board preset sync error:', e); }
  },

  exportData: () => {
    const s = get();
    return {
      version: '2.2', exportedAt: new Date().toISOString(),
      presets: s.presets, zones: s.zones, indoorZones: s.indoorZones,
      brightnessConfig: s.brightnessConfig, recallState: s.recallState,
      overrideKillOnZone: s.overrideKillOnZone,
      starlightEnabled:   s.starlightEnabled,   starlightTimeoutSec: s.starlightTimeoutSec,
      magicBandEnabled:   s.magicBandEnabled,   magicBandFivePoint: s.magicBandFivePoint,
      magicBandTimeoutSec:s.magicBandTimeoutSec,
      mbMapping:          s.mbMapping,
      customPalettes: s.customPalettes, paletteSets: s.paletteSets,
    };
  },

  importData: (data: any) => {
    set({
      presets:            data.presets            ?? [],
      zones:              data.zones              ?? [],
      indoorZones:        data.indoorZones        ?? [],
      brightnessConfig:   data.brightnessConfig   ?? DEFAULT_BRIGHTNESS,
      recallState:        data.recallState        ?? DEFAULT_RECALL,
      overrideKillOnZone: data.overrideKillOnZone ?? false,
      starlightEnabled:   data.starlightEnabled   ?? true,
      starlightTimeoutSec:data.starlightTimeoutSec ?? 15,
      magicBandEnabled:   data.magicBandEnabled   ?? true,
      magicBandFivePoint: data.magicBandFivePoint ?? true,
      magicBandTimeoutSec:data.magicBandTimeoutSec ?? 15,
      mbMapping:          normalizeMbMapping(data.mbMapping),
      customPalettes:     data.customPalettes     ?? [],
      paletteSets:        data.paletteSets        ?? [],
    });
    get().saveToStorage();
  },
}));

// ─────────────────────────────────────────────
// Recall helper
// ─────────────────────────────────────────────

const DEFAULT_RECALL_FALLBACK: RecallState = {
  effect: 'always', palette: 'always', parameters: 'memory', color: 'memory', segments: 'never',
};

export function buildRecallPayload(preset: Preset, recall: RecallState | undefined): object {
  if (!recall) recall = DEFAULT_RECALL_FALLBACK;
  const w = preset.wled ?? { on: true };
  const m = preset.memory ?? DEFAULT_PRESET_MEMORY;
  const payload: any = { on: true };

  const should = (prop: keyof RecallState, memVal: boolean): boolean => {
    const r = recall![prop];
    if (r === 'always') return true;
    if (r === 'never')  return false;
    return memVal;
  };

  if (should('effect', m.effect) && w.fx !== undefined)   { payload.seg = payload.seg ?? [{}]; payload.seg[0].fx = w.fx; }
  if (should('palette', m.palette) && w.pal !== undefined) { payload.seg = payload.seg ?? [{}]; payload.seg[0].pal = w.pal; }
  if (should('parameters', m.parameters)) {
    payload.seg = payload.seg ?? [{}];
    if (w.sx !== undefined) payload.seg[0].sx = w.sx;
    if (w.ix !== undefined) payload.seg[0].ix = w.ix;
    if (w.c1 !== undefined) payload.seg[0].c1 = w.c1;
    if (w.c2 !== undefined) payload.seg[0].c2 = w.c2;
    if (w.c3 !== undefined) payload.seg[0].c3 = w.c3;
    if (w.o1 !== undefined) payload.seg[0].o1 = w.o1;
    if (w.o2 !== undefined) payload.seg[0].o2 = w.o2;
    if (w.o3 !== undefined) payload.seg[0].o3 = w.o3;
  }
  if (should('color', m.color) && w.col !== undefined)       { payload.seg = payload.seg ?? [{}]; payload.seg[0].col = w.col; }
  if (should('segments', m.segments) && w.seg !== undefined) { payload.seg = w.seg; }

  return payload;
}

// ─────────────────────────────────────────────
// Custom palette → WLED format
// Converts hex colors to WLED custom palette JSON
// WLED supports up to 10 custom palettes via /json/cfg
// ─────────────────────────────────────────────

export function buildWledCustomPalette(palette: CustomPalette): number[][] {
  // WLED custom palette format: array of [position, r, g, b]
  // position 0-255 spread evenly across colors
  return palette.colors.map((hex, i) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const pos = Math.round((i / Math.max(palette.colors.length - 1, 1)) * 255);
    return [pos, r, g, b];
  });
}
