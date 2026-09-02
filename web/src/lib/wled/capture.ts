// WLED capture payloads are loosely shaped JSON.
// @ts-nocheck
import { finalizeWledSegmentPayload } from '../ble/chunking';
import { blendModeIdToBm, FIVE_CORNER_IDS, FIVE_CORNER_RGB, STRIP_LED_COUNT } from '../ble/mbConstants';
import {
  customSegmentMapFromWledSegs,
  presetWledForBoard,
  resolvePresetLedmap,
  segmentMapSegmentToWledDef,
  withSegRefDefaults,
} from '../ble/mbMapping';

export { resolvePresetLedmap };

export function segRefToPreview(ref, col) {
  const fx = (ref.fx ?? -1) >= 0 ? ref.fx : 0;
  const seg = {
    id: ref.id, start: ref.start, stop: ref.stop,
    grp: ref.grp ?? 1, spc: ref.spc ?? 0, of: ref.of ?? 0,
    rev: !!ref.rev, mi: !!ref.mi,
    fx, sx: ref.sx ?? 128, ix: ref.ix ?? 128,
    col: [col],
  };
  if ((ref.pal ?? -1) >= 0) seg.pal = ref.pal;
  return seg;
}

export function buildSegmentHighlightPreview(segments, target) {
  const segs = [{ id: 0, start: 0, stop: STRIP_LED_COUNT, fx: 0, col: [[0, 0, 0]] }];
  (segments[target] || []).forEach(ref => {
    if (ref.stop <= ref.start) return;
    segs.push(segRefToPreview(ref, [255, 255, 255]));
  });
  return { on: true, seg: segs };
}

export function buildFiveCornerPreview(segments) {
  const segs = [{ id: 0, start: 0, stop: STRIP_LED_COUNT, fx: 0, col: [[0, 0, 0]] }];
  FIVE_CORNER_IDS.forEach((id, i) => {
    (segments[id] || []).forEach(ref => {
      if (ref.stop <= ref.start) return;
      segs.push(segRefToPreview(ref, FIVE_CORNER_RGB[i]));
    });
  });
  return { on: true, seg: segs };
}

export async function postWledState(ip, payload) {
  const host = ip.trim();
  if (!host) throw new Error('Enter a WLED IP');
  const res = await fetch(`http://${host}/json/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('WLED rejected request');
}

export const SEGMENT_LAYOUT_FIELDS = [
  'fx', 'pal', 'sx', 'ix', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3', 'col',
  'of', 'grp', 'spc', 'bm', 'rev', 'mi', 'bri', 'on',
];

export const WLED_BLEND_MODES = [
  { value: 0, label: 'Top / Default' },
  { value: 1, label: 'Bottom / None' },
  { value: 2, label: 'Add' },
  { value: 3, label: 'Subtract' },
  { value: 4, label: 'Difference' },
  { value: 5, label: 'Average' },
  { value: 6, label: 'Multiply' },
  { value: 7, label: 'Divide' },
  { value: 8, label: 'Lighten' },
  { value: 9, label: 'Darken' },
  { value: 10, label: 'Screen' },
  { value: 11, label: 'Overlay' },
  { value: 12, label: 'Hard Light' },
  { value: 13, label: 'Soft Light' },
  { value: 14, label: 'Dodge' },
  { value: 15, label: 'Burn' },
  { value: 32, label: 'Stencil' },
];

export function normalizeSegmentDef(raw) {
  const start = Number(raw.start ?? 0);
  const stop = Number(raw.stop ?? 0);
  if (stop <= start) return null;
  const seg = { id: Number(raw.id ?? 0), start, stop };
  SEGMENT_LAYOUT_FIELDS.forEach(k => {
    if (raw[k] !== undefined && raw[k] !== null) seg[k] = raw[k];
  });
  // Preserve map-local string id for segmentOverrides lookup (not a WLED field).
  if (typeof raw.mapLocalId === 'string' && raw.mapLocalId) seg.mapLocalId = raw.mapLocalId;
  return seg;
}

export function formatSegRange(seg) {
  const start = Number(seg?.start ?? 0);
  const stop = Number(seg?.stop ?? 0);
  if (stop <= start) return 'LED ?';
  if (stop - start === 1) return `LED ${start}`;
  return `LED ${start}-${stop - 1}`;
}

export function formatSegLabel(seg) {
  return `Seg #${seg.id} · ${formatSegRange(seg)}`;
}

export function isActiveSegment(seg) {
  return Number(seg?.stop ?? 0) > Number(seg?.start ?? 0);
}

export function parseWledStateSegments(state) {
  const segList = state?.seg ?? state?.state?.seg;
  if (!Array.isArray(segList)) return [];
  return segList.map(normalizeSegmentDef).filter(Boolean);
}

export function summarizeLayout(layout) {
  if (!layout?.segments?.length) return 'No segments';
  return layout.segments.map(formatSegLabel).join(' · ');
}

export function buildLayoutPayload(layout) {
  return finalizeWledSegmentPayload({ on: true, seg: layout.segments.map(s => ({ ...s })) });
}

export async function fetchWledFullStateFromIp(ip) {
  const host = ip.trim();
  if (!host) throw new Error('Enter a WLED IP');
  const res = await fetch(`http://${host}/json/state`);
  if (!res.ok) throw new Error('Could not read WLED state');
  return res.json();
}

export async function fetchWledSegmentsFromIp(ip) {
  const state = await fetchWledFullStateFromIp(ip);
  const segments = parseWledStateSegments(state);
  if (!segments.length) throw new Error('No active segments in WLED state');
  return segments;
}

export function resolvePaletteName(pal, palettes) {
  if (pal == null || pal === '') return '';
  return (palettes || []).find(p => p.id === pal)?.name || `Palette ${pal}`;
}

export const DEFAULT_WLED_CAPTURE_OPTS = {
  effect: true, palette: true, parameters: true, color: true, segments: true,
};

export function wledCaptureLabels() {
  return {
    effect: { title: 'Effect', hint: 'fx + effect name from segment 0' },
    palette: { title: 'Palette', hint: 'pal + palette name from segment 0' },
    parameters: { title: 'Parameters', hint: 'Speed, intensity, custom sliders (sx, ix, c1-c3, o1-o3)' },
    color: { title: 'Effect colors', hint: 'RGB slots (col) for solid / dual / triple effects' },
    segments: { title: 'Segment layout', hint: 'Active segment ranges (id, start LED, stop LED)' },
  };
}

export function captureSegmentFromRaw(raw, opts) {
  const seg = {};
  if (opts.segments) {
    seg.id = Number(raw.id ?? 0);
    seg.start = Number(raw.start ?? 0);
    seg.stop = Number(raw.stop ?? 0);
    ['of', 'grp', 'spc', 'bm', 'rev', 'mi', 'bri', 'on'].forEach(k => {
      if (raw[k] !== undefined && raw[k] !== null) seg[k] = raw[k];
    });
  } else if (raw.id !== undefined && raw.id !== null) {
    seg.id = Number(raw.id);
  }
  if (opts.effect && raw.fx !== undefined && raw.fx !== null) seg.fx = raw.fx;
  if (opts.palette && raw.pal !== undefined && raw.pal !== null) seg.pal = raw.pal;
  if (opts.parameters) {
    ['sx', 'ix', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3'].forEach(k => {
      if (raw[k] !== undefined && raw[k] !== null) seg[k] = raw[k];
    });
  }
  if (opts.color && raw.col !== undefined && raw.col !== null) {
    seg.col = Array.isArray(raw.col?.[0]) ? raw.col.map(c => [...c]) : [...raw.col];
  }
  return seg;
}

export function mergeSegmentsById(base, incoming) {
  const map = new Map();
  (base || []).forEach(seg => map.set(Number(seg.id ?? 0), { ...seg }));
  (incoming || []).forEach(seg => {
    const id = Number(seg.id ?? 0);
    map.set(id, { ...(map.get(id) || { id }), ...seg, id });
  });
  return [...map.values()].sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0));
}

export function activeSegmentsFromPreset(preset, segmentMaps) {
  if (preset?.segmentMapId === '__custom__' && preset?.customSegmentMap) {
    return (preset.customSegmentMap.segments || [])
      .map((s) => normalizeSegmentDef(segmentMapSegmentToWledDef(s) || s))
      .filter(Boolean)
      .filter(isActiveSegment);
  }
  if (preset?.segmentMapId) {
    const linked = (segmentMaps || []).find((m) => m.id === preset.segmentMapId);
    return (linked?.segments || [])
      .map((s) => normalizeSegmentDef(segmentMapSegmentToWledDef(s) || s))
      .filter(Boolean)
      .filter(isActiveSegment);
  }
  const fromPreset = (preset?.global?.seg || preset?.wled?.seg || [])
    .map((s) => normalizeSegmentDef(s))
    .filter(Boolean);
  return fromPreset.filter(isActiveSegment);
}

/** Resolve a {mode, swatchId?, value?} color ref to a hex string. */
export function resolveColorRef(ref, colorLibrary) {
  if (!ref) return null;
  if (ref.mode === 'custom' && ref.value) return ref.value;
  if (ref.mode === 'swatch' && ref.swatchId) {
    const swatch = (colorLibrary || []).find((c) => c.id === ref.swatchId);
    return swatch?.hex || null;
  }
  return null;
}

/** Flatten global.colorRefs (or legacy global.col) to a WLED RGB col array. */
export function resolveGlobalCol(global, colorLibrary) {
  const refs = global?.colorRefs;
  if (Array.isArray(refs) && refs.length) {
    return refs.map((ref) => hexToRgbTriple(resolveColorRef(ref, colorLibrary) || '#000000'));
  }
  if (global?.col) {
    if (typeof global.col[0] === 'number') return [[...global.col]];
    return global.col.map((c) => (Array.isArray(c) ? [...c] : c));
  }
  return undefined;
}

/** Return a global look object with `col` resolved for WLED payloads. */
export function withResolvedGlobalCol(global, colorLibrary) {
  const g = global || {};
  const col = resolveGlobalCol(g, colorLibrary);
  if (!col) {
    const { colorRefs, ...rest } = g;
    return rest;
  }
  const { colorRefs, ...rest } = g;
  return { ...rest, col };
}

/** Resolve one property for one segment using rule/preset override semantics.
 *  stored  → segment-map def's own value (or global if absent)
 *  default → the global look
 *  custom  → the override's own value
 *  swatch  → look up swatchId in colorLibrary (color slots only)
 *  (no override entry for this prop) → same as 'stored'
 */
export function resolveSegProp(seg, global, overrideEntry, key, fallback, colorLibrary) {
  const mode = overrideEntry?.mode || 'stored';
  if (mode === 'swatch') {
    const hex = resolveColorRef(overrideEntry, colorLibrary);
    return hex != null ? hex : fallback;
  }
  if (mode === 'custom' && overrideEntry.value !== undefined) return overrideEntry.value;
  if (mode === 'default') return global?.[key] ?? fallback;
  // stored
  return seg?.[key] ?? global?.[key] ?? fallback;
}

export function hexToRgbTriple(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

/** @deprecated Prefer resolveSegProp — kept for any lingering callers. */
export function pickSegOrWled(seg, wled, key, perSegment = false) {
  if (perSegment && seg && seg[key] !== undefined && seg[key] !== null) return seg[key];
  if (wled && wled[key] !== undefined && wled[key] !== null) return wled[key];
  return seg ? seg[key] : undefined;
}

export function buildRecalledSegment(seg, global, should, m, index, overrideEntry, colorLibrary, sourceIsGlobal = false) {
  const out = { id: Number(seg?.id ?? index) };
  if (should('segments', m.segments) && seg && isActiveSegment(seg)) {
    out.start = Number(seg.start);
    out.stop = Number(seg.stop);
    ['of', 'grp', 'spc', 'bm', 'rev', 'mi', 'bri', 'on'].forEach((k) => {
      if (seg[k] !== undefined && seg[k] !== null) out[k] = seg[k];
    });
    // Blend lives in segmentOverrides as {mode,value} (string id or numeric bm).
    // Map seeding only copies seg.bm — apply the override here (mirrors firmware).
    const blendEntry = overrideEntry?.blend;
    const blendMode = blendEntry?.mode || 'stored';
    if (blendMode === 'custom' && blendEntry.value !== undefined && blendEntry.value !== null) {
      out.bm = typeof blendEntry.value === 'number'
        ? Number(blendEntry.value)
        : blendModeIdToBm(blendEntry.value);
    } else if (blendMode === 'default') {
      out.bm = 0;
    }
  }
  // In 'global' source mode, every segment implicitly uses the preset's global
  // look unless a segmentOverrides entry explicitly says otherwise — mirrors how
  // BLE rules replicate {"mode":"default"} onto every segment for 'global' mode.
  const effectiveFxEntry = overrideEntry?.fx ?? (sourceIsGlobal ? { mode: 'default' } : undefined);
  const effectivePalEntry = overrideEntry?.pal ?? (sourceIsGlobal ? { mode: 'default' } : undefined);

  if (should('effect', m.effect)) {
    const fx = resolveSegProp(seg, global, effectiveFxEntry, 'fx', 0);
    if (fx !== undefined && fx !== null) out.fx = fx;
  }
  if (should('palette', m.palette)) {
    const pal = resolveSegProp(seg, global, effectivePalEntry, 'pal', 0);
    if (pal !== undefined && pal !== null) out.pal = pal;
  }
  if (should('parameters', m.parameters)) {
    ['sx', 'ix', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3'].forEach((k) => {
      const entry = overrideEntry?.[k] ?? (sourceIsGlobal ? { mode: 'default' } : undefined);
      const v = resolveSegProp(seg, global, entry, k, undefined);
      if (v !== undefined && v !== null) out[k] = v;
    });
  }
  if (should('color', m.color)) {
    const hasColorOverride = overrideEntry?.colors?.some(
      (c) => c?.mode === 'custom' || c?.mode === 'default' || c?.mode === 'swatch',
    );
    if (hasColorOverride) {
      out.col = [0, 1, 2].map((i) => {
        const c = overrideEntry.colors?.[i];
        if (c?.mode === 'swatch' || (c?.mode === 'custom' && c.value)) {
          const hex = resolveColorRef(c, colorLibrary);
          return hex ? hexToRgbTriple(hex) : (seg?.col?.[i] || global?.col?.[i] || [0, 0, 0]);
        }
        if (c?.mode === 'default') return global?.col?.[i] || [0, 0, 0];
        // stored — segment's own authored color wins over the global look
        return seg?.col?.[i] || global?.col?.[i] || [0, 0, 0];
      });
    } else if (sourceIsGlobal) {
      // 'global' source mode with no explicit color override → every slot behaves
      // as "default" → always use the preset's global look, ignore segment-map colors.
      if (global?.col) out.col = global.col.map((c) => (Array.isArray(c) ? [...c] : c));
    } else if (seg?.col) {
      // 'perSegment' mode, no override entries → "stored" for every slot → segment's own color wins.
      out.col = Array.isArray(seg.col[0]) ? seg.col.map((c) => [...c]) : [...seg.col];
    } else if (global?.col) {
      out.col = global.col.map((c) => (Array.isArray(c) ? [...c] : c));
    }
  }
  return out;
}

export function applyWledStateCapture(preset, state, catalog, opts, updateMemory = true) {
  const rawSegs = parseWledStateSegments(state);
  const primary = rawSegs[0];
  if (!primary) throw new Error('No active segments in WLED state');
  const global = { ...(preset.global || preset.wled || {}) };
  const memory = { ...preset.memory };
  let segmentMapId = preset.segmentMapId;
  const capturedSegs = rawSegs.map(seg => captureSegmentFromRaw(seg, opts)).filter(Boolean);

  if (opts.effect) {
    if (primary.fx === undefined) throw new Error('Segment 0 has no effect (fx) to import');
    global.fx = primary.fx;
    global.fxName = (catalog.effects || []).find(e => e.id === primary.fx)?.name || global.fxName || `Effect ${primary.fx}`;
    if (updateMemory) memory.effect = true;
  }
  if (opts.palette) {
    if (primary.pal === undefined) throw new Error('Segment 0 has no palette (pal) to import');
    global.pal = primary.pal;
    global.palName = resolvePaletteName(primary.pal, catalog.palettes);
    if (updateMemory) memory.palette = true;
  }
  if (opts.parameters) {
    ['sx', 'ix', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3'].forEach(k => {
      if (primary[k] !== undefined && primary[k] !== null) global[k] = primary[k];
    });
    if (updateMemory) memory.parameters = true;
  }
  if (opts.color) {
    if (primary.col !== undefined && primary.col !== null) {
      const col = Array.isArray(primary.col[0]) ? primary.col.map((c) => [...c]) : [...primary.col];
      global.col = col;
      const rows = typeof col[0] === 'number' ? [col] : col;
      global.colorRefs = rows
        .filter((rgb) => Array.isArray(rgb) && rgb.length >= 3)
        .map((rgb) => ({
          mode: 'custom',
          value: `#${[rgb[0], rgb[1], rgb[2]]
            .map((x) => Math.max(0, Math.min(255, Math.round(Number(x) || 0))).toString(16).padStart(2, '0'))
            .join('')}`,
        }));
      if (updateMemory) memory.color = true;
    } else {
      delete global.col;
      global.colorRefs = [];
      if (updateMemory) memory.color = false;
    }
  }
  if (capturedSegs.length && (opts.effect || opts.palette || opts.parameters || opts.color || opts.segments)) {
    // Import geometry as a preset-local custom map (same as Maps → Custom).
    // Keep global.seg cleared so segmentMapId + customSegmentMap are authoritative.
    delete global.seg;
    const customSegmentMap = customSegmentMapFromWledSegs(
      capturedSegs.filter((seg) => !opts.segments || isActiveSegment(seg)),
    );
    segmentMapId = '__custom__';
    if (opts.segments && capturedSegs.length > 0) {
      if (updateMemory) memory.segments = capturedSegs.some(isActiveSegment);
    }
    return {
      ...preset,
      global,
      memory,
      segmentMapId,
      customSegmentMap,
      segmentOverrides: {},
      segmentSourceMode: preset.segmentSourceMode || 'global',
    };
  }
  if (opts.segments && capturedSegs.length > 0) {
    if (updateMemory) memory.segments = capturedSegs.some(isActiveSegment);
  }

  return {
    ...preset,
    global,
    memory,
    segmentMapId,
    segmentOverrides: segmentMapId ? (preset.segmentOverrides || {}) : {},
    segmentSourceMode: preset.segmentSourceMode || 'global',
  };
}

export function formatWledSegLabel(seg) {
  return formatSegLabel(seg);
}

export function formatWledSegSelectionSummary(refs) {
  if (!refs?.length) return 'None assigned';
  return refs.map(formatSegLabel).join(' · ');
}

export function isValidSegRef(ref) {
  return Number.isInteger(ref.id) && ref.id >= 0 && ref.id <= 31
    && Number.isInteger(ref.start) && Number.isInteger(ref.stop)
    && ref.start >= 0 && ref.stop <= STRIP_LED_COUNT && ref.stop > ref.start;
}

export function parseSegRefFields(idStr, startStr, stopStr) {
  const id = parseInt(idStr, 10);
  const start = parseInt(startStr, 10);
  const stop = parseInt(stopStr, 10);
  const ref = { id, start, stop };
  return isValidSegRef(ref) ? ref : null;
}

export function defaultNewSegRef(refs) {
  const used = new Set((refs || []).map(r => r.id));
  let id = 0;
  while (used.has(id) && id < 32) id++;
  return withSegRefDefaults({ id, start: 0, stop: STRIP_LED_COUNT });
}

export function refsFromSnapshotIds(snapshot, selectedIds) {
  const set = new Set(selectedIds);
  return snapshot.filter(s => set.has(s.id)).map(s => ({ id: s.id, start: s.start, stop: s.stop }));
}

export function updateRefAt(refs, index, ref) {
  const next = [...(refs || [])];
  next[index] = ref;
  return next;
}

export function removeRefAt(refs, index) {
  return (refs || []).filter((_, i) => i !== index);
}

export function appendSegRef(refs, ref) {
  const without = (refs || []).filter(r => r.id !== ref.id);
  return [...without, ref];
}

export function toggleSnapshotSelection(snapshot, currentRefs, wledSegId) {
  const seg = snapshot.find(s => s.id === wledSegId);
  if (!seg) return currentRefs || [];
  const refs = currentRefs || [];
  if (refs.some(r => r.id === wledSegId)) return refs.filter(r => r.id !== wledSegId);
  return appendSegRef(refs, { id: seg.id, start: seg.start, stop: seg.stop });
}

export function pruneRefsToSnapshot(snapshot, refs) {
  const list = refs || [];
  const snapIds = new Set(snapshot.map(s => s.id));
  const manual = list.filter(r => !snapIds.has(r.id));
  const fromSnap = refsFromSnapshotIds(
    snapshot,
    list.map(r => r.id).filter(id => snapIds.has(id)),
  );
  return [...manual, ...fromSnap];
}

export function buildPresetLayoutPayload(preset, segmentMaps) {
  if (!preset) return null;
  const wled = presetWledForBoard(preset, segmentMaps);
  if (!wled.seg?.length) return null;
  return {
    on: true,
    ledmap: resolvePresetLedmap(preset, segmentMaps),
    seg: wled.seg.map(s => ({ ...s })),
  };
}
