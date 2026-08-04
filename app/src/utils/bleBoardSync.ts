/**
 * Board sync helpers — preset apply + MB mapping push (set_mb_rules).
 */

import { AppState } from 'react-native';
import { bleService } from '../services/BLEService';
import type { BLEMessage } from '../services/BLEService';
import type { Preset, PresetApplyMode, RecallState, PresetMemory } from '../stores/store';
import { useAppStore } from '../stores/store';
import type { CustomSegmentLayout, SharedSegmentMap, WledSegmentDef } from './segmentLayouts';
import {
  asSharedSegmentMaps,
  buildRecalledSegmentsFromPreset,
  finalizeWledSegmentPayload,
  parseWledStateSegments,
  resolvePresetLedmap,
} from './segmentLayouts';
import { BLE_MAX_WRITE_BYTES, BLE_CHUNK_INTER_MS, splitCommandForBleChunks } from './bleChunking';
import { isPresetSynced, markPresetSynced } from './blePresetCache';
import type { MbMappingConfig } from './mbConfig';
import { collectMappingPresetIds, compactMbPayloadForBle } from './mbConfig';
import { TRANSITION_STYLE_TO_BS } from './transitionStyles';

const BOARD_PRESET_MEMORY: PresetMemory = {
  effect: true, palette: true, parameters: true, color: true, segments: true,
};

const BOARD_RECALL: RecallState = {
  effect: 'always', palette: 'always', parameters: 'always', color: 'always', segments: 'always',
};

export { clearBoardPresetSyncCache } from './blePresetCache';

/** MB mapping for BLE — colors, segments, rules, segmentMaps, paradeDetection (compact wire). */
export function mbMappingEssentialPayload(
  mbMapping: MbMappingConfig,
  _presets?: Preset[],
  _recall?: RecallState,
): object {
  return compactMbPayloadForBle(mbMapping);
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

function sharedMapsFromStore(mbMapping?: MbMappingConfig): SharedSegmentMap[] {
  return asSharedSegmentMaps(mbMapping?.segmentMaps ?? useAppStore.getState().mbMapping?.segmentMaps);
}

/** Full preset document for NVS (mirrors web board sync — board resolves at apply time). */
export function presetDocForBoardSave(preset: Preset): object {
  const global: Record<string, unknown> = { ...(preset.wled ?? { on: true }) };
  if (preset.colorRefs?.length) global.colorRefs = preset.colorRefs;
  return {
    id: preset.id,
    name: preset.name,
    global,
    memory: preset.memory,
    tags: preset.tags || [],
    segmentMapId: preset.segmentMapId || '',
    segmentOverrides: preset.segmentOverrides || {},
    segmentSourceMode: preset.segmentSourceMode || 'global',
    ledmap: preset.ledmap ?? null,
    colorLibrary: preset.colorLibrary || [],
    customSegmentMap: preset.customSegmentMap || null,
  };
}

/** Save preset to board NVS once per session (zones / preset_apply need it). */
export async function ensurePresetOnBoard(
  preset: Preset,
  recall: RecallState,
  layouts: CustomSegmentLayout[],
  force = false,
  sharedMaps?: SharedSegmentMap[],
): Promise<boolean> {
  if (!bleService.isConnected()) return false;
  if (!force && isPresetSynced(preset.id)) return true;
  const ackWait = waitForBleAck('preset_save', preset.id);
  // New-shape doc only — board-side buildWledFromPresetDoc resolves fx/pal/col/etc. from
  // `global`, which this shape always provides. The old `wled`-keyed legacy shape (built
  // from presetWledForBoard(), fully pre-resolved into seg[] with no top-level fx/pal/col)
  // is NOT a safe fallback here: buildWledFromPresetDoc treats a present `wled` key as a
  // valid globalLook object, but it has none of the flat fields seedWledFromSegmentMap
  // reads, so the board silently produces a preset with no fx/pal/color at all. Retry the
  // same payload instead of falling back to an incompatible shape.
  let sent = await bleService.send({
    type: 'preset_save',
    ...presetDocForBoardSave(preset),
  });
  if (!sent) {
    // One retry — BLE send failures here are almost always transient (GATT busy, momentary
    // congestion during chunked transfer), not a hard incompatibility with this preset.
    await delay(250);
    sent = await bleService.send({
      type: 'preset_save',
      ...presetDocForBoardSave(preset),
    });
  }
  if (!sent) {
    console.warn('[BoardSync] preset_save failed after retry — not marking synced', preset.id);
    return false;
  }
  const ok = await ackWait;
  if (ok) markPresetSynced(preset.id);
  return ok;
}

/** Sync presets referenced in MB mapping (defaultPresetId) to board NVS. */
export async function ensureMappingPresetsOnBoard(
  mbMapping: MbMappingConfig,
  presets: Preset[],
  recall: RecallState,
  layouts: CustomSegmentLayout[],
  force = false,
): Promise<boolean> {
  const maps = asSharedSegmentMaps(mbMapping.segmentMaps);
  let allOk = true;
  for (const id of collectMappingPresetIds(mbMapping)) {
    const preset = presets.find(p => p.id === id);
    if (preset) {
      const ok = await ensurePresetOnBoard(preset, recall, layouts, force, maps);
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
  const maps = sharedMapsFromStore();
  const mode = useAppStore.getState().presetApplyMode;
  return applyPresetRouted(preset, recall, maps, layouts, mode, opts);
}

/** @deprecated use applyZonePreset — kept for call-site compat */
export const triggerZonePreset = applyZonePreset;

export function presetWledForBoard(
  preset: Preset,
  sharedMaps: SharedSegmentMap[],
  layouts: CustomSegmentLayout[],
  recall: RecallState = BOARD_RECALL,
): object {
  const w = (preset.wled ?? { on: true }) as Preset['wled'];
  const base = finalizeWledSegmentPayload({
    on: w.on ?? true,
    seg: buildRecalledSegmentsFromPreset(
      preset as Parameters<typeof buildRecalledSegmentsFromPreset>[0],
      recall,
      sharedMaps,
      layouts,
      BOARD_PRESET_MEMORY,
    ),
  });
  const out: Record<string, unknown> = {
    ...base,
    ledmap: resolvePresetLedmap(preset, sharedMaps),
  };

  if (Number.isFinite(w.transitionMs)) {
    out.transition = Math.max(0, Math.round((w.transitionMs as number) / 100));
  }
  if (w.transitionStyle && TRANSITION_STYLE_TO_BS[w.transitionStyle] !== undefined) {
    out.bs = TRANSITION_STYLE_TO_BS[w.transitionStyle];
  }

  return out;
}

/**
 * Route preset apply via board `preset_apply` when enabled and safe; otherwise
 * fall back to phone-resolved `wled_raw` (legacy).
 */
export async function applyPresetRouted(
  preset: Preset,
  recall: RecallState,
  sharedMaps: SharedSegmentMap[],
  layouts: CustomSegmentLayout[],
  presetApplyMode: PresetApplyMode,
  opts?: ApplyPresetOptions,
): Promise<boolean> {
  const canUseBoardRoute =
    presetApplyMode === 'board' &&
    !shouldTrustSendOnAck(opts) &&
    bleService.isSessionReady() &&
    isPresetSynced(preset.id);

  if (canUseBoardRoute) {
    console.log('[Apply] routing via preset_apply (board-resolve)', preset.id);
    const ackWait = waitForBleAck('preset_apply', preset.id, 20_000);
    const sent = await bleService.sendPresetApply(preset.id);
    if (sent) {
      const ok = await ackWait;
      if (ok) {
        console.log('[Apply] preset_apply ack ok');
        return true;
      }
      console.warn('[Apply] preset_apply ack failed/timeout — falling back to wled_raw');
    } else {
      console.warn('[Apply] preset_apply send failed — falling back to wled_raw');
    }
  }

  return applyPresetToBoard(preset, recall, sharedMaps, layouts, opts);
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
  sharedMaps: SharedSegmentMap[],
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
  const payload = presetWledForBoard(preset, sharedMaps, layouts, recall);
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

  void ensurePresetOnBoard(preset, recall, layouts, false, sharedMaps).catch((e) =>
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
  const maps = sharedMapsFromStore();
  for (let i = 0; i < presets.length; i++) {
    if (!bleService.isConnected()) return;
    const p = presets[i];
    if (!isPresetSynced(p.id)) {
      const ok = await ensurePresetOnBoard(p, recall, layouts, false, maps);
      if (!ok) {
        console.warn('[BoardSync] preset_save failed for', p.id);
      }
    }
    onProgress?.(i + 1, presets.length);
    await delay(500);
  }
}

/** Show-mode config push. */
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
  bri: number | null;
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
  const bri = state.bri != null ? Number(state.bri) : null;
  return {
    on: state.on !== false,
    bri,
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
