/**
 * Board sync helpers — mirror web/index.html presetWledForBoard + mb_layout_set payloads.
 */

import { AppState } from 'react-native';
import { bleService } from '../services/BLEService';
import type { BLEMessage } from '../services/BLEService';
import type { Preset, RecallState, PresetMemory } from '../stores/store';
import { buildRecallPayload } from '../stores/store';
import type { CustomSegmentLayout, WledSegmentDef } from './segmentLayouts';
import { buildRecalledSegmentsFromPreset, finalizeWledSegmentPayload, parseWledStateSegments } from './segmentLayouts';
import type { MbSegmentLayout } from './configMigration';
import { BLE_MAX_WRITE_BYTES, BLE_CHUNK_INTER_MS, splitCommandForBleChunks } from './bleChunking';
import { isPresetSynced, markPresetSynced } from './blePresetCache';
import { buildMbLayoutWledPayload, buildDisableAllSplitSegmentsPayload } from './mbSegmentPreview';
import type { MbSegmentId, WledSegRef, MbMappingConfig } from './mbConfig';
import { collectMappingPresetIds, mbMappingToBlePayload } from './mbConfig';

const BOARD_PRESET_MEMORY: PresetMemory = {
  effect: true, palette: true, parameters: true, color: true, segments: true,
};

const BOARD_RECALL: RecallState = {
  effect: 'always', palette: 'always', parameters: 'always', color: 'always', segments: 'always',
};

export { clearBoardPresetSyncCache } from './blePresetCache';

/** MB mapping for BLE — embeds wand (and other SW) preset wled so cast works without NVS. */
export function mbMappingEssentialPayload(
  mbMapping: MbMappingConfig,
  presets: Preset[],
  recall: RecallState,
  layouts: CustomSegmentLayout[],
): object {
  const payload = mbMappingToBlePayload(mbMapping) as Record<string, unknown>;
  const swAnimations = {
    ...(payload.swAnimations as Record<string, { presetId?: string; colorSlots?: number[]; wled?: object }>),
  };
  for (const [key, mapping] of Object.entries(mbMapping.swAnimations ?? {})) {
    if (!mapping?.presetId) continue;
    const preset = presets.find(p => p.id === mapping.presetId);
    if (!preset) continue;
    swAnimations[key] = {
      presetId: mapping.presetId,
      colorSlots: mapping.colorSlots ?? [],
      wled: presetWledForBoard(preset, layouts, recall),
    };
  }
  return { ...payload, swAnimations };
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function waitForBleAck(action: string, id?: string, timeoutMs = 20_000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(false);
    }, timeoutMs);
    const unsub = bleService.onMessage((msg) => {
      if (msg.type !== 'ack' || msg.action !== action) return;
      if (id !== undefined && msg.id !== id) return;
      clearTimeout(timer);
      unsub();
      resolve(msg.ok !== false);
    });
  });
}

export interface ApplyPresetOptions {
  /** Do not wait for NOTIFY ack — Android often drops GATT notifications while backgrounded. */
  trustSend?: boolean;
  /** GPS zone apply — only needs BLE link; do not wait for connect bootstrap. */
  zoneGps?: boolean;
}

function shouldTrustSendOnAck(opts?: ApplyPresetOptions): boolean {
  if (opts?.trustSend || opts?.zoneGps) return true;
  return AppState.currentState !== 'active';
}

/** Save preset to board NVS once per session (zones / preset_apply need it). */
export async function ensurePresetOnBoard(
  preset: Preset,
  recall: RecallState,
  layouts: CustomSegmentLayout[],
  force = false,
): Promise<boolean> {
  if (!bleService.isConnected()) return false;
  if (!force && isPresetSynced(preset.id)) return true;
  const ackWait = waitForBleAck('preset_save', preset.id);
  const sent = await bleService.sendPresetSave(
    preset.id,
    preset.name,
    presetWledForBoard(preset, layouts, recall),
  );
  if (!sent) return false;
  const ok = await ackWait;
  if (ok) markPresetSynced(preset.id);
  return ok;
}

/** Sync presets referenced in MB/SW mapping (wand cast, animations, etc.) to board NVS. */
export async function ensureMappingPresetsOnBoard(
  mbMapping: MbMappingConfig,
  presets: Preset[],
  recall: RecallState,
  layouts: CustomSegmentLayout[],
  force = false,
): Promise<boolean> {
  let allOk = true;
  for (const id of collectMappingPresetIds(mbMapping)) {
    const preset = presets.find(p => p.id === id);
    if (preset) {
      const ok = await ensurePresetOnBoard(preset, recall, layouts, force);
      if (!ok) allOk = false;
    }
  }
  return allOk;
}

/** GPS / zone apply — always wled_raw (reliable); preset_save runs in background for NVS. */
export async function applyZonePreset(
  preset: Preset,
  recall: RecallState,
  layouts: CustomSegmentLayout[],
  opts?: ApplyPresetOptions,
): Promise<boolean> {
  return applyPresetToBoard(preset, recall, layouts, opts);
}

/** @deprecated use applyZonePreset — kept for call-site compat */
export const triggerZonePreset = applyZonePreset;

export function presetWledForBoard(
  preset: Preset,
  layouts: CustomSegmentLayout[],
  recall: RecallState = BOARD_RECALL,
): object {
  const w = preset.wled ?? {};
  const base = finalizeWledSegmentPayload({
    on: w.on ?? true,
    seg: buildRecalledSegmentsFromPreset(preset, recall, layouts, BOARD_PRESET_MEMORY),
  });
  const out: Record<string, unknown> = { ...base };
  if (w.transition !== undefined) out.transition = w.transition;
  if (w.pd !== undefined) out.pd = w.pd;
  return out;
}

export function resolveActiveLayoutIndex(
  layouts: MbSegmentLayout[],
  activeLayoutId: string | null,
): number {
  if (!layouts.length) return 0;
  if (activeLayoutId) {
    const idx = layouts.findIndex(l => l.id === activeLayoutId);
    if (idx >= 0) return idx;
  }
  return 0;
}

export function mbLayoutSetBlePayload(
  layouts: MbSegmentLayout[],
  activeLayoutId: string | null,
): object {
  return {
    type: 'mb_layout_set',
    layouts: layouts.map(l => ({ name: l.name, segments: l.segments })),
    active: resolveActiveLayoutIndex(layouts, activeLayoutId),
  };
}

/** Push MB segment layouts and activate the saved layout (matches manual layout switch). */
export async function pushMbSegmentLayoutsToBoard(
  layouts: MbSegmentLayout[],
  activeLayoutId: string | null,
  mbMapping: { segments?: Record<string, WledSegRef[]> },
): Promise<void> {
  if (!bleService.isConnected()) return;
  const activeIdx = resolveActiveLayoutIndex(layouts, activeLayoutId);

  // Tear down stale WLED segment splits before applying new geometry.
  await bleService.sendWledRaw(buildDisableAllSplitSegmentsPayload());
  await delay(500);
  if (!bleService.isConnected()) return;

  if (layouts.length > 0) {
    await bleService.sendMbLayoutSet(layouts, activeIdx);
    await delay(1000);
    if (!bleService.isConnected()) return;
    await bleService.sendMbLayoutSwitch(activeIdx);
    await delay(600);
  }
  if (!bleService.isConnected()) return;
  await bleService.sendMbMappingConfig(mbMapping);
  await delay(500);
  if (!bleService.isConnected()) return;
  const wledPayload = buildMbLayoutWledPayload(
    (mbMapping.segments ?? {}) as Record<MbSegmentId, WledSegRef[]>,
  );
  if (wledPayload) {
    await bleService.sendWledRaw(wledPayload);
    await delay(400);
  }
}

let catalogRefreshInFlight: Promise<void> | null = null;

/** Manual Library refresh only — never auto-run on connect (floods BLE ~130 chunks). */
export async function refreshWledCatalog(): Promise<void> {
  if (!bleService.isConnected() || !bleService.isSessionReady()) return;
  if (catalogRefreshInFlight) return catalogRefreshInFlight;
  catalogRefreshInFlight = (async () => {
    console.log('[Catalog] refresh start');
    await bleService.sendGetFxData();
    await delay(1200);
    if (!bleService.isConnected()) return;
    await bleService.sendGetEffects();
    await delay(1200);
    if (!bleService.isConnected()) return;
    await bleService.sendGetPalettes();
    console.log('[Catalog] refresh requested (effects → palettes → fxdata)');
  })().finally(() => {
    catalogRefreshInFlight = null;
  });
  return catalogRefreshInFlight;
}

export { BLE_MAX_WRITE_BYTES, BLE_CHUNK_INTER_MS, splitCommandForBleChunks } from './bleChunking';

/** Apply preset — push full recalled WLED JSON (clears stale segments on firmware). */
export async function applyPresetToBoard(
  preset: Preset,
  recall: RecallState,
  layouts: CustomSegmentLayout[],
  opts?: ApplyPresetOptions,
): Promise<boolean> {
  if (!bleService.isConnected()) {
    console.warn('[Apply] blocked — not connected');
    return false;
  }
  if (!opts?.zoneGps && !bleService.isSessionReady()) {
    console.warn('[Apply] blocked — session not ready (board still syncing?)');
    return false;
  }
  const payload = presetWledForBoard(preset, layouts, recall);
  const segCount = Array.isArray((payload as { seg?: unknown[] }).seg)
    ? (payload as { seg: unknown[] }).seg.length
    : 0;
  const trustSend = shouldTrustSendOnAck(opts);
  console.log('[Apply] start', preset.id, preset.name, `(${JSON.stringify(payload).length} bytes, ${segCount} segs)`, trustSend ? '[trust-send]' : '');

  if (trustSend) {
    const sent = await bleService.sendWledRaw(payload, preset.id);
    if (!sent) {
      console.warn('[Apply] wled_raw send failed');
      return false;
    }
    console.log('[Apply] sent ok (trust-send)');
    return true;
  }

  void ensurePresetOnBoard(preset, recall, layouts).catch((e) =>
    console.warn('[Apply] background preset_save failed:', e),
  );

  const ackWait = waitForBleAck('wled_raw', undefined, 20_000);
  const sent = await bleService.sendWledRaw(payload, preset.id);
  if (!sent) {
    console.warn('[Apply] wled_raw send failed');
    return false;
  }
  if (shouldTrustSendOnAck(opts)) {
    console.log('[Apply] sent ok (ack skipped — app backgrounded during apply)');
    return true;
  }
  const ok = await ackWait;
  console.log('[Apply]', ok ? 'ack ok' : 'ack timeout or WLED failed — check board serial for [BLE] wled_raw / [WLED] POST');
  return ok;
}

export async function syncPresetsToBoard(
  presets: Preset[],
  layouts: CustomSegmentLayout[],
  recall: RecallState,
  onProgress?: (index: number, total: number) => void,
): Promise<void> {
  for (let i = 0; i < presets.length; i++) {
    if (!bleService.isConnected()) return;
    const p = presets[i];
    if (!isPresetSynced(p.id)) {
      const ok = await ensurePresetOnBoard(p, recall, layouts);
      if (!ok) {
        console.warn('[BoardSync] preset_save failed for', p.id);
      }
    }
    onProgress?.(i + 1, presets.length);
    await delay(500);
  }
}

/** Show-mode config only — MB layouts are pushed via pushMbSegmentLayoutsToBoard. */
export async function pushHeavyBoardConfig(
  showModeConfig: object,
): Promise<void> {
  if (!bleService.isConnected()) return;
  await bleService.sendShowModeConfig(showModeConfig as Parameters<typeof bleService.sendShowModeConfig>[0]);
}

/** Pull live segment layout from WLED via board proxy. */
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

export interface LiveWledSummary {
  on: boolean;
  fx: number | null;
  pal: number | null;
  activeSegCount: number;
}

function parseLiveWledSummary(state: Record<string, unknown>): LiveWledSummary {
  const segs = Array.isArray(state.seg) ? state.seg : [];
  const active = segs.filter((s: Record<string, unknown>) => {
    const stop = Number(s.stop ?? 0);
    const start = Number(s.start ?? 0);
    return stop > start && s.on !== false;
  });
  const primary = (active[0] ?? segs[0] ?? state) as Record<string, unknown>;
  const fx = primary.fx != null ? Number(primary.fx) : (state.fx != null ? Number(state.fx) : null);
  const pal = primary.pal != null ? Number(primary.pal) : (state.pal != null ? Number(state.pal) : null);
  return {
    on: state.on !== false,
    fx,
    pal,
    activeSegCount: active.length > 0 ? active.length : (segs.length > 0 ? 1 : 0),
  };
}

/** On-demand WLED state snapshot (fx / palette / segment count) — not polled continuously. */
export function fetchLiveWledSummary(timeoutMs = 10_000): Promise<LiveWledSummary> {
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
        const state = JSON.parse(raw) as Record<string, unknown>;
        resolve(parseLiveWledSummary(state));
      } catch {
        reject(new Error('Invalid WLED state JSON'));
      }
    });
    bleService.sendGetState();
  });
}
