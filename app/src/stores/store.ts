/**
 * store.ts — v2.1
 * Adds: WledLibrary cache, RecallState, preset metadata, export/import
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
  parameters: RecallValue;  // speed, intensity, c1/c2/c3, o1/o2/o3
  color:      RecallValue;
  segments:   RecallValue;
}

export interface WledEffect {
  id:       number;
  name:     string;
  metadata: string;  // raw fxdata string e.g. "!,!;;!;1;sx=24,pal=50"
}

export interface WledPalette {
  id:   number;
  name: string;
}

export interface PresetWled {
  // Core
  on:   boolean;
  bri?: number;
  // Segment 0 (primary)
  fx?:  number;   // effect ID
  fxName?: string;
  pal?: number;   // palette ID
  palName?: string;
  sx?:  number;   // speed 0-255
  ix?:  number;   // intensity 0-255
  c1?:  number;
  c2?:  number;
  c3?:  number;
  o1?:  boolean;
  o2?:  boolean;
  o3?:  boolean;
  col?: number[][];  // colors
  // Full segment array (optional, for multi-segment presets)
  seg?: object[];
}

export interface PresetMemory {
  effect:     boolean;
  palette:    boolean;
  parameters: boolean;
  color:      boolean;
  segments:   boolean;
}

export interface Preset {
  id:       string;
  name:     string;
  wled:     PresetWled;
  memory:   PresetMemory;  // what the user wanted recalled at capture time
  createdAt: number;
}

export interface LatLng {
  latitude:  number;
  longitude: number;
}

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
  override:       number;
  killOnZone:     boolean;
  brightness:     number;
  currentPreset:  string;
  wifiConnected:  boolean;
  mbFivePoint:    boolean;
}

// ─────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────

interface AppState {
  // Presets
  presets: Preset[];
  setPresets: (presets: Preset[]) => void;
  addOrUpdatePreset: (preset: Preset) => void;
  removePreset: (id: string) => void;

  // WLED library cache (fetched from device, not persisted)
  wledEffects:  WledEffect[];
  wledPalettes: WledPalette[];
  wledFxData:   string[];  // raw metadata strings, index = effect ID
  setWledEffects:  (effects: WledEffect[]) => void;
  setWledPalettes: (palettes: WledPalette[]) => void;
  setWledFxData:   (fxdata: string[]) => void;

  // Recall state
  recallState: RecallState;
  setRecallState: (state: Partial<RecallState>) => void;

  // Zones
  zones: Zone[];
  setZones: (zones: Zone[]) => void;
  addZone: (zone: Zone) => void;
  updateZone: (id: string, zone: Partial<Zone>) => void;
  removeZone: (id: string) => void;

  // Indoor zones
  indoorZones: IndoorZone[];
  addIndoorZone: (zone: IndoorZone) => void;
  updateIndoorZone: (id: string, zone: Partial<IndoorZone>) => void;
  removeIndoorZone: (id: string) => void;

  // Brightness
  brightnessConfig: BrightnessConfig;
  setBrightnessConfig: (config: Partial<BrightnessConfig>) => void;

  // Device status
  deviceStatus: DeviceStatus | null;
  setDeviceStatus: (status: DeviceStatus) => void;

  // Settings
  overrideKillOnZone: boolean;
  setOverrideKillOnZone: (val: boolean) => void;
  magicBandFivePoint: boolean;
  setMagicBandFivePoint: (val: boolean) => void;
  zonesEnabled: boolean;
  setZonesEnabled: (val: boolean) => void;

  // Persistence
  loadFromStorage: () => Promise<void>;
  saveToStorage:   () => Promise<void>;

  // Export / Import
  exportData: () => object;
  importData: (data: object) => void;
}

const DEFAULT_BRIGHTNESS: BrightnessConfig = {
  daytime:           200,
  nighttime:         80,
  indoor:            120,
  transitionMinutes: 30,
  solarThresholdDeg: 6,
};

const DEFAULT_RECALL: RecallState = {
  effect:     'always',
  palette:    'always',
  parameters: 'memory',
  color:      'memory',
  segments:   'never',
};

export const useAppStore = create<AppState>((set, get) => ({
  presets:         [],
  wledEffects:     [],
  wledPalettes:    [],
  wledFxData:      [],
  recallState:     DEFAULT_RECALL,
  zones:           [],
  indoorZones:     [],
  deviceStatus:    null,
  overrideKillOnZone: false,
  magicBandFivePoint: true,
  zonesEnabled: true,
  brightnessConfig: DEFAULT_BRIGHTNESS,

  // ── Presets ──
  setPresets: (presets) => set({ presets }),
  addOrUpdatePreset: (preset) => set((s) => {
    const idx = s.presets.findIndex(p => p.id === preset.id);
    if (idx >= 0) {
      const updated = [...s.presets];
      updated[idx] = preset;
      return { presets: updated };
    }
    return { presets: [...s.presets, preset] };
  }),
  removePreset: (id) => set(s => ({ presets: s.presets.filter(p => p.id !== id) })),

  // ── WLED library ──
  setWledEffects:  (wledEffects)  => set({ wledEffects }),
  setWledPalettes: (wledPalettes) => set({ wledPalettes }),
  setWledFxData:   (wledFxData)   => set({ wledFxData }),

  // ── Recall state ──
  setRecallState: (partial) => set(s => ({
    recallState: { ...s.recallState, ...partial }
  })),

  // ── Zones ──
  setZones:       (zones) => set({ zones }),
  addZone:        (zone)  => set(s => ({ zones: [...s.zones, zone] })),
  updateZone:     (id, zone) => set(s => ({ zones: s.zones.map(z => z.id === id ? { ...z, ...zone } : z) })),
  removeZone:     (id) => set(s => ({ zones: s.zones.filter(z => z.id !== id) })),
  addIndoorZone:  (zone) => set(s => ({ indoorZones: [...s.indoorZones, zone] })),
  updateIndoorZone: (id, zone) => set(s => ({ indoorZones: s.indoorZones.map(z => z.id === id ? { ...z, ...zone } : z) })),
  removeIndoorZone: (id) => set(s => ({ indoorZones: s.indoorZones.filter(z => z.id !== id) })),

  // ── Brightness ──
  setBrightnessConfig: (config) => set(s => ({ brightnessConfig: { ...s.brightnessConfig, ...config } })),

  // ── Device ──
  setDeviceStatus: (deviceStatus) => set({ deviceStatus }),
  setOverrideKillOnZone: (val) => set({ overrideKillOnZone: val }),
  setMagicBandFivePoint: (val) => set({ magicBandFivePoint: val }),
  setZonesEnabled: (val) => set({ zonesEnabled: val }),

  // ── Persistence ──
  loadFromStorage: async () => {
    try {
      const keys = ['presets', 'zones', 'indoorZones', 'brightnessConfig', 'overrideKillOnZone', 'magicBandFivePoint', 'recallState'];
      const pairs = await AsyncStorage.multiGet(keys);
      const data: Record<string, any> = {};
      pairs.forEach(([key, val]) => { if (val) data[key] = JSON.parse(val); });
      set({
        presets:            data.presets            ?? [],
        zones:              data.zones              ?? [],
        indoorZones:        data.indoorZones        ?? [],
        brightnessConfig:   data.brightnessConfig   ?? DEFAULT_BRIGHTNESS,
        overrideKillOnZone: data.overrideKillOnZone ?? false,
        magicBandFivePoint: data.magicBandFivePoint ?? true,
        recallState:        data.recallState        ?? DEFAULT_RECALL,
      });
    } catch (e) {
      console.error('[Store] Load error:', e);
    }
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
        ['magicBandFivePoint', JSON.stringify(s.magicBandFivePoint)],
        ['recallState',        JSON.stringify(s.recallState)],
      ]);
    } catch (e) {
      console.error('[Store] Save error:', e);
    }
  },

  // ── Export / Import ──
  exportData: () => {
    const s = get();
    return {
      version: '2.1',
      exportedAt: new Date().toISOString(),
      presets:            s.presets,
      zones:              s.zones,
      indoorZones:        s.indoorZones,
      brightnessConfig:   s.brightnessConfig,
      recallState:        s.recallState,
      overrideKillOnZone: s.overrideKillOnZone,
      magicBandFivePoint: s.magicBandFivePoint,
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
      magicBandFivePoint: data.magicBandFivePoint ?? true,
    });
    get().saveToStorage();
  },
}));

// ─────────────────────────────────────────────
// Recall helper — build WLED payload from preset
// applying the global recall state + per-preset memory
// ─────────────────────────────────────────────

const DEFAULT_RECALL_FALLBACK: RecallState = {
  effect: 'always', palette: 'always', parameters: 'memory',
  color: 'memory', segments: 'never',
};

export function buildRecallPayload(preset: Preset, recall: RecallState | undefined): object {
  if (!recall) recall = DEFAULT_RECALL_FALLBACK;
  const w = preset.wled;
  const m = preset.memory;
  const payload: any = { on: true };

  const should = (prop: keyof RecallState, memVal: boolean): boolean => {
    const r = recall[prop];
    if (r === 'always') return true;
    if (r === 'never')  return false;
    return memVal; // 'memory'
  };

  if (should('effect', m.effect) && w.fx !== undefined) {
    payload.seg = payload.seg ?? [{}];
    payload.seg[0].fx = w.fx;
  }
  if (should('palette', m.palette) && w.pal !== undefined) {
    payload.seg = payload.seg ?? [{}];
    payload.seg[0].pal = w.pal;
  }
  if (should('parameters', m.parameters)) {
    payload.seg = payload.seg ?? [{}];
    if (w.sx  !== undefined) payload.seg[0].sx  = w.sx;
    if (w.ix  !== undefined) payload.seg[0].ix  = w.ix;
    if (w.c1  !== undefined) payload.seg[0].c1  = w.c1;
    if (w.c2  !== undefined) payload.seg[0].c2  = w.c2;
    if (w.c3  !== undefined) payload.seg[0].c3  = w.c3;
    if (w.o1  !== undefined) payload.seg[0].o1  = w.o1;
    if (w.o2  !== undefined) payload.seg[0].o2  = w.o2;
    if (w.o3  !== undefined) payload.seg[0].o3  = w.o3;
  }
  if (should('color', m.color) && w.col !== undefined) {
    payload.seg = payload.seg ?? [{}];
    payload.seg[0].col = w.col;
  }
  if (should('segments', m.segments) && w.seg !== undefined) {
    payload.seg = w.seg;
  }

  return payload;
}
