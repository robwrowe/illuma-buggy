/**
 * WLED segment layout library — reusable multi-segment configs for presets.
 * Resolver semantics mirror web `capture.js` / firmware `SegmentResolve.cpp`.
 */

/** Match firmware STRIP_LED_COUNT — full strip when applying single-segment presets. */
export const STRIP_LED_COUNT = 100;
export const WLED_MAX_SEG = 16;

export interface WledSegmentDef {
  id: number;
  start: number;
  stop: number;
  /** Segment-map local string id for segmentOverrides lookup (web mapLocalId). */
  mapLocalId?: string;
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

/** Shared mb.segmentMaps entry (authored on web, synced via MB mapping). */
export interface SharedSegmentMap {
  id: string;
  name: string;
  ledmap: number;
  segments: unknown[];
}

export type PresetOverrideMode = 'stored' | 'default' | 'custom' | 'swatch';

export interface PresetOverrideEntry {
  mode: PresetOverrideMode;
  value?: number | string | boolean;
  swatchId?: string;
}

export interface PresetColorRefEntry {
  mode: 'swatch' | 'custom';
  swatchId?: string;
  value?: string;
}

export interface PresetSegmentOverride {
  fx?: PresetOverrideEntry;
  pal?: PresetOverrideEntry;
  sx?: PresetOverrideEntry;
  ix?: PresetOverrideEntry;
  c1?: PresetOverrideEntry;
  c2?: PresetOverrideEntry;
  c3?: PresetOverrideEntry;
  o1?: PresetOverrideEntry;
  o2?: PresetOverrideEntry;
  o3?: PresetOverrideEntry;
  blend?: PresetOverrideEntry;
  colors?: PresetOverrideEntry[];
}

export interface PresetColorSwatch {
  id: string;
  name: string;
  hex: string;
}

export interface PresetCustomSegmentMap {
  id: string;
  name: string;
  ledmap: number;
  segments: unknown[];
}

const LAYOUT_FIELDS: (keyof WledSegmentDef)[] = [
  'id', 'start', 'stop', 'mapLocalId', 'fx', 'pal', 'sx', 'ix', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3', 'col',
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
      (seg as unknown as Record<string, unknown>)[key] = v;
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
    map.set(id, { ...(map.get(id) || { id, start: 0, stop: 0 }), ...seg, id });
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
  colorRefs?: PresetColorRefEntry[];
};

function blendModeToBm(blend: unknown): number {
  if (typeof blend === 'number' && Number.isFinite(blend)) return blend;
  if (typeof blend !== 'string') return 0;
  const map: Record<string, number> = {
    top: 0, normal: 0, bottom: 1, none: 1, add: 2, subtract: 3, difference: 4,
    average: 5, multiply: 6, divide: 7, lighten: 8, darken: 9, screen: 10,
    overlay: 11, hardLight: 12, softLight: 13, dodge: 14, burn: 15, stencil: 32,
  };
  return map[blend] ?? 0;
}

function hexToRgbArray(hex: string): number[] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

/** Convert a segment-map authored segment into a WLED-shaped def (+ mapLocalId). */
export function segmentMapSegmentToWledDef(seg: unknown): WledSegmentDef | null {
  if (!seg || typeof seg !== 'object') return null;
  const s = seg as Record<string, unknown>;
  if (s.enabled === false) return null;
  const start = Number(s.start ?? 0);
  const stop = Number(s.stop ?? 0);
  if (stop <= start) return null;
  const localId = typeof s.id === 'string' && s.id ? s.id : undefined;
  const wledId = Number.isFinite(Number(s.wledSegId))
    ? Number(s.wledSegId)
    : (typeof s.id === 'number' ? s.id : 0);
  const out: WledSegmentDef = {
    id: wledId,
    start,
    stop,
    ...(localId ? { mapLocalId: localId } : {}),
    grp: Number(s.grp ?? 1),
    spc: Number(s.spc ?? 0),
    of: Number(s.of ?? 0),
    rev: !!s.rev,
    mi: !!s.mi,
    bm: s.bm != null ? Number(s.bm) : blendModeToBm(s.blend),
  };
  if (Number.isFinite(Number(s.fx)) && Number(s.fx) >= 0) out.fx = Number(s.fx);
  if (Number.isFinite(Number(s.pal)) && Number(s.pal) >= 0) out.pal = Number(s.pal);
  if (Number.isFinite(Number(s.sx))) out.sx = Number(s.sx);
  if (Number.isFinite(Number(s.ix))) out.ix = Number(s.ix);
  const colors = Array.isArray(s.colors) ? s.colors : [];
  const col: number[][] = [];
  for (let i = 0; i < 3; i++) {
    const hex = colors[i];
    if (typeof hex === 'string') {
      const rgb = hexToRgbArray(hex);
      if (rgb) col.push(rgb);
    }
  }
  if (col.length) out.col = col;
  return out;
}

export function resolveColorRef(
  ref: PresetOverrideEntry | PresetColorRefEntry | undefined,
  colorLibrary: PresetColorSwatch[],
): string | null {
  if (!ref) return null;
  if (ref.mode === 'custom' && typeof (ref as PresetColorRefEntry).value === 'string') {
    return (ref as PresetColorRefEntry).value || null;
  }
  if (ref.mode === 'swatch' && (ref as PresetColorRefEntry).swatchId) {
    return colorLibrary.find(c => c.id === (ref as PresetColorRefEntry).swatchId)?.hex ?? null;
  }
  return null;
}

export function hexToRgbTriple(hex: string): number[] {
  return hexToRgbArray(hex) || [0, 0, 0];
}

/** Flatten global colorRefs (or legacy col) to a WLED RGB col array. */
export function resolveGlobalCol(
  wled: WledLike,
  colorLibrary: PresetColorSwatch[],
  colorRefs?: PresetColorRefEntry[],
): number[][] | undefined {
  const refs = colorRefs ?? wled.colorRefs;
  if (Array.isArray(refs) && refs.length) {
    return refs.map(ref => hexToRgbTriple(resolveColorRef(ref, colorLibrary) || '#000000'));
  }
  if (wled.col) {
    if (typeof wled.col[0] === 'number') return [[...(wled.col as unknown as number[])]];
    return wled.col.map(c => (Array.isArray(c) ? [...c] : c));
  }
  return undefined;
}

export function withResolvedGlobalCol(
  wled: WledLike,
  colorLibrary: PresetColorSwatch[],
  colorRefs?: PresetColorRefEntry[],
): WledLike {
  const col = resolveGlobalCol(wled, colorLibrary, colorRefs);
  if (!col) {
    const { colorRefs: _cr, ...rest } = wled;
    return rest;
  }
  const { colorRefs: _cr, ...rest } = wled;
  return { ...rest, col };
}

/**
 * Resolve one property for one segment using preset override semantics.
 * stored  → segment-map def's own value (or global if absent)
 * default → the global look
 * custom  → the override's own value
 * (no override entry) → same as 'stored'
 */
export function resolveSegProp(
  seg: Partial<WledSegmentDef> | undefined,
  wled: WledLike,
  overrideEntry: PresetOverrideEntry | undefined,
  key: keyof WledSegmentDef,
  fallback: unknown,
): unknown {
  const mode = overrideEntry?.mode ?? 'stored';
  if (mode === 'custom' && overrideEntry?.value !== undefined) return overrideEntry.value;
  if (mode === 'default') return (wled as Record<string, unknown>)[key] ?? fallback;
  return (seg as Record<string, unknown> | undefined)?.[key]
    ?? (wled as Record<string, unknown>)[key]
    ?? fallback;
}

/**
 * @deprecated Prefer resolveSegProp — kept for any lingering callers.
 * Single-segment: preset-level wled wins. Multi-segment: each segment's own value wins first.
 */
export function pickSegOrWled(
  seg: Partial<WledSegmentDef> | undefined,
  wled: WledLike,
  key: keyof WledSegmentDef,
  perSegment = false,
): unknown {
  if (perSegment && seg && seg[key] !== undefined && seg[key] !== null) return seg[key];
  const fromWled = wled[key as keyof WledLike];
  if (fromWled !== undefined && fromWled !== null) return fromWled;
  return seg ? seg[key] : undefined;
}

export function buildRecalledSegment(
  seg: Partial<WledSegmentDef> | undefined,
  wled: WledLike,
  should: (prop: RecallProp, memVal: boolean) => boolean,
  m: MemoryLike,
  index: number,
  overrideEntry?: PresetSegmentOverride,
  colorLibrary: PresetColorSwatch[] = [],
  sourceIsGlobal = false,
): WledSegmentDef {
  const out: WledSegmentDef = { id: Number(seg?.id ?? index), start: 0, stop: 0 };
  if (should('segments', m.segments) && seg && isActiveSegment(seg)) {
    out.start = Number(seg.start);
    out.stop = Number(seg.stop);
    (['of', 'grp', 'spc', 'bm', 'rev', 'mi', 'bri', 'on'] as const).forEach(k => {
      if (seg[k] !== undefined && seg[k] !== null) {
        (out as unknown as Record<string, unknown>)[k] = seg[k];
      }
    });
    // Blend lives in segmentOverrides as {mode,value} (string id or numeric bm).
    // Map seeding only copies seg.bm — apply the override here (mirrors firmware).
    const blendEntry = overrideEntry?.blend;
    const blendMode = blendEntry?.mode ?? 'stored';
    if (blendMode === 'custom' && blendEntry?.value !== undefined && blendEntry.value !== null) {
      out.bm = blendModeToBm(blendEntry.value);
    } else if (blendMode === 'default') {
      out.bm = 0;
    }
  } else {
    delete (out as { start?: number }).start;
    delete (out as { stop?: number }).stop;
  }
  // In 'global' source mode, every segment implicitly uses the preset's global
  // look unless a segmentOverrides entry explicitly says otherwise — mirrors how
  // BLE rules replicate {"mode":"default"} onto every segment for 'global' mode.
  const effectiveFxEntry = overrideEntry?.fx ?? (sourceIsGlobal ? { mode: 'default' } : undefined);
  const effectivePalEntry = overrideEntry?.pal ?? (sourceIsGlobal ? { mode: 'default' } : undefined);

  if (should('effect', m.effect)) {
    const fx = resolveSegProp(seg, wled, effectiveFxEntry, 'fx', 0);
    if (fx !== undefined && fx !== null) out.fx = fx as number;
  }
  if (should('palette', m.palette)) {
    const pal = resolveSegProp(seg, wled, effectivePalEntry, 'pal', 0);
    if (pal !== undefined && pal !== null) out.pal = pal as number;
  }
  if (should('parameters', m.parameters)) {
    (['sx', 'ix', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3'] as const).forEach(k => {
      const entry = overrideEntry?.[k] ?? (sourceIsGlobal ? { mode: 'default' } : undefined);
      const v = resolveSegProp(seg, wled, entry, k, undefined);
      if (v !== undefined && v !== null) (out as unknown as Record<string, unknown>)[k] = v;
    });
  }
  if (should('color', m.color)) {
    const hasColorOverride = overrideEntry?.colors?.some(
      c => c?.mode === 'custom' || c?.mode === 'default' || c?.mode === 'swatch',
    );
    if (hasColorOverride) {
      out.col = [0, 1, 2].map(i => {
        const c = overrideEntry!.colors?.[i];
        if (c?.mode === 'swatch' || (c?.mode === 'custom' && c.value)) {
          const hex = resolveColorRef(c, colorLibrary);
          return hex
            ? hexToRgbTriple(hex)
            : ((seg?.col?.[i] as number[]) || wled.col?.[i] || [0, 0, 0]);
        }
        if (c?.mode === 'default') return wled.col?.[i] || [0, 0, 0];
        // stored — segment's own authored color wins over the global look
        return (seg?.col?.[i] as number[]) || wled.col?.[i] || [0, 0, 0];
      });
    } else if (sourceIsGlobal) {
      // 'global' source mode with no explicit color override → every slot behaves
      // as "default" → always use the preset's global look, ignore segment-map colors.
      if (wled.col) out.col = wled.col.map(c => [...c]);
    } else if (seg?.col) {
      // 'perSegment' mode, no override entries → "stored" for every slot → segment's own color wins.
      out.col = Array.isArray(seg.col[0]) ? seg.col.map(c => [...c]) : (seg.col as number[][]);
    } else if (wled.col) {
      out.col = wled.col.map(c => [...c]);
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
  return { on: payload?.on ?? true, seg: merged };
}

function mapSegmentsToWled(segments: unknown[]): WledSegmentDef[] {
  return (segments || [])
    .map(s => {
      const fromMap = segmentMapSegmentToWledDef(s);
      if (fromMap) return fromMap;
      return normalizeSegmentDef(s as Partial<WledSegmentDef>);
    })
    .filter((s): s is WledSegmentDef => s !== null)
    .filter(isActiveSegment);
}

export function activeSegmentsFromPreset(
  preset: {
    wled?: { seg?: WledSegmentDef[] };
    segmentMapId?: string;
    customSegmentMap?: PresetCustomSegmentMap | null;
    segmentLayoutId?: string;
  },
  sharedMaps: SharedSegmentMap[],
  layouts: CustomSegmentLayout[],
): WledSegmentDef[] {
  if (preset.segmentMapId === '__custom__' && preset.customSegmentMap) {
    return mapSegmentsToWled(preset.customSegmentMap.segments ?? []);
  }
  if (preset.segmentMapId) {
    const linked = sharedMaps.find(m => m.id === preset.segmentMapId);
    return mapSegmentsToWled(linked?.segments ?? []);
  }
  // Legacy fallback — old presets saved before segmentMapId existed.
  if (preset.segmentLayoutId) {
    const linked = layouts.find(l => l.id === preset.segmentLayoutId);
    const fromLayout = (linked?.segments ?? [])
      .map(s => normalizeSegmentDef(s))
      .filter((s): s is WledSegmentDef => s !== null);
    const fromPreset = (preset.wled?.seg ?? [])
      .map(s => normalizeSegmentDef(s))
      .filter((s): s is WledSegmentDef => s !== null);
    return mergeSegmentsById(fromLayout, fromPreset).filter(isActiveSegment);
  }
  const fromPreset = (preset.wled?.seg ?? [])
    .map(s => normalizeSegmentDef(s))
    .filter((s): s is WledSegmentDef => s !== null);
  return fromPreset.filter(isActiveSegment);
}

function overrideKeyForSeg(seg: WledSegmentDef): string {
  if (seg.mapLocalId) return seg.mapLocalId;
  return String(seg.id);
}

export function buildRecalledSegmentsFromPreset(
  preset: {
    wled?: WledLike & { seg?: WledSegmentDef[] };
    segmentMapId?: string;
    customSegmentMap?: PresetCustomSegmentMap | null;
    segmentLayoutId?: string;
    segmentOverrides?: Record<string, PresetSegmentOverride>;
    segmentSourceMode?: 'global' | 'perSegment';
    colorLibrary?: PresetColorSwatch[];
    colorRefs?: PresetColorRefEntry[];
    memory?: MemoryLike;
  },
  recall: RecallLike,
  sharedMaps: SharedSegmentMap[],
  layouts: CustomSegmentLayout[],
  defaultMemory: MemoryLike,
): WledSegmentDef[] {
  const colorLibrary = preset.colorLibrary ?? [];
  const w = withResolvedGlobalCol(preset.wled ?? {}, colorLibrary, preset.colorRefs);
  const m = preset.memory ?? defaultMemory;
  const overrides = preset.segmentOverrides ?? {};
  const should = (prop: RecallProp, memVal: boolean): boolean => {
    const r = recall[prop];
    if (r === 'always') return true;
    if (r === 'never') return false;
    return memVal;
  };
  const sourceIsGlobal = preset.segmentSourceMode === 'global';
  const active = activeSegmentsFromPreset(preset, sharedMaps, layouts).filter(isActiveSegment);
  if (should('segments', m.segments) && active.length > 0) {
    return active.map((seg, i) =>
      buildRecalledSegment(
        seg, w, should, m, i, overrides[overrideKeyForSeg(seg)], colorLibrary, sourceIsGlobal,
      ),
    );
  }
  const base = active[0] || { id: 0, start: 0, stop: STRIP_LED_COUNT };
  const seg = buildRecalledSegment(
    base,
    w,
    should,
    m,
    0,
    overrides[overrideKeyForSeg(base)],
    colorLibrary,
    sourceIsGlobal,
  );
  if (!isActiveSegment(seg)) {
    seg.start = 0;
    seg.stop = STRIP_LED_COUNT;
  }
  return [seg];
}

export function resolvePresetLedmap(
  preset: {
    ledmap?: number | null;
    segmentMapId?: string;
    customSegmentMap?: PresetCustomSegmentMap | null;
  },
  sharedMaps: SharedSegmentMap[],
): number {
  if (Number.isInteger(preset.ledmap)) return Math.max(0, Math.min(9, preset.ledmap as number));
  if (preset.segmentMapId === '__custom__') {
    const fromCustom = Number(preset.customSegmentMap?.ledmap);
    return Number.isFinite(fromCustom) ? Math.max(0, Math.min(9, Math.round(fromCustom))) : 0;
  }
  const linked = preset.segmentMapId
    ? sharedMaps.find(m => m.id === preset.segmentMapId)
    : undefined;
  const fromMap = Number(linked?.ledmap);
  return Number.isFinite(fromMap) ? Math.max(0, Math.min(9, Math.round(fromMap))) : 0;
}

export function summarizeLayout(layout: CustomSegmentLayout): string {
  if (layout.segments.length === 0) return 'No segments';
  return layout.segments
    .map(s => `#${s.id} LED ${s.start}–${s.stop}`)
    .join(' · ');
}

/** Apply a preset's segment layout to the strip (for MB region capture workflow). */
export function buildPresetLayoutPayload(
  preset: {
    wled?: { seg?: WledSegmentDef[] };
    segmentMapId?: string;
    customSegmentMap?: PresetCustomSegmentMap | null;
    segmentLayoutId?: string;
    ledmap?: number | null;
  },
  sharedMaps: SharedSegmentMap[],
  layouts: CustomSegmentLayout[],
): { on: boolean; ledmap: number; seg: WledSegmentDef[] } | null {
  const active = activeSegmentsFromPreset(preset, sharedMaps, layouts);
  if (!active.length) return null;
  return {
    on: true,
    ledmap: resolvePresetLedmap(preset, sharedMaps),
    seg: active.map(s => ({ ...s })),
  };
}

/** Coerce opaque mb.segmentMaps entries into SharedSegmentMap[]. */
export function asSharedSegmentMaps(raw: unknown): SharedSegmentMap[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map(m => ({
      id: typeof m.id === 'string' ? m.id : '',
      name: typeof m.name === 'string' ? m.name : '',
      ledmap: Number.isFinite(Number(m.ledmap)) ? Math.max(0, Math.min(9, Number(m.ledmap))) : 0,
      segments: Array.isArray(m.segments) ? m.segments : [],
    }))
    .filter(m => !!m.id);
}
