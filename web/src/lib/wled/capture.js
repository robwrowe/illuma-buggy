import { finalizeWledSegmentPayload } from '../ble/chunking';
import { FIVE_CORNER_IDS, FIVE_CORNER_RGB, STRIP_LED_COUNT } from '../ble/mbConstants';
import { presetWledForBoard, withSegRefDefaults } from '../ble/mbMapping';

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
  { value: 0, label: 'Normal' },
  { value: 1, label: 'Additive' },
  { value: 2, label: 'Subtractive' },
  { value: 3, label: 'Multiply' },
];

export function normalizeSegmentDef(raw) {
  const start = Number(raw.start ?? 0);
  const stop = Number(raw.stop ?? 0);
  if (stop <= start) return null;
  const seg = { id: Number(raw.id ?? 0), start, stop };
  SEGMENT_LAYOUT_FIELDS.forEach(k => {
    if (raw[k] !== undefined && raw[k] !== null) seg[k] = raw[k];
  });
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

export function activeSegmentsFromPreset(preset, customSegmentLayouts) {
  const w = preset?.wled || {};
  const linked = preset?.segmentLayoutId
    ? (customSegmentLayouts || []).find(l => l.id === preset.segmentLayoutId)
    : undefined;
  const fromLayout = linked?.segments?.map(s => normalizeSegmentDef(s)).filter(Boolean) || [];
  const fromPreset = (w.seg || []).map(s => normalizeSegmentDef(s)).filter(Boolean);
  const merged = mergeSegmentsById(fromLayout, fromPreset);
  return merged.filter(isActiveSegment);
}

export function pickSegOrWled(seg, wled, key) {
  if (seg && seg[key] !== undefined && seg[key] !== null) return seg[key];
  return wled[key];
}

export function buildRecalledSegment(seg, wled, should, m, index) {
  const out = { id: Number(seg?.id ?? index) };
  if (should('segments', m.segments) && seg && isActiveSegment(seg)) {
    out.start = Number(seg.start);
    out.stop = Number(seg.stop);
    ['of', 'grp', 'spc', 'bm', 'rev', 'mi', 'bri', 'on'].forEach(k => {
      if (seg[k] !== undefined && seg[k] !== null) out[k] = seg[k];
    });
  }
  if (should('effect', m.effect)) {
    const fx = pickSegOrWled(seg, wled, 'fx');
    if (fx !== undefined && fx !== null) out.fx = fx;
  }
  if (should('palette', m.palette)) {
    const pal = pickSegOrWled(seg, wled, 'pal');
    if (pal !== undefined && pal !== null) out.pal = pal;
  }
  if (should('parameters', m.parameters)) {
    ['sx', 'ix', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3'].forEach(k => {
      const v = pickSegOrWled(seg, wled, k);
      if (v !== undefined && v !== null) out[k] = v;
    });
  }
  if (should('color', m.color)) {
    const col = pickSegOrWled(seg, wled, 'col');
    if (col !== undefined && col !== null) {
      out.col = Array.isArray(col[0]) ? col.map(c => [...c]) : col;
    }
  }
  return out;
}

export function applyWledStateCapture(preset, state, catalog, opts, updateMemory = true) {
  const rawSegs = parseWledStateSegments(state);
  const primary = rawSegs[0];
  if (!primary) throw new Error('No active segments in WLED state');
  const wled = { ...preset.wled };
  const memory = { ...preset.memory };
  let segmentLayoutId = preset.segmentLayoutId;
  const capturedSegs = rawSegs.map(seg => captureSegmentFromRaw(seg, opts)).filter(Boolean);

  if (opts.effect) {
    if (primary.fx === undefined) throw new Error('Segment 0 has no effect (fx) to import');
    wled.fx = primary.fx;
    wled.fxName = (catalog.effects || []).find(e => e.id === primary.fx)?.name || wled.fxName || `Effect ${primary.fx}`;
    if (updateMemory) memory.effect = true;
  }
  if (opts.palette) {
    if (primary.pal === undefined) throw new Error('Segment 0 has no palette (pal) to import');
    wled.pal = primary.pal;
    wled.palName = resolvePaletteName(primary.pal, catalog.palettes);
    if (updateMemory) memory.palette = true;
  }
  if (opts.parameters) {
    ['sx', 'ix', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3'].forEach(k => {
      if (primary[k] !== undefined && primary[k] !== null) wled[k] = primary[k];
    });
    if (updateMemory) memory.parameters = true;
  }
  if (opts.color) {
    if (primary.col !== undefined && primary.col !== null) {
      wled.col = Array.isArray(primary.col[0]) ? primary.col.map(c => [...c]) : [...primary.col];
      if (updateMemory) memory.color = true;
    } else {
      delete wled.col;
      if (updateMemory) memory.color = false;
    }
  }
  if (capturedSegs.length && (opts.effect || opts.palette || opts.parameters || opts.color || opts.segments)) {
    wled.seg = capturedSegs.filter(seg => !opts.segments || isActiveSegment(seg));
    segmentLayoutId = undefined;
  }
  if (opts.segments && capturedSegs.length > 0) {
    if (updateMemory) memory.segments = capturedSegs.some(isActiveSegment);
  }

  return { ...preset, wled, memory, segmentLayoutId };
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

export function buildPresetLayoutPayload(preset, customSegmentLayouts) {
  if (!preset) return null;
  const wled = presetWledForBoard(preset, customSegmentLayouts);
  if (!wled.seg?.length) return null;
  return { on: true, seg: wled.seg.map(s => ({ ...s })) };
}
