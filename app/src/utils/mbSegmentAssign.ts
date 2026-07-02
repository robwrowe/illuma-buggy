import type { WledSegRef } from './mbConfig';
import type { WledSegmentDef } from './segmentLayouts';

export const STRIP_PCT_MAX = 100;

export function formatWledSegLabel(seg: { id: number; start: number; stop: number }): string {
  return `Seg #${seg.id} · ${seg.start}–${seg.stop}%`;
}

export function formatWledSegSelectionSummary(refs: WledSegRef[]): string {
  if (!refs.length) return 'None assigned';
  return refs.map(r => `#${r.id} (${r.start}–${r.stop}%)`).join(' · ');
}

export function isValidSegRef(ref: WledSegRef): boolean {
  return Number.isInteger(ref.id) && ref.id >= 0 && ref.id <= 31
    && Number.isInteger(ref.start) && Number.isInteger(ref.stop)
    && ref.start >= 0 && ref.stop <= STRIP_PCT_MAX && ref.stop > ref.start;
}

export function parseSegRefFields(idStr: string, startStr: string, stopStr: string): WledSegRef | null {
  const id = parseInt(idStr, 10);
  const start = parseInt(startStr, 10);
  const stop = parseInt(stopStr, 10);
  const ref = { id, start, stop };
  return isValidSegRef(ref) ? ref : null;
}

export function defaultNewSegRef(refs: WledSegRef[]): WledSegRef {
  const used = new Set(refs.map(r => r.id));
  let id = 0;
  while (used.has(id) && id < 32) id++;
  return { id, start: 0, stop: STRIP_PCT_MAX };
}

export function segDefToSegRef(seg: WledSegmentDef): WledSegRef {
  const ref: WledSegRef = { id: seg.id, start: seg.start, stop: seg.stop };
  if (seg.grp !== undefined) ref.grp = seg.grp;
  if (seg.spc !== undefined) ref.spc = seg.spc;
  if (seg.of !== undefined) ref.of = seg.of;
  if (seg.fx !== undefined) ref.fx = seg.fx;
  if (seg.sx !== undefined) ref.sx = seg.sx;
  if (seg.ix !== undefined) ref.ix = seg.ix;
  if (seg.pal !== undefined) ref.pal = seg.pal;
  if (seg.rev !== undefined) ref.rev = seg.rev;
  if (seg.mi !== undefined) ref.mi = seg.mi;
  return ref;
}

export function refsFromSnapshotIds(snapshot: WledSegmentDef[], selectedIds: number[]): WledSegRef[] {
  const set = new Set(selectedIds);
  return snapshot
    .filter(s => set.has(s.id))
    .map(segDefToSegRef);
}

export function selectedIdsFromRefs(refs: WledSegRef[]): number[] {
  return refs.map(r => r.id);
}

export function updateRefAt(refs: WledSegRef[], index: number, ref: WledSegRef): WledSegRef[] {
  const next = [...refs];
  next[index] = ref;
  return next;
}

export function removeRefAt(refs: WledSegRef[], index: number): WledSegRef[] {
  return refs.filter((_, i) => i !== index);
}

export function appendSegRef(refs: WledSegRef[], ref: WledSegRef): WledSegRef[] {
  const without = refs.filter(r => r.id !== ref.id);
  return [...without, ref];
}

export function toggleSnapshotSelection(
  snapshot: WledSegmentDef[],
  currentRefs: WledSegRef[],
  wledSegId: number,
): WledSegRef[] {
  const seg = snapshot.find(s => s.id === wledSegId);
  if (!seg) return currentRefs;
  const selected = currentRefs.some(r => r.id === wledSegId);
  if (selected) return currentRefs.filter(r => r.id !== wledSegId);
  return appendSegRef(currentRefs, segDefToSegRef(seg));
}

/** After capture: refresh snapshot-sourced refs; keep manually entered refs untouched. */
export function pruneRefsToSnapshot(snapshot: WledSegmentDef[], refs: WledSegRef[]): WledSegRef[] {
  const snapIds = new Set(snapshot.map(s => s.id));
  const manual = refs.filter(r => !snapIds.has(r.id));
  const fromSnap = refsFromSnapshotIds(
    snapshot,
    selectedIdsFromRefs(refs).filter(id => snapIds.has(id)),
  );
  return [...manual, ...fromSnap];
}
