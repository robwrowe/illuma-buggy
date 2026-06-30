import type { WledSegRef } from './mbConfig';
import type { WledSegmentDef } from './segmentLayouts';

export function formatWledSegLabel(seg: { id: number; start: number; stop: number }): string {
  return `Seg #${seg.id} · ${seg.start}–${seg.stop}%`;
}

export function formatWledSegSelectionSummary(refs: WledSegRef[]): string {
  if (!refs.length) return 'None selected';
  return refs.map(r => `#${r.id}`).join(' & ');
}

export function refsFromSnapshotIds(snapshot: WledSegmentDef[], selectedIds: number[]): WledSegRef[] {
  const set = new Set(selectedIds);
  return snapshot
    .filter(s => set.has(s.id))
    .map(s => ({ id: s.id, start: s.start, stop: s.stop }));
}

export function selectedIdsFromRefs(refs: WledSegRef[]): number[] {
  return refs.map(r => r.id);
}

export function toggleSnapshotSelection(
  snapshot: WledSegmentDef[],
  currentRefs: WledSegRef[],
  wledSegId: number,
): WledSegRef[] {
  const selected = new Set(selectedIdsFromRefs(currentRefs));
  if (selected.has(wledSegId)) selected.delete(wledSegId);
  else selected.add(wledSegId);
  return refsFromSnapshotIds(snapshot, [...selected]);
}

/** Keep selections whose WLED segment IDs still exist after a fresh capture. */
export function pruneRefsToSnapshot(snapshot: WledSegmentDef[], refs: WledSegRef[]): WledSegRef[] {
  const ids = selectedIdsFromRefs(refs).filter(id => snapshot.some(s => s.id === id));
  return refsFromSnapshotIds(snapshot, ids);
}
