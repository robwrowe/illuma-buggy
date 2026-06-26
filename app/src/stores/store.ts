/**
 * store.ts
 * Global app state via Zustand.
 * Covers: presets, device status, zones, brightness config, settings.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface Preset {
  id:   string;
  name: string;
  wled: object;
}

export interface LatLng {
  latitude:  number;
  longitude: number;
}

export interface Zone {
  id:        string;
  name:      string;
  polygon:   LatLng[];
  presetId:  string;
  enabled:   boolean;
}

export interface IndoorZone {
  id:       string;
  name:     string;
  polygon:  LatLng[];
  enabled:  boolean;
}

export interface BrightnessConfig {
  daytime:          number;  // 0-255
  nighttime:        number;  // 0-255
  indoor:           number;  // 0-255
  transitionMinutes: number; // ramp window around solar threshold
  solarThresholdDeg: number; // sun elevation angle for day/night crossover
}

export interface DeviceStatus {
  override:     number;  // 0=NONE 1=ZONE 2=MANUAL 3=BLE_MAGIC
  killOnZone:   boolean;
  brightness:   number;
  currentPreset: string;
  wifiConnected: boolean;
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

  // Brightness config
  brightnessConfig: BrightnessConfig;
  setBrightnessConfig: (config: Partial<BrightnessConfig>) => void;

  // Device status (from board)
  deviceStatus: DeviceStatus | null;
  setDeviceStatus: (status: DeviceStatus) => void;

  // Settings
  overrideKillOnZone: boolean;
  setOverrideKillOnZone: (val: boolean) => void;

  // Persistence
  loadFromStorage: () => Promise<void>;
  saveToStorage: () => Promise<void>;
}

const DEFAULT_BRIGHTNESS: BrightnessConfig = {
  daytime:           200,
  nighttime:         80,
  indoor:            120,
  transitionMinutes: 30,
  solarThresholdDeg: 6,  // civil twilight
};

export const useAppStore = create<AppState>((set, get) => ({
  presets:     [],
  zones:       [],
  indoorZones: [],
  deviceStatus: null,
  overrideKillOnZone: false,
  brightnessConfig: DEFAULT_BRIGHTNESS,

  // ── Presets ──
  setPresets: (presets) => set({ presets }),
  addOrUpdatePreset: (preset) => set((s) => {
    const existing = s.presets.findIndex((p) => p.id === preset.id);
    if (existing >= 0) {
      const updated = [...s.presets];
      updated[existing] = preset;
      return { presets: updated };
    }
    return { presets: [...s.presets, preset] };
  }),
  removePreset: (id) => set((s) => ({
    presets: s.presets.filter((p) => p.id !== id),
  })),

  // ── Zones ──
  setZones: (zones) => set({ zones }),
  addZone: (zone) => set((s) => ({ zones: [...s.zones, zone] })),
  updateZone: (id, zone) => set((s) => ({
    zones: s.zones.map((z) => z.id === id ? { ...z, ...zone } : z),
  })),
  removeZone: (id) => set((s) => ({
    zones: s.zones.filter((z) => z.id !== id),
  })),

  // ── Indoor zones ──
  addIndoorZone: (zone) => set((s) => ({ indoorZones: [...s.indoorZones, zone] })),
  updateIndoorZone: (id, zone) => set((s) => ({
    indoorZones: s.indoorZones.map((z) => z.id === id ? { ...z, ...zone } : z),
  })),
  removeIndoorZone: (id) => set((s) => ({
    indoorZones: s.indoorZones.filter((z) => z.id !== id),
  })),

  // ── Brightness ──
  setBrightnessConfig: (config) => set((s) => ({
    brightnessConfig: { ...s.brightnessConfig, ...config },
  })),

  // ── Device status ──
  setDeviceStatus: (status) => set({ deviceStatus: status }),

  // ── Settings ──
  setOverrideKillOnZone: (val) => set({ overrideKillOnZone: val }),

  // ── Persistence ──
  loadFromStorage: async () => {
    try {
      const keys = ['zones', 'indoorZones', 'brightnessConfig', 'overrideKillOnZone'];
      const pairs = await AsyncStorage.multiGet(keys);
      const data: Record<string, unknown> = {};
      pairs.forEach(([key, val]) => {
        if (val) data[key] = JSON.parse(val);
      });
      set({
        zones:              (data.zones as Zone[])              ?? [],
        indoorZones:        (data.indoorZones as IndoorZone[])  ?? [],
        brightnessConfig:   (data.brightnessConfig as BrightnessConfig) ?? DEFAULT_BRIGHTNESS,
        overrideKillOnZone: (data.overrideKillOnZone as boolean) ?? false,
      });
    } catch (e) {
      console.error('[Store] Load error:', e);
    }
  },

  saveToStorage: async () => {
    try {
      const s = get();
      await AsyncStorage.multiSet([
        ['zones',              JSON.stringify(s.zones)],
        ['indoorZones',        JSON.stringify(s.indoorZones)],
        ['brightnessConfig',   JSON.stringify(s.brightnessConfig)],
        ['overrideKillOnZone', JSON.stringify(s.overrideKillOnZone)],
      ]);
    } catch (e) {
      console.error('[Store] Save error:', e);
    }
  },
}));
