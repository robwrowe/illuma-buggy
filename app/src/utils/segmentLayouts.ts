/**
 * WLED segment layout library — reusable multi-segment configs for presets.
 */

/** Match firmware STRIP_LED_COUNT — full strip when applying single-segment presets. */
export const STRIP_LED_COUNT = 100;
export const WLED_MAX_SEG = 16;

export interface WledSegmentDef {
  id: number;
  start: number;
  stop: number;
  fx?: number;
  pal?: number;
  sx?: number;
  ix?: number;
  c1?: number;
  c2?: number;
  c3?: number;
  o1?: boolean;
  o2?: boolean;
  o3?: boolean;
  col?: number[][];
  of?: number;
  grp?: number;
  spc?: number;
  bm?: number;
  rev?: boolean;
  mi?: boolean;
  bri?: number;
  on?: boolean;
}

export interface CustomSegmentLayout {
  id: string;
  name: string;
  segments: WledSegmentDef[];
  createdAt?: number;
}

const LAYOUT_FIELDS: (keyof WledSegmentDef)[] = [
  'id', 'start', 'stop', 'fx', 'pal', 'sx', 'ix', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3', 'col',
  'of', 'grp', 'spc', 'bm', 'rev', 'mi', 'bri', 'on',
];

export function normalizeSegmentDef(raw: Partial<WledSegmentDef>): WledSegmentDef | null {
  const start = Number(raw.start ?? 0);
  const stop = Number(raw.stop ?? 0);
  if (stop <= start) return null;
  const seg: WledSegmentDef = {
    id: Number(raw.id ?? 0),
    start,
    stop,
  };
  for (const key of LAYOUT_FIELDS) {
    if (key === 'id' || key === 'start' || key === 'stop') continue;
    const v = raw[key];
    if (v !== undefined && v !== null) {
      (seg as Record<string, unknown>)[key] = v;
    }
  }
  return seg;
}

export function normalizeSegmentLayout(raw: Partial<CustomSegmentLayout>): CustomSegmentLayout | null {
  if (!raw.id || !raw.name) return null;
  const segments = (raw.segments ?? [])
    .map(s => normalizeSegmentDef(s))
    .filter((s): s is WledSegmentDef => s !== null);
  return {
    id: raw.id,
    name: raw.name,
    segments,
    createdAt: raw.createdAt ?? Date.now(),
  };
}

/** Parse /json/state or /json/si response — active segments only (stop > start). */
export function parseWledStateSegments(state: unknown): WledSegmentDef[] {
  if (!state || typeof state !== 'object') return [];
  const root = state as Record<string, unknown>;
  const segList = (root.seg ?? (root.state as Record<string, unknown> | undefined)?.seg) as unknown[];
  if (!Array.isArray(segList)) return [];
  return segList
    .map(s => normalizeSegmentDef(s as Partial<WledSegmentDef>))
    .filter((s): s is WledSegmentDef => s !== null);
}

export function buildLayoutPayload(layout: CustomSegmentLayout): { on: boolean; seg: WledSegmentDef[] } {
  return { on: true, seg: layout.segments.map(s => ({ ...s })) };
}

export function mergeSegmentsById(base: WledSegmentDef[], incoming: WledSegmentDef[]): WledSegmentDef[] {
  const map = new Map<number, WledSegmentDef>();
  (base || []).forEach(seg => map.set(seg.id, { ...seg }));
  (incoming || []).forEach(seg => {
    const id = seg.id;
    map.set(id, { ...(map.get(id) || { id }), ...seg, id });
  });
  return [...map.values()].sort((a, b) => a.id - b.id);
}

export function isActiveSegment(seg: Partial<WledSegmentDef> | null | undefined): boolean {
  return Number(seg?.stop ?? 0) > Number(seg?.start ?? 0);
}

export type RecallProp = 'effect' | 'palette' | 'parameters' | 'color' | 'segments';
export type RecallValue = 'always' | 'never' | 'memory';

export interface RecallLike {
  effect: RecallValue;
  palette: RecallValue;
  parameters: RecallValue;
  color: RecallValue;
  segments: RecallValue;
}

export interface MemoryLike {
  effect: boolean;
  palette: boolean;
  parameters: boolean;
  color: boolean;
  segments: boolean;
}

type WledLike = {
  fx?: number;
  pal?: number;
  sx?: number;
  ix?: number;
  c1?: number;
  c2?: number;
  c3?: number;
  o1?: boolean;
  o2?: boolean;
  o3?: boolean;
  col?: number[][];
};

function pickSegOrWled(seg: Partial<WledSegmentDef> | undefined, wled: WledLike, key: keyof WledSegmentDef): unknown {
  if (seg && seg[key] !== undefined && seg[key] !== null) return seg[key];
  return wled[key as keyof WledLike];
}

export function buildRecalledSegment(
  seg: Partial<WledSegmentDef> | undefined,
  wled: WledLike,
  should: (prop: RecallProp, memVal: boolean) => boolean,
  m: MemoryLike,
  index: number,
): WledSegmentDef {
  const out: WledSegmentDef = { id: Number(seg?.id ?? index), start: 0, stop: 0 };
  if (should('segments', m.segments) && seg && isActiveSegment(seg)) {
    out.start = Number(seg.start);
    out.stop = Number(seg.stop);
    (['of', 'grp', 'spc', 'bm', 'rev', 'mi', 'bri', 'on'] as const).forEach(k => {
      if (seg[k] !== undefined && seg[k] !== null) (out as Record<string, unknown>)[k] = seg[k];
    });
  } else {
    delete (out as { start?: number }).start;
    delete (out as { stop?: number }).stop;
  }
  if (should('effect', m.effect)) {
    const fx = pickSegOrWled(seg, wled, 'fx');
    if (fx !== undefined && fx !== null) out.fx = fx as number;
  }
  if (should('palette', m.palette)) {
    const pal = pickSegOrWled(seg, wled, 'pal');
    if (pal !== undefined && pal !== null) out.pal = pal as number;
  }
  if (should('parameters', m.parameters)) {
    (['sx', 'ix', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3'] as const).forEach(k => {
      const v = pickSegOrWled(seg, wled, k);
      if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
    });
  }
  if (should('color', m.color)) {
    const col = pickSegOrWled(seg, wled, 'col');
    if (col !== undefined && col !== null) {
      const c = col as number[][];
      out.col = Array.isArray(c[0]) ? c.map(row => [...row]) : c;
    }
  }
  if (!isActiveSegment(out)) {
    const { start: _s, stop: _t, ...rest } = out;
    return rest as WledSegmentDef;
  }
  return out;
}

/** Disable unused WLED segment ids so stale splits do not stay lit (mirrors web tool). */
export function finalizeWledSegmentPayload(payload: {
  on?: boolean;
  seg?: WledSegmentDef[];
}): { on: boolean; seg: WledSegmentDef[] } {
  const segs = payload?.seg;
  if (!Array.isArray(segs) || segs.length === 0) {
    return { on: payload?.on ?? true, seg: segs ?? [] };
  }
  const active = segs.filter(s => Number(s.stop ?? 0) > Number(s.start ?? 0));
  if (active.length === 0) return { on: true, seg: segs };
  const activeIds = new Set(active.map(s => Number(s.id ?? 0)));
  const merged = active.map(s => ({ ...s }));
  if (!activeIds.has(0)) merged.push({ id: 0, stop: 0, start: 0 });
  for (let id = 1; id < WLED_MAX_SEG; id++) {
    if (!activeIds.has(id)) merged.push({ id, stop: 0, start: 0 });
  }
  return { on: true, seg: merged };
}

export function buildRecalledSegmentsFromPreset(
  preset: { wled?: WledLike & { seg?: WledSegmentDef[] }; segmentLayoutId?: string; memory?: MemoryLike },
  recall: RecallLike,
  layouts: CustomSegmentLayout[],
  defaultMemory: MemoryLike,
): WledSegmentDef[] {
  const w = preset.wled ?? {};
  const m = preset.memory ?? defaultMemory;
  const should = (prop: RecallProp, memVal: boolean): boolean => {
    const r = recall[prop];
    if (r === 'always') return true;
    if (r === 'never') return false;
    return memVal;
  };
  const active = activeSegmentsFromPreset(preset, layouts).filter(isActiveSegment);
  if (should('segments', m.segments) && active.length > 0) {
    return active.map((seg, i) => buildRecalledSegment(seg, w, should, m, i));
  }
  const base = active[0] || { id: 0, start: 0, stop: STRIP_LED_COUNT };
  const seg = buildRecalledSegment(base, w, should, m, 0);
  // Partial segment updates skip geometry; if seg 0 is inactive on WLED nothing changes.
  if (!isActiveSegment(seg)) {
    seg.start = 0;
    seg.stop = STRIP_LED_COUNT;
  }
  return [seg];
}

export function activeSegmentsFromPreset(
  preset: { wled?: { seg?: WledSegmentDef[] }; segmentLayoutId?: string },
  layouts: CustomSegmentLayout[],
): WledSegmentDef[] {
  const linked = preset.segmentLayoutId
    ? layouts.find(l => l.id === preset.segmentLayoutId)
    : undefined;
  const fromLayout = (linked?.segments ?? [])
    .map(s => normalizeSegmentDef(s))
    .filter((s): s is WledSegmentDef => s !== null);
  const fromPreset = (preset.wled?.seg ?? [])
    .map(s => normalizeSegmentDef(s))
    .filter((s): s is WledSegmentDef => s !== null);
  return mergeSegmentsById(fromLayout, fromPreset).filter(isActiveSegment);
}


export function summarizeLayout(layout: CustomSegmentLayout): string {
  if (layout.segments.length === 0) return 'No segments';
  return layout.segments
    .map(s => `#${s.id} LED ${s.start}–${s.stop}`)
    .join(' · ');
}

/** Apply a preset's segment layout to the strip (for MB region capture workflow). */
export function buildPresetLayoutPayload(
  preset: { wled?: { seg?: WledSegmentDef[] }; segmentLayoutId?: string },
  layouts: CustomSegmentLayout[],
): { on: boolean; seg: WledSegmentDef[] } | null {
  const linked = preset.segmentLayoutId
    ? layouts.find(l => l.id === preset.segmentLayoutId)
    : undefined;
  if (linked?.segments.length) {
    return { on: true, seg: linked.segments.map(s => ({ ...s })) };
  }
  const seg = preset.wled?.seg;
  if (Array.isArray(seg) && seg.length > 0) {
    return {
      on: true,
      seg: seg.map(s => normalizeSegmentDef(s)).filter((s): s is WledSegmentDef => s !== null),
    };
  }
  return null;
}

