/** Tracks which presets were saved to board NVS this session — no BLE imports. */

const syncedPresetIds = new Set<string>();

export function clearBoardPresetSyncCache(): void {
  syncedPresetIds.clear();
}

export function markPresetSynced(id: string): void {
  syncedPresetIds.add(id);
}

export function isPresetSynced(id: string): boolean {
  return syncedPresetIds.has(id);
}
