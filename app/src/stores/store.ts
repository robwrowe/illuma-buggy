/**
 * store.ts — v2.2
 * Adds: CustomPalette, PaletteSet (park-specific palettes), activeZoneIds
 */

import { normalizeTags } from '../utils/tags';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

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

export interface SavedColor {
  id: string;
  name: string;
  hex: string;
  tags?: string[];
}

export interface CustomPalette {
  id:     string;
  name:   string;
  colors: string[]; // hex strings e.g. "#ff0000"
  tags?:  string[];
  /** WLED /paletteN.json slot (0-based), assigned on sync */
  wledPdSlot?: number;
  /** WLED segment pal index (200 - wledPdSlot on v16+) */
  wledPalId?:  number;
}

/** A named collection of custom palettes for a specific context (e.g. "Magic Kingdom") */
export interface PaletteSet {
  id:         string;
  name:       string;            // e.g. "Magic Kingdom", "EPCOT", "Home"
  paletteIds: string[];          // ordered list of CustomPalette IDs to push to WLED
  tags?:      string[];
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
  tags?:     string[];
  /** Saved segment layout library item (used when recall includes segments). */
  segmentLayoutId?: string;
  createdAt: number;
}

export interface LatLng { latitude: number; longitude: number; }

export interface Zone {
  id:       string;
  name:     string;
  polygon:  LatLng[];
  presetId: string;
  enabled:  boolean;
  parkId?:  string;
}

export interface IndoorZone {
  id:      string;
  name:    string;
  polygon: LatLng[];
  enabled: boolean;
  parkId?: string;
}

export interface BrightnessConfig {
  daytime:           number;
  nighttime:         number;
  indoor:            number;
  transitionMinutes: number;
  solarThresholdDeg: number;
}

export type BoardRoleMode = 'standalone' | 'logic_board';

export interface MbUnmatchedEntry {
  boardTs: number;
  receivedAt: number;
  hex: string;
  len: number;
}

const MAX_MB_UNMATCHED_LOG = 200;

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
  showType?:            string;
  showPhase?:           string;
  boardPresetCount?:    number;
  wledSsid?:            string;
  wledIp?:              string;
  wledPort?:            number;
  mbMappingLoaded?:     boolean;
  boardRole?:           BoardRoleMode;
  scannerMac?:          string;
  logicMac?:            string;
  scannerSeen?:         boolean;
  scannerAgeMs?:        number;
}

import {
  migrateConfig, CURRENT_CONFIG_VERSION,
  type ParkConfig, type ShowModeConfig, type WandLabConfig, type MbSegmentLayout,
} from '../utils/configMigration';
import {
  MbMappingConfig, DEFAULT_MB_MAPPING, normalizeMbMapping, mbMappingToBlePayload,
} from '../utils/mbConfig';
import {
  BleCapturePacket, BleCaptureSession,
  MAX_CAPTURE_SESSIONS, MAX_PACKETS_PER_SESSION,
  shouldIgnoreBleCapturePacket,
} from '../utils/bleCapture';
import { bleService } from '../services/BLEService';
import {
  getBestAvailableFixSync,
  primeLocationRuntimeCache,
} from '../utils/locationRuntimeBridge';
import {
  CustomSegmentLayout, normalizeSegmentLayout, buildRecalledSegmentsFromPreset,
  finalizeWledSegmentPayload,
} from '../utils/segmentLayouts';
import { normalizeZonePolygon, generateId } from '../utils/utils';
import {
  DEFAULT_SHOW_SETTINGS,
  normalizeShowBinding,
  buildLegacyShowModeConfig,
  type ParkShowBinding,
  type ShowSettings,
  type ShowInstanceOverride,
} from '../utils/showBindings';
import { ensureMbSegmentLayouts } from '../utils/configMigration';
import type { WledSegRef } from '../utils/mbConfig';

export type { CustomSegmentLayout, WledSegmentDef } from '../utils/segmentLayouts';
export {
  buildLayoutPayload, summarizeLayout,
  normalizeSegmentDef, parseWledStateSegments, buildRecalledSegmentsFromPreset,
  finalizeWledSegmentPayload,
} from '../utils/segmentLayouts';
export { fetchWledSegmentsFromDevice } from '../utils/bleBoardSync';

export type { ParkConfig, ShowModeConfig, MbSegmentLayout } from '../utils/configMigration';
export type { MbMappingConfig, MbSegmentId, MbAnimationKey, MbPatternKey, MbEffectMapping, WledSegRef } from '../utils/mbConfig';
export {
  DEFAULT_MB_MAPPING, MB_COLOR_NAMES, MB_SEGMENT_META, MB_ANIMATION_META, MB_PATTERN_META,
  SW_ANIMATION_META,
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
  savedColors:         SavedColor[];
  addSavedColor:       (c: SavedColor) => void;
  updateSavedColor:    (id: string, patch: Partial<SavedColor>) => void;
  removeSavedColor:    (id: string) => void;
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

  // Segment layouts (reusable WLED multi-segment configs)
  customSegmentLayouts:      CustomSegmentLayout[];
  addCustomSegmentLayout:    (layout: CustomSegmentLayout) => void;
  updateCustomSegmentLayout: (id: string, layout: Partial<CustomSegmentLayout>) => void;
  removeCustomSegmentLayout: (id: string) => void;

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

  // Active zones + GPS (set by useZoneManager)
  activeZoneIds:    string[];
  setActiveZoneIds: (ids: string[]) => void;
  userLocation:     LatLng | null;
  setUserLocation:  (loc: LatLng | null) => void;

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
  /** Continuous unmatched MB/Wand packet log (firmware → app). Persisted toggle. */
  mbUnmatchedLogEnabled: boolean;
  setMbUnmatchedLogEnabled: (val: boolean) => void;
  /** Runtime rolling buffer (most-recent-first). Not persisted. */
  mbUnmatchedLog: MbUnmatchedEntry[];
  appendMbUnmatched: (entry: Omit<MbUnmatchedEntry, 'receivedAt'>) => void;
  clearMbUnmatchedLog: () => void;
  bleEffectTransitionMs: number;
  setBleEffectTransitionMs:(val: number) => void;
  wledSsid:              string;
  setWledSsid:           (val: string) => void;
  wledPass:              string;
  setWledPass:           (val: string) => void;
  wledIp:                string;
  setWledIp:             (val: string) => void;
  wledPort:              number;
  setWledPort:           (val: number) => void;
  /** Background GPS poll interval (seconds) while zones are enabled. */
  locationPollSec:       number;
  setLocationPollSec:    (val: number) => void;
  mbMapping:             MbMappingConfig;
  setMbMapping:          (config: MbMappingConfig) => void;
  updateMbMapping:       (patch: Partial<MbMappingConfig>) => void;
  zonesEnabled:          boolean;
  setZonesEnabled:       (val: boolean) => void;
  syncMode:              'auto' | 'manual';
  setSyncMode:           (v: 'auto' | 'manual') => void;
  /** When off, the app never scans for or connects to the IllumaBuggy board. */
  boardConnectEnabled:   boolean;
  setBoardConnectEnabled:(val: boolean) => void;
  boardRole:             BoardRoleMode;
  setBoardRole:          (role: BoardRoleMode) => void;
  scannerMac:            string;
  setScannerMac:         (mac: string) => void;

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

  // Parks (v3.0 grouping)
  parks:             ParkConfig[];
  activePark:        ParkConfig | null;
  setParks:          (parks: ParkConfig[]) => void;
  addPark:           (park: ParkConfig) => void;
  updatePark:        (id: string, patch: Partial<ParkConfig>) => void;
  removePark:        (id: string) => void;
  setActivePark:     (park: ParkConfig | null) => void;

  // v3.0 config (migration defaults; full UI in later sections)
  showModeConfig: ShowModeConfig;
  setShowModeConfig: (config: Partial<ShowModeConfig>) => void;
  showBindings: ParkShowBinding[];
  showSettings: ShowSettings;
  showInstanceOverrides: Record<string, ShowInstanceOverride>;
  /** Runtime: in-scope show in pre/live — zone GPS must not preempt show automation. */
  showProtectsZones: boolean;
  setShowProtectsZones: (protect: boolean) => void;
  upsertShowBinding: (binding: ParkShowBinding) => void;
  removeShowBinding: (id: string) => void;
  setShowSettings: (patch: Partial<ShowSettings>) => void;
  setShowInstanceOverride: (instanceId: string, patch: Partial<ShowInstanceOverride>) => void;
  ftbPresetId: string;
  setFtbPresetId: (id: string) => void;
  wandLab: WandLabConfig;
  mbSegmentLayouts: MbSegmentLayout[];
  mbActiveSegmentLayoutId: string | null;
  switchMbSegmentLayout: (id: string) => void;
  hydrateMbMappingFromActiveLayout: () => void;
  addMbSegmentLayout: (name: string) => void;
  updateActiveLayoutSegments: (segId: string, refs: import('../utils/mbConfig').WledSegRef[]) => void;

  // BLE packet capture (parade / show recording)
  bleCaptureActive:       boolean;
  bleCaptureDurationSec:  number;
  bleCaptureStartedAt:    number | null;
  bleCaptureEndsAt:       number | null;
  /** 1-based segment index while recording; increments on packet-limit rollover */
  bleCaptureSegment:      number;
  bleCaptureLiveCount:    number;
  bleCaptureBuffer:       BleCapturePacket[];
  bleCaptureSessions:     BleCaptureSession[];
  bleCaptureDraftName:    string;
  /** Persisted noise tags to skip during capture (`PING`, `WAND_IDLE`). */
  bleCaptureIgnoreTags:   string[];
  setBleCaptureIgnoreTags:(tags: string[]) => void;
  /** Runtime count of packets skipped by ignore filters. Not persisted. */
  bleCaptureIgnoredCount: number;
  /** Runtime-only: capture is borrowing the background location pipeline. */
  captureForcedLocationTracking: boolean;
  captureSource:          'firmware' | 'phone';
  setCaptureSource:       (v: 'firmware' | 'phone') => void;
  setBleCaptureDurationSec: (sec: number) => void;
  setBleCaptureDraftName:   (name: string) => void;
  startBleCapture:          () => void;
  stopBleCapture:           (reason?: string) => void;
  rolloverBleCapture:       () => void;
  appendBleCapturePacket:   (pkt: Omit<BleCapturePacket, 'receivedAt'>) => void;
  updateBleCapturePacketNote: (boardTs: number, hex: string, note: string) => void;
  deleteBleCaptureSession:  (id: string) => void;
  renameBleCaptureSession:  (id: string, name: string) => void;
}

// ─────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────

const DEFAULT_BRIGHTNESS: BrightnessConfig = {
  daytime: 200, nighttime: 80, indoor: 120, transitionMinutes: 30, solarThresholdDeg: 6,
};

export const LOCATION_POLL_SEC_MIN = 5;
export const LOCATION_POLL_SEC_MAX = 300;
export const DEFAULT_LOCATION_POLL_SEC = __DEV__ ? 5 : 30;

const DEFAULT_RECALL: RecallState = {
  effect: 'always', palette: 'always', parameters: 'memory', color: 'memory', segments: 'never',
};

const DEFAULT_SHOW_MODE: ShowModeConfig = {
  parade: { pre: '', live: '', post: '' },
  fireworks: { pre: '', live: '', post: '' },
};

const DEFAULT_WAND_LAB: WandLabConfig = { simIp: '', log: [] };

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
    tags:      normalizeTags(p.tags),
    segmentLayoutId: p.segmentLayoutId,
    createdAt: p.createdAt ?? Date.now(),
  };
}

export function normalizeCustomPalette(p: CustomPalette): CustomPalette {
  return { ...p, tags: normalizeTags(p.tags) };
}

export function normalizePaletteSet(s: PaletteSet): PaletteSet {
  return { ...s, tags: normalizeTags(s.tags) };
}

// ─────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────

/** Extract a JSON string array from chunked BLE catalog payloads (may include noise). */
function parseWledJsonArray(raw: string | undefined): string[] | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed as string[] : null;
  } catch {
    return null;
  }
}

function buildCaptureSession(
  s: {
    bleCaptureBuffer: BleCapturePacket[];
    bleCaptureDraftName: string;
    bleCaptureStartedAt: number | null;
  },
  endedAt: number,
  segment: number,
  forcePartSuffix: boolean,
): BleCaptureSession {
  const startedAt = s.bleCaptureStartedAt ?? endedAt;
  const baseName = s.bleCaptureDraftName.trim() || `Capture ${new Date(startedAt).toLocaleString()}`;
  const name = forcePartSuffix || segment > 1 ? `${baseName} · ${segment}` : baseName;
  return {
    id: `cap_${endedAt}_p${segment}`,
    name,
    startedAt,
    endedAt,
    durationSec: Math.round((endedAt - startedAt) / 1000),
    packets: s.bleCaptureBuffer,
  };
}

function prependCaptureSession(
  sessions: BleCaptureSession[],
  session: BleCaptureSession,
): BleCaptureSession[] {
  const next = [session, ...sessions];
  return next.length > MAX_CAPTURE_SESSIONS ? next.slice(0, MAX_CAPTURE_SESSIONS) : next;
}

export const useAppStore = create<AppState>((set, get) => ({
  presets:             [],
  wledEffects:         [],
  wledPalettes:        [],
  wledFxData:          [],
  customPalettes:      [],
  savedColors:         [],
  paletteSets:         [],
  activePaletteSetId:  null,
  customSegmentLayouts: [],
  recallState:         DEFAULT_RECALL,
  zones:               [],
  indoorZones:         [],
  activeZoneIds:       [],
  userLocation:        null,
  deviceStatus:        null,
  overrideDetail:      null,
  overrideKillOnZone:  false,
  starlightEnabled:    true,
  starlightTimeoutSec: 15,
  magicBandEnabled:    true,
  magicBandFivePoint:  true,
  magicBandTimeoutSec: 15,
  mbUnmatchedLogEnabled: false,
  mbUnmatchedLog:      [],
  bleEffectTransitionMs: 700,
  wledSsid:            '',
  wledPass:            '',
  wledIp:              '',
  wledPort:            80,
  locationPollSec:     DEFAULT_LOCATION_POLL_SEC,
  mbMapping:           DEFAULT_MB_MAPPING,
  zonesEnabled:        true,
  syncMode:            'auto',
  boardConnectEnabled: true,
  boardRole:           'standalone',
  scannerMac:          '',
  brightnessConfig:    DEFAULT_BRIGHTNESS,
  bleCaptureActive:       false,
  bleCaptureDurationSec:  900,
  bleCaptureStartedAt:    null,
  bleCaptureEndsAt:       null,
  bleCaptureSegment:      1,
  bleCaptureLiveCount:    0,
  bleCaptureBuffer:       [],
  bleCaptureSessions:     [],
  bleCaptureDraftName:    'Parade capture',
  bleCaptureIgnoreTags:   [],
  bleCaptureIgnoredCount: 0,
  captureForcedLocationTracking: false,
  captureSource:          'firmware',
  parks:                  [],
  activePark:             null,
  showModeConfig:         DEFAULT_SHOW_MODE,
  showBindings:           [],
  showSettings:           { ...DEFAULT_SHOW_SETTINGS },
  showInstanceOverrides:  {},
  showProtectsZones:      false,
  ftbPresetId:            '',
  wandLab:                DEFAULT_WAND_LAB,
  mbSegmentLayouts:       [],
  mbActiveSegmentLayoutId: null,

  switchMbSegmentLayout: (id) => {
    const s = get();
    const layout = s.mbSegmentLayouts.find(l => l.id === id);
    if (!layout) return;
    const segments = JSON.parse(JSON.stringify(layout.segments)) as Record<string, WledSegRef[]>;
    set({
      mbActiveSegmentLayoutId: id,
      mbMapping: { ...s.mbMapping, segments },
    });
    get().saveToStorage();
  },

  hydrateMbMappingFromActiveLayout: () => {
    const s = get();
    const layout = (s.mbActiveSegmentLayoutId
      ? s.mbSegmentLayouts.find(l => l.id === s.mbActiveSegmentLayoutId)
      : undefined) ?? s.mbSegmentLayouts[0];
    if (!layout) return;
    const segments = JSON.parse(JSON.stringify(layout.segments)) as Record<string, WledSegRef[]>;
    set({ mbMapping: { ...s.mbMapping, segments } });
  },

  addMbSegmentLayout: (name) => {
    const s = get();
    const id = generateId();
    const segments = JSON.parse(JSON.stringify(s.mbMapping.segments)) as Record<string, WledSegRef[]>;
    const layout: MbSegmentLayout = { id, name: name.trim() || 'Layout', createdAt: Date.now(), segments };
    set({
      mbSegmentLayouts: [...s.mbSegmentLayouts, layout],
      mbActiveSegmentLayoutId: id,
    });
    get().saveToStorage();
  },

  updateActiveLayoutSegments: (segId, refs) => {
    const s = get();
    const segments = { ...s.mbMapping.segments, [segId]: refs };
    const mbMapping = { ...s.mbMapping, segments };
    const activeId = s.mbActiveSegmentLayoutId;
    const mbSegmentLayouts = activeId
      ? s.mbSegmentLayouts.map(l => l.id === activeId
        ? { ...l, segments: { ...l.segments, [segId]: refs } }
        : l)
      : s.mbSegmentLayouts;
    set({ mbMapping, mbSegmentLayouts });
    get().saveToStorage();
  },

  // Presets
  setPresets: (presets) => set({ presets }),
  addOrUpdatePreset: (preset) => set(s => {
    const idx = s.presets.findIndex(p => p.id === preset.id);
    if (idx >= 0) { const u = [...s.presets]; u[idx] = preset; return { presets: u }; }
    return { presets: [...s.presets, preset] };
  }),
  removePreset: (id) => set(s => ({ presets: s.presets.filter(p => p.id !== id) })),

  // Parks
  setParks: (parks) => set({ parks }),
  addPark: (park) => set(s => ({ parks: [...s.parks, park] })),
  updatePark: (id, patch) => set(s => ({
    parks: s.parks.map(p => p.id === id ? { ...p, ...patch } : p),
  })),
  removePark: (id) => set(s => ({
    parks: s.parks.filter(p => p.id !== id),
    zones: s.zones.map(z => z.parkId === id ? { ...z, parkId: undefined } : z),
    indoorZones: s.indoorZones.map(z => z.parkId === id ? { ...z, parkId: undefined } : z),
  })),
  setActivePark: (activePark) => set(s => {
    if (s.activePark?.id === activePark?.id) return s;
    return {
      activePark,
      showModeConfig: buildLegacyShowModeConfig(s.showBindings, activePark?.id),
    };
  }),

  setShowModeConfig: (patch) => set(s => ({
    showModeConfig: {
      ...s.showModeConfig,
      ...patch,
      parade: { ...s.showModeConfig.parade, ...(patch.parade ?? {}) },
      fireworks: { ...s.showModeConfig.fireworks, ...(patch.fireworks ?? {}) },
    },
  })),

  upsertShowBinding: (binding) => set(s => {
    const next = s.showBindings.filter(b => b.id !== binding.id);
    next.push(binding);
    return {
      showBindings: next,
      showModeConfig: buildLegacyShowModeConfig(next, s.activePark?.id),
    };
  }),

  removeShowBinding: (id) => set(s => {
    const next = s.showBindings.filter(b => b.id !== id);
    return {
      showBindings: next,
      showModeConfig: buildLegacyShowModeConfig(next, s.activePark?.id),
    };
  }),

  setShowSettings: (patch) => set(s => ({
    showSettings: { ...s.showSettings, ...patch },
  })),

  setShowInstanceOverride: (instanceId, patch) => set(s => ({
    showInstanceOverrides: {
      ...s.showInstanceOverrides,
      [instanceId]: { ...s.showInstanceOverrides[instanceId], ...patch },
    },
  })),

  setShowProtectsZones: (showProtectsZones) => set({ showProtectsZones }),

  setFtbPresetId: (ftbPresetId) => set({ ftbPresetId }),

  // WLED cache
  setWledEffects:  (wledEffects)  => set({ wledEffects }),
  setWledPalettes: (wledPalettes) => set({ wledPalettes }),
  setWledFxData:   (wledFxData)   => set({ wledFxData }),

  // Custom palettes
  addCustomPalette:    (p)     => set(s => ({ customPalettes: [...s.customPalettes, p] })),
  updateCustomPalette: (id, p) => set(s => ({ customPalettes: s.customPalettes.map(cp => cp.id === id ? { ...cp, ...p } : cp) })),
  removeCustomPalette: (id)    => set(s => ({ customPalettes: s.customPalettes.filter(cp => cp.id !== id) })),

  addSavedColor:    (c)     => set(s => ({ savedColors: [...s.savedColors, c] })),
  updateSavedColor: (id, p) => set(s => ({ savedColors: s.savedColors.map(c => c.id === id ? { ...c, ...p } : c) })),
  removeSavedColor: (id)    => set(s => ({ savedColors: s.savedColors.filter(c => c.id !== id) })),

  // Palette sets
  addPaletteSet:    (ps)    => set(s => ({ paletteSets: [...s.paletteSets, ps] })),
  updatePaletteSet: (id, s) => set(st => ({ paletteSets: st.paletteSets.map(ps => ps.id === id ? { ...ps, ...s } : ps) })),
  removePaletteSet: (id)    => set(s => ({ paletteSets: s.paletteSets.filter(ps => ps.id !== id) })),
  setActivePaletteSet: (id) => set({ activePaletteSetId: id }),

  addCustomSegmentLayout: (layout) => set(s => ({
    customSegmentLayouts: [...s.customSegmentLayouts, layout],
  })),
  updateCustomSegmentLayout: (id, patch) => set(s => ({
    customSegmentLayouts: s.customSegmentLayouts.map(l => l.id === id ? { ...l, ...patch } : l),
  })),
  removeCustomSegmentLayout: (id) => set(s => ({
    customSegmentLayouts: s.customSegmentLayouts.filter(l => l.id !== id),
    presets: s.presets.map(p => p.segmentLayoutId === id ? { ...p, segmentLayoutId: undefined } : p),
  })),

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
  setUserLocation:  (userLocation)  => set({ userLocation }),

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
  setMbUnmatchedLogEnabled: (val) => {
    set({ mbUnmatchedLogEnabled: val });
    // Enable only when session is ready; always send disable while connected.
    if (val ? bleService.isSessionReady() : bleService.isConnected()) {
      void bleService.sendMbUnmatchedLogConfig(val);
    }
    get().saveToStorage();
  },
  appendMbUnmatched: (entry) => {
    const next: MbUnmatchedEntry = { ...entry, receivedAt: Date.now() };
    set(s => ({
      mbUnmatchedLog: [next, ...s.mbUnmatchedLog].slice(0, MAX_MB_UNMATCHED_LOG),
    }));
  },
  clearMbUnmatchedLog: () => set({ mbUnmatchedLog: [] }),
  setBleEffectTransitionMs:(val)        => set({ bleEffectTransitionMs: val }),
  setWledSsid:           (val)          => set({ wledSsid: val }),
  setWledPass:           (val)          => set({ wledPass: val }),
  setWledIp:             (val)          => set({ wledIp: val }),
  setWledPort:           (val)          => set({ wledPort: val }),
  setLocationPollSec:    (val)          => set({
    locationPollSec: Math.min(LOCATION_POLL_SEC_MAX, Math.max(LOCATION_POLL_SEC_MIN, val)),
  }),
  setMbMapping:          (mbMapping)   => set({ mbMapping: normalizeMbMapping(mbMapping) }),
  updateMbMapping:       (patch)       => set(s => ({ mbMapping: normalizeMbMapping({ ...s.mbMapping, ...patch }) })),
  setZonesEnabled:       (val)          => set({ zonesEnabled: val }),
  setSyncMode:           (val)          => { set({ syncMode: val }); get().saveToStorage(); },
  setBoardConnectEnabled:(val)          => { set({ boardConnectEnabled: val }); get().saveToStorage(); },
  setBoardRole:          (role)         => { set({ boardRole: role }); get().saveToStorage(); },
  setScannerMac:         (mac)          => set({ scannerMac: mac }),

  setCaptureSource:         (val) => set({ captureSource: val }),
  setBleCaptureDurationSec: (sec) => set({ bleCaptureDurationSec: sec }),
  setBleCaptureDraftName:   (name) => set({ bleCaptureDraftName: name }),
  setBleCaptureIgnoreTags:  (tags) => {
    set({ bleCaptureIgnoreTags: tags });
    get().saveToStorage();
  },

  startBleCapture: () => {
    const s = get();
    if (s.bleCaptureActive) return;
    const startedAt = Date.now();
    const durationSec = s.bleCaptureDurationSec;
    set({
      bleCaptureActive: true,
      bleCaptureStartedAt: startedAt,
      bleCaptureEndsAt: durationSec > 0 ? startedAt + durationSec * 1000 : null,
      bleCaptureSegment: 1,
      bleCaptureLiveCount: 0,
      bleCaptureBuffer: [],
      bleCaptureIgnoredCount: 0,
      captureForcedLocationTracking: true,
    });
    void primeLocationRuntimeCache();
  },

  stopBleCapture: (reason = 'manual') => {
    const s = get();
    if (!s.bleCaptureActive && s.bleCaptureBuffer.length === 0) {
      set({
        bleCaptureActive: false,
        bleCaptureStartedAt: null,
        bleCaptureEndsAt: null,
        bleCaptureSegment: 1,
        captureForcedLocationTracking: false,
      });
      return;
    }
    const endedAt = Date.now();
    const session = buildCaptureSession(s, endedAt, s.bleCaptureSegment, false);
    const packets = session.packets;
    set({
      bleCaptureActive: false,
      bleCaptureStartedAt: null,
      bleCaptureEndsAt: null,
      bleCaptureSegment: 1,
      bleCaptureLiveCount: 0,
      bleCaptureBuffer: [],
      captureForcedLocationTracking: false,
      bleCaptureSessions: prependCaptureSession(s.bleCaptureSessions, session),
    });
    get().saveToStorage();
    console.log(`[Capture] Stopped (${reason}): ${packets.length} packets`);
  },

  rolloverBleCapture: () => {
    const s = get();
    if (!s.bleCaptureActive || s.bleCaptureBuffer.length === 0) return;
    const endedAt = Date.now();
    const session = buildCaptureSession(s, endedAt, s.bleCaptureSegment, true);
    const nextSegment = s.bleCaptureSegment + 1;
    set({
      bleCaptureSessions: prependCaptureSession(s.bleCaptureSessions, session),
      bleCaptureBuffer: [],
      bleCaptureLiveCount: 0,
      bleCaptureStartedAt: endedAt,
      bleCaptureSegment: nextSegment,
    });
    get().saveToStorage();
    console.log(
      `[Capture] Rolled over part ${s.bleCaptureSegment} (${session.packets.length} packets) → part ${nextSegment}`,
    );
  },

  appendBleCapturePacket: (pkt) => {
    const s = get();
    if (!s.bleCaptureActive) return;
    if (shouldIgnoreBleCapturePacket(pkt.tag, pkt.hex, s.bleCaptureIgnoreTags)) {
      set({ bleCaptureIgnoredCount: s.bleCaptureIgnoredCount + 1 });
      return;
    }
    if (s.bleCaptureBuffer.length >= MAX_PACKETS_PER_SESSION) {
      get().rolloverBleCapture();
    }
    const active = get();
    if (!active.bleCaptureActive) return;
    const gps = getBestAvailableFixSync(active.userLocation);
    const entry: BleCapturePacket = {
      ...pkt,
      receivedAt: Date.now(),
      ...(gps ? {
        lat: gps.latitude,
        lng: gps.longitude,
        ...(gps.accuracyM != null ? { accuracyM: gps.accuracyM } : {}),
        gpsUpdatedAt: gps.updatedAt,
      } : {}),
    };
    const buf = [...active.bleCaptureBuffer, entry];
    set({ bleCaptureBuffer: buf, bleCaptureLiveCount: buf.length });
  },

  updateBleCapturePacketNote: (boardTs, hex, note) => {
    set(s => ({
      bleCaptureSessions: s.bleCaptureSessions.map(session => ({
        ...session,
        packets: session.packets.map(p =>
          p.boardTs === boardTs && p.hex === hex ? { ...p, note } : p,
        ),
      })),
    }));
    get().saveToStorage();
  },

  deleteBleCaptureSession: (id) => {
    set(s => ({ bleCaptureSessions: s.bleCaptureSessions.filter(x => x.id !== id) }));
    get().saveToStorage();
  },

  renameBleCaptureSession: (id, name) => {
    set(s => ({
      bleCaptureSessions: s.bleCaptureSessions.map(x =>
        x.id === id ? { ...x, name: name.trim() || x.name } : x,
      ),
    }));
    get().saveToStorage();
  },

  // Persistence
  loadFromStorage: async () => {
    try {
      const keys = ['presets','zones','indoorZones','brightnessConfig','overrideKillOnZone',
                    'starlightEnabled','starlightTimeoutSec','magicBandEnabled',
                    'magicBandFivePoint','magicBandTimeoutSec','mbUnmatchedLogEnabled',
                    'bleEffectTransitionMs',
                    'wledSsid','wledPass','wledIp','wledPort','zonesEnabled','syncMode','boardConnectEnabled',
                    'boardRole','scannerMac','locationPollSec','mbMapping',
                    'recallState','bleCaptureSessions','bleCaptureDurationSec','bleCaptureDraftName',
                    'bleCaptureIgnoreTags',
                    'customPalettes','savedColors','paletteSets','activePaletteSetId',
                    'customSegmentLayouts','parks','showModeConfig','showBindings','showSettings',
                    'showInstanceOverrides','ftbPresetId','wandLab',
                    'mbSegmentLayouts','mbActiveSegmentLayoutId',
                    'wledEffects','wledPalettes','wledFxData'];
      const pairs = await AsyncStorage.multiGet(keys);
      const d: Record<string, any> = {};
      pairs.forEach(([k, v]) => {
        if (!v) return;
        try {
          d[k] = JSON.parse(v);
        } catch {
          // ftbPresetId was historically saved without JSON.stringify — accept bare id strings.
          if (k === 'ftbPresetId') {
            d[k] = v;
          } else {
            console.warn(`[Store] Skipping corrupt storage key "${k}"`);
          }
        }
      });
      const mbMapping = normalizeMbMapping(d.mbMapping);
      const mbBoot = ensureMbSegmentLayouts({
        mbMapping,
        mbSegmentLayouts: d.mbSegmentLayouts ?? [],
        mbActiveSegmentLayoutId: d.mbActiveSegmentLayoutId ?? null,
      });
      const bootLayouts = (mbBoot.mbSegmentLayouts as MbSegmentLayout[]) ?? [];
      const bootActiveId = (mbBoot.mbActiveSegmentLayoutId as string | null) ?? null;
      const bootActiveLayout = (bootActiveId
        ? bootLayouts.find(l => l.id === bootActiveId)
        : undefined) ?? bootLayouts[0];
      const hydratedMbMapping = bootActiveLayout
        ? {
          ...mbMapping,
          segments: JSON.parse(JSON.stringify(bootActiveLayout.segments)) as Record<string, WledSegRef[]>,
        }
        : mbMapping;
      set({
        presets:            (d.presets ?? []).map((p: Preset) => normalizePreset(p)),
        zones:              (d.zones ?? []).map((z: Zone) => normalizeZonePolygon(z)),
        indoorZones:        (d.indoorZones ?? []).map((z: IndoorZone) => normalizeZonePolygon(z)),
        brightnessConfig:   d.brightnessConfig   ?? DEFAULT_BRIGHTNESS,
        overrideKillOnZone: d.overrideKillOnZone ?? false,
        starlightEnabled:   d.starlightEnabled   ?? true,
        starlightTimeoutSec:d.starlightTimeoutSec ?? 15,
        magicBandEnabled:   d.magicBandEnabled   ?? true,
        magicBandFivePoint: d.magicBandFivePoint ?? true,
        magicBandTimeoutSec:d.magicBandTimeoutSec ?? 15,
        mbUnmatchedLogEnabled: d.mbUnmatchedLogEnabled ?? false,
        bleEffectTransitionMs: d.bleEffectTransitionMs ?? 700,
        wledSsid:           d.wledSsid           ?? '',
        wledPass:           d.wledPass           ?? '',
        wledIp:             d.wledIp             ?? '',
        wledPort:           d.wledPort           ?? 80,
        zonesEnabled:       d.zonesEnabled       ?? true,
        syncMode:           d.syncMode           ?? 'auto',
        boardConnectEnabled:d.boardConnectEnabled ?? true,
        boardRole:          (d.boardRole as BoardRoleMode) ?? 'standalone',
        scannerMac:         (d.scannerMac as string) ?? '',
        locationPollSec:    d.locationPollSec ?? DEFAULT_LOCATION_POLL_SEC,
        mbMapping:          hydratedMbMapping,
        recallState:        d.recallState        ?? DEFAULT_RECALL,
        customPalettes:     (d.customPalettes ?? []).map((p: CustomPalette) => normalizeCustomPalette(p)),
        savedColors:        d.savedColors ?? [],
        paletteSets:        (d.paletteSets ?? []).map((s: PaletteSet) => normalizePaletteSet(s)),
        activePaletteSetId: d.activePaletteSetId ?? null,
        customSegmentLayouts: (d.customSegmentLayouts ?? [])
          .map((l: CustomSegmentLayout) => normalizeSegmentLayout(l))
          .filter(Boolean) as CustomSegmentLayout[],
        wledEffects:        d.wledEffects        ?? [],
        wledPalettes:       d.wledPalettes       ?? [],
        wledFxData:         d.wledFxData         ?? [],
        bleCaptureSessions: d.bleCaptureSessions ?? [],
        bleCaptureDurationSec: d.bleCaptureDurationSec ?? 900,
        bleCaptureDraftName:   d.bleCaptureDraftName   ?? 'Parade capture',
        bleCaptureIgnoreTags:  Array.isArray(d.bleCaptureIgnoreTags) ? d.bleCaptureIgnoreTags : [],
        parks:              d.parks              ?? [],
        activePark:         null,
        showModeConfig:     d.showModeConfig     ?? DEFAULT_SHOW_MODE,
        showBindings:       Array.isArray(d.showBindings)
          ? d.showBindings.map((b: ParkShowBinding) => normalizeShowBinding(b, d.showSettings ?? DEFAULT_SHOW_SETTINGS)).filter(Boolean) as ParkShowBinding[]
          : [],
        showSettings:       { ...DEFAULT_SHOW_SETTINGS, ...(d.showSettings ?? {}) },
        showInstanceOverrides: d.showInstanceOverrides ?? {},
        ftbPresetId:        d.ftbPresetId        ?? '',
        wandLab:            d.wandLab            ?? DEFAULT_WAND_LAB,
        mbSegmentLayouts:   (mbBoot.mbSegmentLayouts as MbSegmentLayout[]) ?? [],
        mbActiveSegmentLayoutId: (mbBoot.mbActiveSegmentLayoutId as string | null) ?? null,
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
        ['mbUnmatchedLogEnabled', JSON.stringify(s.mbUnmatchedLogEnabled)],
        ['bleEffectTransitionMs', JSON.stringify(s.bleEffectTransitionMs)],
        ['wledSsid',           JSON.stringify(s.wledSsid)],
        ['wledPass',           JSON.stringify(s.wledPass)],
        ['wledIp',             JSON.stringify(s.wledIp)],
        ['wledPort',           JSON.stringify(s.wledPort)],
        ['zonesEnabled',       JSON.stringify(s.zonesEnabled)],
        ['syncMode',           JSON.stringify(s.syncMode)],
        ['boardConnectEnabled', JSON.stringify(s.boardConnectEnabled)],
        ['boardRole',           JSON.stringify(s.boardRole)],
        ['scannerMac',          JSON.stringify(s.scannerMac)],
        ['locationPollSec',    JSON.stringify(s.locationPollSec)],
        ['mbMapping',          JSON.stringify(s.mbMapping)],
        ['recallState',        JSON.stringify(s.recallState)],
        ['customPalettes',     JSON.stringify(s.customPalettes)],
        ['savedColors',        JSON.stringify(s.savedColors)],
        ['paletteSets',        JSON.stringify(s.paletteSets)],
        ['activePaletteSetId', JSON.stringify(s.activePaletteSetId)],
        ['customSegmentLayouts', JSON.stringify(s.customSegmentLayouts)],
        ['wledEffects',        JSON.stringify(s.wledEffects)],
        ['wledPalettes',       JSON.stringify(s.wledPalettes)],
        ['wledFxData',         JSON.stringify(s.wledFxData)],
        ['bleCaptureSessions', JSON.stringify(s.bleCaptureSessions)],
        ['bleCaptureDurationSec', JSON.stringify(s.bleCaptureDurationSec)],
        ['bleCaptureDraftName',   JSON.stringify(s.bleCaptureDraftName)],
        ['bleCaptureIgnoreTags',  JSON.stringify(s.bleCaptureIgnoreTags)],
        ['parks',              JSON.stringify(s.parks)],
        ['showModeConfig',     JSON.stringify(s.showModeConfig)],
        ['showBindings',       JSON.stringify(s.showBindings)],
        ['showSettings',       JSON.stringify(s.showSettings)],
        ['showInstanceOverrides', JSON.stringify(s.showInstanceOverrides)],
        ['ftbPresetId',        JSON.stringify(s.ftbPresetId)],
        ['wandLab',            JSON.stringify(s.wandLab)],
        ['mbSegmentLayouts',   JSON.stringify(s.mbSegmentLayouts)],
        ['mbActiveSegmentLayoutId', JSON.stringify(s.mbActiveSegmentLayoutId)],
      ]);
    } catch (e) { console.error('[Store] Save error:', e); }
  },

  ingestWledEffectsRaw: (raw) => {
    try {
      const arr = parseWledJsonArray(raw);
      if (!arr) {
        console.warn('[Store] Effects ingest skipped — invalid JSON', (raw ?? '').slice(0, 80));
        return;
      }
      const fxData = get().wledFxData;
      const effects: WledEffect[] = arr
        .map((name, id) => ({ id, name, metadata: fxData[id] ?? '' }))
        .filter(e => e.name !== 'RSVD' && e.name !== '-');
      set({ wledEffects: effects });
      get().saveToStorage();
    } catch (e) { console.error('[Store] Effects ingest error:', e); }
  },

  ingestWledPalettesRaw: (raw) => {
    try {
      const arr = parseWledJsonArray(raw);
      if (!arr) {
        console.warn('[Store] Palettes ingest skipped — invalid JSON', (raw ?? '').slice(0, 80));
        return;
      }
      set({ wledPalettes: arr.map((name, id) => ({ id, name })) });
      get().saveToStorage();
    } catch (e) { console.error('[Store] Palettes ingest error:', e); }
  },

  ingestWledFxDataRaw: (raw) => {
    try {
      const arr = parseWledJsonArray(raw);
      if (!arr) {
        console.warn('[Store] FxData ingest skipped — invalid JSON', (raw ?? '').slice(0, 80));
        return;
      }
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
      version: CURRENT_CONFIG_VERSION, exportedAt: new Date().toISOString(),
      presets: s.presets, zones: s.zones, indoorZones: s.indoorZones,
      brightnessConfig: s.brightnessConfig, recallState: s.recallState,
      overrideKillOnZone: s.overrideKillOnZone,
      starlightEnabled:   s.starlightEnabled,   starlightTimeoutSec: s.starlightTimeoutSec,
      magicBandEnabled:   s.magicBandEnabled,   magicBandFivePoint: s.magicBandFivePoint,
      magicBandTimeoutSec:s.magicBandTimeoutSec,
      bleEffectTransitionMs: s.bleEffectTransitionMs,
      boardRole:          s.boardRole,
      scannerMac:         s.scannerMac,
      locationPollSec:    s.locationPollSec,
      mbMapping:          s.mbMapping,
      bleCaptureSessions: s.bleCaptureSessions,
      customPalettes: s.customPalettes, savedColors: s.savedColors, paletteSets: s.paletteSets,
      customSegmentLayouts: s.customSegmentLayouts,
      parks: s.parks, showModeConfig: s.showModeConfig,
      showBindings: s.showBindings, showSettings: s.showSettings,
      showInstanceOverrides: s.showInstanceOverrides,
      ftbPresetId: s.ftbPresetId, wandLab: s.wandLab,
      mbSegmentLayouts: s.mbSegmentLayouts, mbActiveSegmentLayoutId: s.mbActiveSegmentLayoutId,
    };
  },

  importData: (data: any) => {
    const m = migrateConfig(data) as Record<string, any>;
    set({
      presets:            (m.presets ?? []).map((p: Preset) => normalizePreset(p)),
      zones:              (m.zones ?? []).map((z: Zone) => normalizeZonePolygon(z)),
      indoorZones:        (m.indoorZones ?? []).map((z: IndoorZone) => normalizeZonePolygon(z)),
      brightnessConfig:   m.brightnessConfig   ?? DEFAULT_BRIGHTNESS,
      recallState:        m.recallState        ?? DEFAULT_RECALL,
      overrideKillOnZone: m.overrideKillOnZone ?? false,
      starlightEnabled:   m.starlightEnabled   ?? true,
      starlightTimeoutSec:m.starlightTimeoutSec ?? 15,
      magicBandEnabled:   m.magicBandEnabled   ?? true,
      magicBandFivePoint: m.magicBandFivePoint ?? true,
      magicBandTimeoutSec:m.magicBandTimeoutSec ?? 15,
      bleEffectTransitionMs: m.bleEffectTransitionMs ?? 700,
      boardRole:          (m.boardRole as BoardRoleMode) ?? 'standalone',
      scannerMac:         (m.scannerMac as string) ?? '',
      locationPollSec:    m.locationPollSec ?? DEFAULT_LOCATION_POLL_SEC,
      mbMapping:          normalizeMbMapping(m.mbMapping),
      bleCaptureSessions: m.bleCaptureSessions ?? data.bleCaptureSessions ?? [],
      bleCaptureDurationSec: m.bleCaptureDurationSec ?? data.bleCaptureDurationSec ?? 900,
      bleCaptureDraftName:   m.bleCaptureDraftName   ?? data.bleCaptureDraftName   ?? 'Parade capture',
      customPalettes:     m.customPalettes     ?? [],
      savedColors:        m.savedColors        ?? [],
      paletteSets:        m.paletteSets        ?? [],
      customSegmentLayouts: (m.customSegmentLayouts ?? [])
        .map((l: CustomSegmentLayout) => normalizeSegmentLayout(l))
        .filter(Boolean) as CustomSegmentLayout[],
      parks:              (m.parks as ParkConfig[]) ?? [],
      activePark:         null,
      showModeConfig:     (m.showModeConfig as ShowModeConfig) ?? DEFAULT_SHOW_MODE,
      showBindings:       Array.isArray(m.showBindings)
        ? (m.showBindings as ParkShowBinding[]).map(b => normalizeShowBinding(b, (m.showSettings as ShowSettings) ?? DEFAULT_SHOW_SETTINGS)).filter(Boolean) as ParkShowBinding[]
        : [],
      showSettings:       { ...DEFAULT_SHOW_SETTINGS, ...((m.showSettings as ShowSettings) ?? {}) },
      showInstanceOverrides: (m.showInstanceOverrides as Record<string, ShowInstanceOverride>) ?? {},
      ftbPresetId:        (m.ftbPresetId as string) ?? '',
      wandLab:            (m.wandLab as WandLabConfig) ?? DEFAULT_WAND_LAB,
      mbSegmentLayouts:   (m.mbSegmentLayouts as MbSegmentLayout[]) ?? [],
      mbActiveSegmentLayoutId: (m.mbActiveSegmentLayoutId as string) ?? null,
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

export function buildRecallPayload(
  preset: Preset,
  recall: RecallState | undefined,
  layouts?: CustomSegmentLayout[],
): object {
  if (!recall) recall = DEFAULT_RECALL_FALLBACK;
  const layoutList = layouts ?? useAppStore.getState().customSegmentLayouts;
  return finalizeWledSegmentPayload({
    on: true,
    seg: buildRecalledSegmentsFromPreset(preset, recall, layoutList, DEFAULT_PRESET_MEMORY),
  });
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

/** Flat [pos,r,g,b,…] for WLED /paletteN.json (upload via POST /upload) */
export function buildWledPaletteFile(palette: CustomPalette): { palette: number[] } {
  const flat: number[] = [];
  palette.colors.forEach((hex, i) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const pos = Math.round((i / Math.max(palette.colors.length - 1, 1)) * 255);
    flat.push(pos, r, g, b);
  });
  return { palette: flat };
}

export const WLED_CUSTOM_PALETTE_ID_BASE = 200;

export function wledPalIdFromPdSlot(slot: number): number {
  return WLED_CUSTOM_PALETTE_ID_BASE - slot;
}
