export type RecallValue = 'always' | 'never' | 'memory';
export type ShowKind = 'parade' | 'fireworks';
export type PresetApplyMode = 'legacy' | string;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RecallState {
  effect: RecallValue;
  palette: RecallValue;
  parameters: RecallValue;
  color: RecallValue;
  segments: RecallValue;
}

export interface BrightnessConfig {
  daytime: number;
  nighttime: number;
  indoor: number;
  transitionMinutes: number;
  solarThresholdDeg: number;
}

export type CalibrationPoint = number[];

export interface ColorCalibration {
  enabled: boolean;
  curves: {
    r: CalibrationPoint[];
    g: CalibrationPoint[];
    b: CalibrationPoint[];
  };
}

export interface SavedColor {
  id: string;
  name: string;
  hex: string;
  tags?: string[];
}

export interface Zone {
  id: string;
  name: string;
  polygon: LatLng[];
  presetId?: string;
  enabled?: boolean;
  parkId?: string;
  indoor?: boolean;
  color?: string;
  tags?: string[];
}

export interface Park {
  id: string;
  name: string;
  entityId?: string;
  lat?: number;
  lng?: number;
}

export interface ShowPhasePresets {
  pre: string;
  live: string;
  post: string;
}

export interface ShowModeConfig {
  parade: ShowPhasePresets;
  fireworks: ShowPhasePresets;
}

export interface ShowSettings {
  defaultPreLeadSec: number;
  defaultPostDelaySec: number;
  defaultHomeVisibleBeforeMin: number;
  defaultHomeVisibleAfterMin: number;
  defaultParadeDurationSec: number;
  defaultFireworksDurationSec: number;
  showNightBrightness: number;
  showAutoBrightness: boolean;
}

export interface ParkShowBinding {
  id: string;
  parkId: string;
  entityId: string;
  name: string;
  kind: ShowKind;
  presets: { pre: string; post: string };
  preLeadSec: number;
  postDelaySec: number;
  liveOffsetSec: number;
  homeVisibleBeforeMin: number;
  homeVisibleAfterMin: number;
  durationSec: number;
  autoStartDisabled: boolean;
  autoPrePostDisabled?: boolean;
  autoLiveDisabled?: boolean;
  scopeZoneId?: string | null;
}

export interface ShowInstanceOverride {
  autoStartDisabled?: boolean;
  autoPrePostDisabled?: boolean;
  autoLiveDisabled?: boolean;
}

export interface PresetMemory {
  effect: boolean;
  palette: boolean;
  parameters: boolean;
  color: boolean;
  segments: boolean;
}

export interface PresetGlobal {
  on?: boolean;
  fx?: number;
  fxName?: string;
  pal?: number;
  palName?: string;
  sx?: number;
  ix?: number;
  c1?: number;
  c2?: number;
  c3?: number;
  o1?: boolean;
  o2?: boolean;
  o3?: boolean;
  col?: number[][];
  colorRefs?: unknown[];
}

export interface Preset {
  id: string;
  name: string;
  createdAt: number;
  tags?: string[];
  global?: PresetGlobal;
  wled?: PresetGlobal;
  wledSlot?: number;
  segmentMapId?: string;
  customSegmentMap?: unknown;
  colorLibrary?: unknown[];
  segmentOverrides?: Record<string, unknown>;
  segmentSourceMode?: string;
  ledmap?: number | null;
  memory?: PresetMemory;
  segmentLayoutId?: string;
}

export interface WandLabLogEntry {
  id?: string;
  hex?: string;
  opcode?: string;
  notes?: string;
  synced?: boolean;
  [key: string]: unknown;
}

export interface WandLabState {
  simIp: string;
  log: WandLabLogEntry[];
  [key: string]: unknown;
}

export interface ParadeDetection {
  enabled: boolean;
  beaconOpcodeHexPrefix: string;
  rssiThreshold: number;
  cooldownSec: number;
}

export interface SegRef {
  id: number;
  start: number;
  stop: number;
}

export interface MbMapping {
  version: number;
  rules: unknown[];
  segmentMaps: unknown[];
  timingModels: unknown[];
  defaultPresetId: string;
  colors: string[];
  randomPool: {
    paletteIndices: number[];
    custom: { id: string; name: string; hex: string }[];
  };
  segments: Record<string, SegRef[]>;
  paradeDetection: ParadeDetection;
}

export interface AppData {
  version: string;
  presets: Preset[];
  zones: Zone[];
  indoorZones: Zone[];
  parks: Park[];
  brightnessConfig: BrightnessConfig;
  colorCalibration: ColorCalibration;
  recallState: RecallState;
  overrideKillOnZone: boolean;
  presetApplyMode: PresetApplyMode;
  bleEffectTransitionMs: number;
  starlightEnabled: boolean;
  starlightTimeoutSec: number;
  magicBandEnabled: boolean;
  magicBandTimeoutSec: number;
  customPalettes: unknown[];
  paletteSets: unknown[];
  savedColors: SavedColor[];
  showModeConfig: ShowModeConfig;
  showBindings: ParkShowBinding[];
  showSettings: ShowSettings;
  showInstanceOverrides: Record<string, ShowInstanceOverride>;
  wandLab: WandLabState;
  ftbPresetId: string;
  mbMapping: MbMapping | null;
  exportedAt?: string;
}

export type AppDataUpdate = (patch: Partial<AppData>) => void;

export interface SearchableSelectOption {
  value: string;
  label: string;
  searchText?: string;
  group?: string;
}
