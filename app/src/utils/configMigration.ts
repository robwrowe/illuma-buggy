/**
 * Config schema migration (v2.2 → v3.0). Additive only — presets/zones unchanged.
 */

import { normalizeSegmentLayout, type CustomSegmentLayout, type WledSegmentDef } from './segmentLayouts';

export const CURRENT_CONFIG_VERSION = '3.0';

export interface ShowModeConfig {
  parade: { pre: string; live: string; post?: string };
  fireworks: { pre: string; live: string; post: string };
}

export type { ParkShowBinding, ShowSettings, ShowInstanceOverride } from './showBindings';
export { DEFAULT_SHOW_SETTINGS } from './showBindings';

export interface ParkConfig {
  id: string;
  name: string;
  themeParksApiEntityId: string;
  centerLat?: number;
  centerLng?: number;
  createdAt: number;
}

export interface WandLabConfig {
  simIp: string;
  log: unknown[];
}

export interface SegRefWithMeta {
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

export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function withSegRefDefaults(ref: Partial<SegRefWithMeta>): SegRefWithMeta {
  return {
    id: ref.id ?? 0,
    start: ref.start ?? 0,
    stop: ref.stop ?? 0,
    grp: ref.grp ?? 1,
    spc: ref.spc ?? 0,
    of: ref.of ?? 0,
    rev: ref.rev ?? false,
    mi: ref.mi ?? false,
    fx: ref.fx ?? -1,
    sx: ref.sx ?? 128,
    ix: ref.ix ?? 128,
    pal: ref.pal ?? -1,
  };
}

function migrateSegmentMetadata<T extends Record<string, unknown>>(data: T): T {
  const mbMapping = data.mbMapping as { segments?: Record<string, SegRefWithMeta[]> } | undefined;
  let nextMb = mbMapping;
  if (mbMapping?.segments) {
    const segments: Record<string, SegRefWithMeta[]> = {};
    for (const [key, refs] of Object.entries(mbMapping.segments)) {
      segments[key] = (refs || []).map(r => withSegRefDefaults(r));
    }
    nextMb = { ...mbMapping, segments };
  }
  const customSegmentLayouts = ((data.customSegmentLayouts as CustomSegmentLayout[]) || []).map(layout => ({
    ...layout,
    segments: (layout.segments || []).map(s => withSegRefDefaults(s) as WledSegmentDef),
  }));
  return { ...data, mbMapping: nextMb, customSegmentLayouts };
}

function migrateParksGrouping<T extends Record<string, unknown>>(data: T): T {
  if (Array.isArray(data.parks)) return data;
  return { ...data, parks: [] };
}

function migrateShowModeDefaults<T extends Record<string, unknown>>(data: T): T {
  if (data.showModeConfig) return data;
  return {
    ...data,
    showModeConfig: {
      parade: { pre: '', live: '', post: '' },
      fireworks: { pre: '', live: '__BLACK__', post: '' },
    } satisfies ShowModeConfig,
  };
}

export interface MbSegmentLayout {
  id: string;
  name: string;
  createdAt: number;
  segments: Record<string, SegRefWithMeta[]>;
}

export function buildMbKeyedSegmentsFromMapping(
  mbMapping: { segments?: Record<string, Partial<SegRefWithMeta>[]> } | undefined,
  segmentIds: string[],
  defaultSegments: Record<string, Partial<SegRefWithMeta>[]>,
): Record<string, SegRefWithMeta[]> {
  const segments: Record<string, SegRefWithMeta[]> = {};
  for (const id of segmentIds) {
    const src = mbMapping?.segments?.[id] || defaultSegments[id] || [];
    segments[id] = src.map(r => withSegRefDefaults(r));
  }
  return segments;
}

export function ensureMbSegmentLayouts<T extends Record<string, unknown>>(data: T): T {
  if (Array.isArray(data.mbSegmentLayouts) && (data.mbSegmentLayouts as unknown[]).length) return data;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const mbSegs = (data.mbMapping as { segments?: Record<string, Partial<SegRefWithMeta>[]> } | undefined)?.segments;
  const segments: Record<string, SegRefWithMeta[]> = {};
  if (mbSegs) {
    for (const [key, refs] of Object.entries(mbSegs)) {
      segments[key] = (refs || []).map(r => withSegRefDefaults(r));
    }
  }
  return {
    ...data,
    mbSegmentLayouts: [{ id, name: 'Default', createdAt: Date.now(), segments }],
    mbActiveSegmentLayoutId: data.mbActiveSegmentLayoutId || id,
  } as T;
}

function migrateWandLabDefaults<T extends Record<string, unknown>>(data: T): T {
  if (data.wandLab) return data;
  return { ...data, wandLab: { simIp: '', log: [] } satisfies WandLabConfig };
}

/** Run version migrations (call normalizeMbMapping / loadAppData after this in each host). */
export function migrateConfig(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!raw) return { version: CURRENT_CONFIG_VERSION };
  let data: Record<string, unknown> = { ...raw };
  const v = String(data.version || '1.0');
  if (compareVersions(v, CURRENT_CONFIG_VERSION) < 0) {
    data = migrateSegmentMetadata(data);
    data = migrateParksGrouping(data);
    data = migrateShowModeDefaults(data);
    data = migrateWandLabDefaults(data);
    data.version = CURRENT_CONFIG_VERSION;
  }
  if (Array.isArray(data.customSegmentLayouts)) {
    data.customSegmentLayouts = data.customSegmentLayouts
      .map(l => normalizeSegmentLayout(l as CustomSegmentLayout))
      .filter(Boolean);
  }
  data = ensureMbSegmentLayouts(data);
  return data;
}
