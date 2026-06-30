/**
 * Build WLED preview payloads matching firmware MB solid path:
 * disable inactive segment ids (stop:0), never a full-strip black seg 0 overlay.
 */

import type { MbSegmentId, WledSegRef } from './mbConfig';

export const STRIP_LED_COUNT = 100;

const WHITE: [number, number, number] = [255, 255, 255];

export const FIVE_CORNER_IDS: MbSegmentId[] = [
  'topLeft', 'bottomLeft', 'bottomRight', 'topRight', 'center',
];

/** TL=red, BL=green, BR=blue, TR=white, center=yellow */
export const FIVE_CORNER_RGB: [number, number, number][] = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 255],
  [255, 255, 0],
];

export const MB_SEGMENT_SIM_COMMAND: Record<MbSegmentId, string> = {
  all: 'test all',
  inner: 'test inner',
  outer: 'test outer',
  topLeft: 'test topLeft',
  topRight: 'test topRight',
  bottomLeft: 'test bottomLeft',
  bottomRight: 'test bottomRight',
  center: 'test center',
  band0: 'test band0',
  band1: 'test band1',
  band2: 'test band2',
  band3: 'test band3',
  band4: 'test band4',
  band5: 'test band5',
  band6: 'test band6',
  band7: 'test band7',
};

export const SIM_FIVE_CORNERS = 'test five';

const MB_WLED_MAX_SEG = 16;

function collectActiveIds(refs: WledSegRef[]): number[] {
  const ids: number[] = [];
  for (const ref of refs) {
    if (ref.stop <= ref.start) continue;
    if (!ids.includes(ref.id)) ids.push(ref.id);
  }
  return ids;
}

function disableSeg(id: number) {
  return { id, stop: 0 };
}

function solidSeg(ref: WledSegRef, rgb: [number, number, number]) {
  return {
    id: ref.id,
    start: ref.start,
    stop: ref.stop,
    fx: 0,
    col: [rgb],
  };
}

/** Disable unused WLED segment ids, then light target refs (matches StrollerController). */
function buildMbSolidPreview(activeRefs: WledSegRef[], rgb: [number, number, number]): object {
  const activeIds = collectActiveIds(activeRefs);
  const segs: object[] = [];
  const disableSeg0 = !activeIds.includes(0);
  if (disableSeg0) segs.push(disableSeg(0));
  for (let id = 1; id < MB_WLED_MAX_SEG; id++) {
    if (!activeIds.includes(id)) segs.push(disableSeg(id));
  }
  for (const ref of activeRefs) {
    if (ref.stop <= ref.start) continue;
    segs.push(solidSeg(ref, rgb));
  }
  return { on: true, seg: segs };
}

export function buildSegmentHighlightPreview(
  segments: Record<MbSegmentId, WledSegRef[]>,
  target: MbSegmentId,
): object {
  return buildMbSolidPreview(segments[target] ?? [], WHITE);
}

export function buildFiveCornerPreview(
  segments: Record<MbSegmentId, WledSegRef[]>,
): object {
  const refsByCorner = FIVE_CORNER_IDS.map(id => ({
    id,
    refs: segments[id] ?? [],
    rgb: FIVE_CORNER_RGB[FIVE_CORNER_IDS.indexOf(id)]!,
  }));
  const activeIds = collectActiveIds(refsByCorner.flatMap(c => c.refs));
  const segs: object[] = [];
  if (!activeIds.includes(0)) segs.push(disableSeg(0));
  for (let id = 1; id < MB_WLED_MAX_SEG; id++) {
    if (!activeIds.includes(id)) segs.push(disableSeg(id));
  }
  for (const { refs, rgb } of refsByCorner) {
    for (const ref of refs) {
      if (ref.stop <= ref.start) continue;
      segs.push(solidSeg(ref, rgb));
    }
  }
  return { on: true, seg: segs };
}

/** Same segment id used with different start/stop in two regions — WLED keeps one range per id. */
export function findMbSegIdConflicts(
  segments: Record<MbSegmentId, WledSegRef[]>,
): { id: number; regions: string[]; ranges: string[] }[] {
  const byId = new Map<number, { region: string; start: number; stop: number }[]>();
  for (const [region, refs] of Object.entries(segments)) {
    for (const ref of refs || []) {
      if (ref.stop <= ref.start) continue;
      const list = byId.get(ref.id) ?? [];
      list.push({ region, start: ref.start, stop: ref.stop });
      byId.set(ref.id, list);
    }
  }
  const conflicts: { id: number; regions: string[]; ranges: string[] }[] = [];
  for (const [id, uses] of byId) {
    const ranges = [...new Set(uses.map(u => `LED ${u.start}–${u.stop}`))];
    if (ranges.length > 1) {
      conflicts.push({
        id,
        regions: [...new Set(uses.map(u => u.region))],
        ranges,
      });
    }
  }
  return conflicts.sort((a, b) => a.id - b.id);
}

/** center copied from inner/band4 — common mis-map for E909 center LED. */
export function centerMatchesRegion(
  segments: Record<MbSegmentId, WledSegRef[]>,
  other: MbSegmentId,
): boolean {
  const a = segments.center ?? [];
  const b = segments[other] ?? [];
  if (a.length !== b.length) return false;
  return a.every((ref, i) =>
    ref.id === b[i]?.id && ref.start === b[i]?.start && ref.stop === b[i]?.stop,
  );
}
