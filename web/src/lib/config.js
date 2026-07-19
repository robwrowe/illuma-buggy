import { migrateWandLabDefaults, normalizeMbMapping, withSegRefDefaults } from './ble/mbMapping';
import { normalizeTags } from './tags';
import { DEFAULT_DATA, compareVersions, normalizeHex, normalizeZoneRecord } from './utils';

export function loadAppData(stored) {
  const merged = stored ? { ...DEFAULT_DATA, ...stored } : { ...DEFAULT_DATA };
  merged.mbMapping = normalizeMbMapping(merged.mbMapping);
  merged.savedColors = (merged.savedColors || [])
    .filter(c => c?.id && normalizeHex(c.hex))
    .map(c => ({ id: c.id, name: c.name || c.hex, hex: normalizeHex(c.hex), tags: normalizeTags(c.tags) }));
  merged.presets = (merged.presets || []).map(p => ({ ...p, tags: normalizeTags(p.tags) }));
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
  // Drop legacy region-keyed layout list (superseded by mbMapping.segmentMaps).
  delete merged.mbSegmentLayouts;
  delete merged.mbActiveSegmentLayoutId;
  return merged;
}

export const CURRENT_VERSION = '3.0';

export function migrateSegmentMetadata(data) {
  const mbMapping = data.mbMapping ? { ...data.mbMapping } : undefined;
  if (mbMapping?.segments) {
    const segments = {};
    Object.entries(mbMapping.segments).forEach(([key, refs]) => {
      segments[key] = (refs || []).map(withSegRefDefaults);
    });
    mbMapping.segments = segments;
  }
  const customSegmentLayouts = (data.customSegmentLayouts || []).map(layout => ({
    ...layout,
    segments: (layout.segments || []).map(withSegRefDefaults),
  }));
  return { ...data, mbMapping, customSegmentLayouts };
}

export function migrateParksGrouping(data) {
  if (data.parks) return data;
  return { ...data, parks: [] };
}

export function migrateShowBindingsDefaults(data) {
  if (data.showBindings && data.showSettings) return data;
  return {
    ...data,
    showBindings: data.showBindings || [],
    showSettings: { ...DEFAULT_DATA.showSettings, ...(data.showSettings || {}) },
    showInstanceOverrides: data.showInstanceOverrides || {},
  };
}

export function migrateShowModeDefaults(data) {
  if (data.showModeConfig) return data;
  return {
    ...data,
    showModeConfig: {
      parade: { pre: '', live: '', post: '' },
      fireworks: { pre: '', live: '', post: '' },
    },
  };
}

export function migrateConfig(raw) {
  if (!raw) return loadAppData(null);
  let data = { ...raw };
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
