import {
  migrateLegacySegmentLayouts,
  migrateWandLabDefaults,
  normalizeMbMapping,
  normalizePreset,
  withSegRefDefaults,
} from './ble/mbMapping';
import type { AppData } from '../types/app';
import { normalizeTags } from './tags';
import {
  DEFAULT_DATA,
  compareVersions,
  normalizeColorCalibration,
  normalizeHex,
  normalizeZoneRecord,
} from './utils';

export function loadAppData(stored: Partial<AppData> | null | undefined): AppData {
  let merged = stored ? { ...DEFAULT_DATA, ...stored } : { ...DEFAULT_DATA };

  // Fold legacy top-level customSegmentLayouts into mbMapping.segmentMaps once,
  // before any tab / sync consumer sees the data.
  const { data: migrated, idMap } = migrateLegacySegmentLayouts(merged);
  merged = migrated;

  merged.colorCalibration = normalizeColorCalibration(merged.colorCalibration);
  merged.mbMapping = normalizeMbMapping(merged.mbMapping);
  merged.savedColors = (merged.savedColors || [])
    .filter(c => c?.id && normalizeHex(c.hex))
    .map(c => ({ id: c.id, name: c.name || c.hex, hex: normalizeHex(c.hex), tags: normalizeTags(c.tags) }));
  merged.presets = (merged.presets || []).map((p) => {
    const next = normalizePreset({
      ...p,
      tags: normalizeTags(p.tags),
      ...(p.segmentLayoutId
        ? { segmentMapId: idMap[p.segmentLayoutId] ?? p.segmentMapId }
        : {}),
    });
    if (!next) return null;
    const { segmentLayoutId: _drop, ...rest } = next as any;
    return rest;
  }).filter(Boolean);
  merged.customPalettes = [];
  merged.paletteSets = [];
  merged.zones = (merged.zones || []).map(normalizeZoneRecord);
  merged.indoorZones = (merged.indoorZones || []).map(normalizeZoneRecord);
  merged.parks = merged.parks || [];
  merged.showModeConfig = merged.showModeConfig || DEFAULT_DATA.showModeConfig;
  merged.showBindings = merged.showBindings || [];
  merged.showSettings = { ...DEFAULT_DATA.showSettings, ...(merged.showSettings || {}) };
  merged.showInstanceOverrides = merged.showInstanceOverrides || {};
  merged.wandLab = merged.wandLab || DEFAULT_DATA.wandLab;
  if (!(merged.wandLab.simIp || '').trim()) {
    merged.wandLab = { ...merged.wandLab, simIp: DEFAULT_DATA.wandLab.simIp };
  }
  // Drop legacy region-keyed layout list (superseded by mbMapping.segmentMaps).
  const legacy = merged as AppData & {
    mbSegmentLayouts?: unknown;
    mbActiveSegmentLayoutId?: unknown;
    customSegmentLayouts?: unknown;
  };
  delete legacy.mbSegmentLayouts;
  delete legacy.mbActiveSegmentLayoutId;
  delete legacy.customSegmentLayouts;
  return merged;
}

export const CURRENT_VERSION = '3.0';

export function migrateSegmentMetadata(data: AppData): AppData {
  const mbMapping = data.mbMapping ? { ...data.mbMapping } : undefined;
  if (mbMapping?.segments) {
    const segments = {};
    Object.entries(mbMapping.segments).forEach(([key, refs]) => {
      segments[key] = (refs || []).map(withSegRefDefaults);
    });
    mbMapping.segments = segments;
  }
  return { ...data, mbMapping };
}

export function migrateParksGrouping(data: AppData): AppData {
  if (data.parks) return data;
  return { ...data, parks: [] };
}

export function migrateShowBindingsDefaults(data: AppData): AppData {
  if (data.showBindings && data.showSettings) return data;
  return {
    ...data,
    showBindings: data.showBindings || [],
    showSettings: { ...DEFAULT_DATA.showSettings, ...(data.showSettings || {}) },
    showInstanceOverrides: data.showInstanceOverrides || {},
  };
}

export function migrateShowModeDefaults(data: AppData): AppData {
  if (data.showModeConfig) return data;
  return {
    ...data,
    showModeConfig: {
      parade: { pre: '', live: '', post: '' },
      fireworks: { pre: '', live: '', post: '' },
    },
  };
}

export function migrateConfig(raw: unknown): AppData {
  if (!raw || typeof raw !== 'object') return loadAppData(null);
  let data = { ...(raw as AppData) };
  const v = data.version || '1.0';
  if (compareVersions(v, CURRENT_VERSION) < 0) {
    data = migrateSegmentMetadata(data);
    data = migrateParksGrouping(data);
    data = migrateShowModeDefaults(data);
    data = migrateShowBindingsDefaults(data);
    data = migrateWandLabDefaults(data);
    data.version = CURRENT_VERSION;
  }
  return loadAppData(data);
}

export const LS_KEY = 'illuma-buggy-active';

export const LS_PROFILES = 'illuma-buggy-profiles';
