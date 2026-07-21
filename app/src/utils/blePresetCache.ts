/**
 * Tracks which presets are on board NVS — persisted across disconnects when sync is fresh.
 */

import { loadBoardSyncMeta, saveBoardSyncMeta } from './boardSyncState';

const syncedPresetIds = new Set<string>();

export function clearBoardPresetSyncCache(): void {
  syncedPresetIds.clear();
}

export function restoreBoardPresetSyncCache(ids: string[]): void {
  syncedPresetIds.clear();
  ids.forEach(id => syncedPresetIds.add(id));
}

export function markPresetSynced(id: string): void {
  syncedPresetIds.add(id);
}

export function markAllPresetsSynced(ids: string[]): void {
  ids.forEach(id => syncedPresetIds.add(id));
}

export function isPresetSynced(id: string): boolean {
  return syncedPresetIds.has(id);
}

export function getSyncedPresetIds(): string[] {
  return [...syncedPresetIds];
}

/** Persist synced ids into board sync meta (call after full/quick verify). */
export async function persistPresetSyncCache(
  fingerprint: string,
  fullSync: boolean,
): Promise<void> {
  const prev = await loadBoardSyncMeta();
  await saveBoardSyncMeta({
    fullSyncAt: fullSync ? Date.now() : (prev?.fullSyncAt ?? Date.now()),
    fingerprint,
    syncedPresetIds: getSyncedPresetIds(),
  });
}
