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

const BOARD_PRESET_MEMORY: PresetMemory = {
  effect: true, palette: true, parameters: true, color: true, segments: true,
};

const BOARD_RECALL: RecallState = {
  effect: 'always', palette: 'always', parameters: 'always', color: 'always', segments: 'always',
};

export { clearBoardPresetSyncCache } from './blePresetCache';

/** Save preset to board NVS once per session (zones / preset_apply need it). */
export async function ensurePresetOnBoard(
  preset: Preset,
  recall: RecallState,
  layouts: CustomSegmentLayout[],
): Promise<boolean> {
  if (!bleService.isConnected()) return false;
  if (isPresetSynced(preset.id)) return true;
  const ok = await bleService.sendPresetSave(
    preset.id,
    preset.name,
    presetWledForBoard(preset, layouts, recall),
  );
  if (ok) markPresetSynced(preset.id);
  return ok;
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

export function mbLayoutSetBlePayload(
  layouts: MbSegmentLayout[],
  activeLayoutId: string | null,
): object {
  const activeIdx = Math.max(0, layouts.findIndex(l => l.id === activeLayoutId));
  return {
    type: 'mb_layout_set',
    layouts: layouts.map(l => ({ name: l.name, segments: l.segments })),
    active: activeIdx,
  };
}

export { BLE_MAX_WRITE_BYTES, BLE_CHUNK_INTER_MS, splitCommandForBleChunks } from './bleChunking';

/** Apply preset via board NVS + HTTP (small BLE command — no full wled_raw). */
export async function applyPresetToBoard(
  preset: Preset,
  recall: RecallState,
  layouts: CustomSegmentLayout[],
): Promise<boolean> {
  if (!bleService.isConnected()) return false;
  if (!bleService.isSessionReady()) return false;
  const saved = await ensurePresetOnBoard(preset, recall, layouts);
  if (!saved) return false;
  return bleService.sendPresetApply(preset.id);
}

export async function syncPresetsToBoard(
  presets: Preset[],
  layouts: CustomSegmentLayout[],
  onProgress?: (index: number, total: number) => void,
): Promise<void> {
  for (let i = 0; i < presets.length; i++) {
    if (!bleService.isConnected()) return;
    const p = presets[i];
    await bleService.sendPresetSave(p.id, p.name, presetWledForBoard(p, layouts));
    markPresetSynced(p.id);
    onProgress?.(i + 1, presets.length);
    await new Promise(r => setTimeout(r, 400));
  }
}

/** Heavy board push — run after connect settles; spaced to avoid overwhelming firmware. */
export async function pushHeavyBoardConfig(
  mbMapping: object,
  layouts: MbSegmentLayout[],
  activeLayoutId: string | null,
  showModeConfig: object,
): Promise<void> {
  if (!bleService.isConnected()) return;
  await bleService.sendMbMappingConfig(mbMapping);
  await new Promise(r => setTimeout(r, 800));
  if (!bleService.isConnected()) return;
  if (layouts.length > 0) {
    const activeIdx = Math.max(0, layouts.findIndex(l => l.id === activeLayoutId));
    await bleService.sendMbLayoutSet(layouts, activeIdx);
    await new Promise(r => setTimeout(r, 800));
  }
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
