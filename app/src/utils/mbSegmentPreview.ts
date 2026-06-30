/**
 * WLED segment layout preview for MB mapping editor.
 * Black background + highlighted region(s) via wled_raw (direct layout test).
 */

import type { MbSegmentId, WledSegRef } from './mbConfig';

export const STRIP_LED_COUNT = 100;

const BLACK: [number, number, number] = [0, 0, 0];
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

/** WandSimulator serial command per segment (uses white vs off on stroller mapping). */
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

function baseBlackSeg() {
  return { id: 0, start: 0, stop: STRIP_LED_COUNT, fx: 0, col: [BLACK] };
}

function highlightSeg(ref: WledSegRef, rgb: [number, number, number]) {
  if (ref.stop <= ref.start) return null;
  return {
    id: ref.id,
    start: ref.start,
    stop: ref.stop,
    fx: 0,
    col: [rgb],
  };
}

/** Black strip + target segment(s) white — tests WLED start/stop refs only. */
export function buildSegmentHighlightPreview(
  segments: Record<MbSegmentId, WledSegRef[]>,
  target: MbSegmentId,
): object {
  const segs: object[] = [baseBlackSeg()];
  for (const ref of segments[target] ?? []) {
    const s = highlightSeg(ref, WHITE);
    if (s) segs.push(s);
  }
  return { on: true, bri: 255, seg: segs };
}

/** Black strip + five corners in R/G/B/W/Y — tests corner layout together. */
export function buildFiveCornerPreview(
  segments: Record<MbSegmentId, WledSegRef[]>,
): object {
  const segs: object[] = [baseBlackSeg()];
  FIVE_CORNER_IDS.forEach((id, i) => {
    for (const ref of segments[id] ?? []) {
      const s = highlightSeg(ref, FIVE_CORNER_RGB[i]!);
      if (s) segs.push(s);
    }
  });
  return { on: true, bri: 255, seg: segs };
}
