/**
 * WLED segment layout library — reusable multi-segment configs for presets.
 */

import { bleService, BLEMessage } from '../services/BLEService';

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
}

export interface CustomSegmentLayout {
  id: string;
  name: string;
  segments: WledSegmentDef[];
  createdAt?: number;
}

const LAYOUT_FIELDS: (keyof WledSegmentDef)[] = [
  'id', 'start', 'stop', 'fx', 'pal', 'sx', 'ix', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3', 'col',
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

export function summarizeLayout(layout: CustomSegmentLayout): string {
  if (layout.segments.length === 0) return 'No segments';
  return layout.segments
    .map(s => `#${s.id} ${s.start}–${s.stop}%`)
    .join(' · ');
}

/** Apply a preset's segment layout to the strip (for MB region capture workflow). */
export function buildPresetLayoutPayload(
  preset: { wled?: { seg?: WledSegmentDef[] }; segmentLayoutId?: string },
  layouts: CustomSegmentLayout[],
): { on: boolean; bri: number; seg: WledSegmentDef[] } | null {
  const linked = preset.segmentLayoutId
    ? layouts.find(l => l.id === preset.segmentLayoutId)
    : undefined;
  if (linked?.segments.length) {
    return { on: true, bri: 255, seg: linked.segments.map(s => ({ ...s })) };
  }
  const seg = preset.wled?.seg;
  if (Array.isArray(seg) && seg.length > 0) {
    return {
      on: true,
      bri: 255,
      seg: seg.map(s => normalizeSegmentDef(s)).filter((s): s is WledSegmentDef => s !== null),
    };
  }
  return null;
}

export function fetchWledSegmentsFromDevice(timeoutMs = 8000): Promise<WledSegmentDef[]> {
  return new Promise((resolve, reject) => {
    if (!bleService.isConnected()) {
      reject(new Error('Not connected'));
      return;
    }
    const timer = setTimeout(() => {
      unsub();
      reject(new Error('Timed out waiting for WLED state'));
    }, timeoutMs);
    const unsub = bleService.onMessage((msg: BLEMessage) => {
      if (msg.type !== 'wled_state_done') return;
      clearTimeout(timer);
      unsub();
      try {
        const raw = (msg.raw as string) ?? (msg.data as string) ?? '{}';
        const state = JSON.parse(raw);
        resolve(parseWledStateSegments(state));
      } catch {
        reject(new Error('Invalid WLED state JSON'));
      }
    });
    bleService.sendGetState();
  });
}
