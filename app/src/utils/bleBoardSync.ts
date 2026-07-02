/**
 * Board sync helpers — mirror web/index.html presetWledForBoard + mb_layout_set payloads.
 */

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
import { collectMappingPresetIds } from './mbConfig';

const BOARD_PRESET_MEMORY: PresetMemory = {
  effect: true, palette: true, parameters: true, color: true, segments: true,
};

const BOARD_RECALL: RecallState = {
  effect: 'always', palette: 'always', parameters: 'always', color: 'always', segments: 'always',
};

export { clearBoardPresetSyncCache } from './blePresetCache';

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

/** Save preset to board NVS once per session (zones / preset_apply need it). */
export async function ensurePresetOnBoard(
  preset: Preset,
  recall: RecallState,
  layouts: CustomSegmentLayout[],
): Promise<boolean> {
  if (!bleService.isConnected()) return false;
  if (isPresetSynced(preset.id)) return true;
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
): Promise<void> {
  for (const id of collectMappingPresetIds(mbMapping)) {
    const preset = presets.find(p => p.id === id);
    if (preset) await ensurePresetOnBoard(preset, recall, layouts);
  }
}

/** Zone trigger — preset must exist on board NVS first. */
export async function triggerZonePreset(
  preset: Preset,
  recall: RecallState,
  layouts: CustomSegmentLayout[],
): Promise<boolean> {
  if (!bleService.isConnected()) return false;
  const saved = await ensurePresetOnBoard(preset, recall, layouts);
  if (!saved) return false;
  return bleService.sendZoneTrigger(preset.id);
}

export function presetWledForBoard(
  preset: Preset,
  layouts: CustomSegmentLayout[],
  recall: RecallState = BOARD_RECALL,
): object {
  return finalizeWledSegmentPayload({
    on: true,
    seg: buildRecalledSegmentsFromPreset(preset, recall, layouts, BOARD_PRESET_MEMORY),
  });
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

export async function refreshWledCatalog(): Promise<void> {
  if (!bleService.isConnected()) return;
  await bleService.sendGetFxData();
  await delay(700);
  if (!bleService.isConnected()) return;
  await bleService.sendGetEffects();
  await delay(700);
  if (!bleService.isConnected()) return;
  await bleService.sendGetPalettes();
}

export { BLE_MAX_WRITE_BYTES, BLE_CHUNK_INTER_MS, splitCommandForBleChunks } from './bleChunking';

/** Apply preset via board NVS + HTTP (small BLE command — no full wled_raw). */
export async function applyPresetToBoard(
  preset: Preset,
  recall: RecallState,
  layouts: CustomSegmentLayout[],
): Promise<boolean> {
  if (!bleService.isConnected()) return false;
  const saved = await ensurePresetOnBoard(preset, recall, layouts);
  if (!saved) return false;
  const ackWait = waitForBleAck('preset_apply', preset.id, 15_000);
  const sent = await bleService.sendPresetApply(preset.id);
  if (!sent) return false;
  return ackWait;
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
