/**
 * Board sync helpers — mirror web/index.html presetWledForBoard + mb_layout_set payloads.
 */

import { bleService } from '../services/BLEService';
import type { Preset, RecallState, PresetMemory } from '../stores/store';
import { buildRecallPayload } from '../stores/store';
import type { CustomSegmentLayout } from './segmentLayouts';
import { buildRecalledSegmentsFromPreset, finalizeWledSegmentPayload } from './segmentLayouts';
import type { MbSegmentLayout } from './configMigration';

const BOARD_PRESET_MEMORY: PresetMemory = {
  effect: true, palette: true, parameters: true, color: true, segments: true,
};

export const BLE_MAX_WRITE_BYTES = 512;
export const BLE_CHUNK_INTER_MS = 25;

const BOARD_RECALL: RecallState = {
  effect: 'always', palette: 'always', parameters: 'always', color: 'always', segments: 'always',
};

const syncedPresetIds = new Set<string>();

export function clearBoardPresetSyncCache(): void {
  syncedPresetIds.clear();
}

/** Save preset to board NVS once per session (zones / preset_apply need it). */
export async function ensurePresetOnBoard(
  preset: Preset,
  recall: RecallState,
  layouts: CustomSegmentLayout[],
): Promise<boolean> {
  if (!bleService.isConnected()) return false;
  if (syncedPresetIds.has(preset.id)) return true;
  const ok = await bleService.sendPresetSave(
    preset.id,
    preset.name,
    presetWledForBoard(preset, layouts, recall),
  );
  if (ok) syncedPresetIds.add(preset.id);
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

export function splitCommandForBleChunks(jsonStr: string): string[] {
  const pieces: string[] = [];
  let offset = 0;
  while (offset < jsonStr.length) {
    let lo = 1;
    let hi = jsonStr.length - offset;
    let best = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const data = jsonStr.slice(offset, offset + mid);
      const isLast = offset + mid >= jsonStr.length;
      const envelope = JSON.stringify({ type: 'ble_cmd_chunk', seq: pieces.length, last: isLast, data });
      if (new TextEncoder().encode(envelope).length <= BLE_MAX_WRITE_BYTES) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best < 1) throw new Error('BLE command too large to chunk');
    pieces.push(jsonStr.slice(offset, offset + best));
    offset += best;
  }
  return pieces;
}

/** Apply preset immediately (wled_raw) and persist to board NVS for zones / preset_apply. */
export async function applyPresetToBoard(
  preset: Preset,
  recall: RecallState,
  layouts: CustomSegmentLayout[],
): Promise<boolean> {
  if (!bleService.isConnected()) return false;
  const payload = buildRecallPayload(preset, recall, layouts);
  const ok = await bleService.sendWledRaw(payload, preset.id);
  if (!ok) return false;
  const saved = await bleService.sendPresetSave(
    preset.id,
    preset.name,
    presetWledForBoard(preset, layouts, recall),
  );
  if (saved) syncedPresetIds.add(preset.id);
  return saved;
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
    onProgress?.(i + 1, presets.length);
    await new Promise(r => setTimeout(r, 250));
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
