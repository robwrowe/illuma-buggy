/**
 * Board sync status, config fingerprint, and reconnect policy.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Preset } from '../stores/store';
import type { MbSegmentLayout } from './configMigration';
import type { MbMappingConfig } from './mbConfig';
import type { ShowModeConfig } from './configMigration';

/** Reconnect within this window + matching fingerprint → skip heavy config push. */
export const BOARD_SYNC_FRESH_MS = 6 * 60 * 60 * 1000;

export type BoardSyncPhase =
  | 'idle'
  | 'connecting'
  | 'essential'
  | 'verifying'
  | 'layouts'
  | 'presets'
  | 'ready'
  | 'error';

export type BoardSyncMode = 'none' | 'quick' | 'full';

export interface BoardSyncStatus {
  phase: BoardSyncPhase;
  mode: BoardSyncMode;
  detail: string;
  commandsReady: boolean;
  backgroundBusy: boolean;
  mappingComplete?: boolean;
  presetProgress?: { current: number; total: number };
}

export interface BoardSyncMeta {
  fullSyncAt: number;
  fingerprint: string;
  syncedPresetIds: string[];
  mbLayoutActive?: number;
  mbLayoutCount?: number;
}

const META_KEY = 'boardSyncMeta';

const DEFAULT_STATUS: BoardSyncStatus = {
  phase: 'idle',
  mode: 'none',
  detail: '',
  commandsReady: false,
  backgroundBusy: false,
};

let status: BoardSyncStatus = { ...DEFAULT_STATUS };
const listeners = new Set<(s: BoardSyncStatus) => void>();

function emit(next: Partial<BoardSyncStatus>) {
  status = { ...status, ...next };
  listeners.forEach(h => h(status));
}

export function getBoardSyncStatus(): BoardSyncStatus {
  return status;
}

export function onBoardSyncStatus(handler: (s: BoardSyncStatus) => void): () => void {
  listeners.add(handler);
  handler(status);
  return () => listeners.delete(handler);
}

export function resetBoardSyncStatus() {
  emit({ ...DEFAULT_STATUS });
}

export function setBoardSyncPhase(
  phase: BoardSyncPhase,
  detail: string,
  extra?: Partial<BoardSyncStatus>,
) {
  emit({ phase, detail, ...extra });
}

export function setBoardSyncReady(mode: BoardSyncMode, detail: string, mappingComplete = true) {
  emit({
    phase: 'ready',
    mode,
    detail,
    commandsReady: true,
    backgroundBusy: false,
    mappingComplete,
    presetProgress: undefined,
  });
}

export function setBoardSyncPresetProgress(current: number, total: number, detail?: string) {
  emit({
    phase: 'presets',
    presetProgress: { current, total },
    backgroundBusy: true,
    ...(detail ? { detail } : {}),
  });
}

export function markBoardSyncBackgroundBusy(busy: boolean, detail?: string) {
  emit({
    backgroundBusy: busy,
    ...(detail ? { detail } : {}),
  });
}

/** djb2 hash — stable fingerprint for “does phone config match last board push?” */
export function computeBoardConfigFingerprint(input: {
  presets: Preset[];
  mbMapping: MbMappingConfig;
  mbSegmentLayouts: MbSegmentLayout[];
  mbActiveSegmentLayoutId: string | null;
  showModeConfig: ShowModeConfig;
  starlightEnabled: boolean;
  magicBandEnabled: boolean;
  bleEffectTransitionMs: number;
  boardRole: string;
  scannerMac: string;
}): string {
  const payload = JSON.stringify({
    presetKeys: input.presets.map(p => `${p.id}:${p.createdAt}`).sort(),
    mbMapping: input.mbMapping,
    layouts: input.mbSegmentLayouts.map(l => ({ id: l.id, name: l.name, segments: l.segments })),
    activeLayout: input.mbActiveSegmentLayoutId,
    showMode: input.showModeConfig,
    sw: input.starlightEnabled,
    mb: input.magicBandEnabled,
    bleMs: input.bleEffectTransitionMs,
    role: input.boardRole,
    scanner: input.scannerMac,
  });
  let h = 5381;
  for (let i = 0; i < payload.length; i++) {
    h = ((h << 5) + h) ^ payload.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

export async function loadBoardSyncMeta(): Promise<BoardSyncMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BoardSyncMeta;
  } catch {
    return null;
  }
}

export async function saveBoardSyncMeta(meta: BoardSyncMeta): Promise<void> {
  try {
    await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch (e) {
    console.warn('[BoardSync] Meta save failed:', e);
  }
}

export async function clearBoardSyncMeta(): Promise<void> {
  try {
    await AsyncStorage.removeItem(META_KEY);
  } catch { /* ignore */ }
}

export function isBoardSyncFresh(meta: BoardSyncMeta | null, fingerprint: string): boolean {
  if (!meta?.fullSyncAt) return false;
  if (Date.now() - meta.fullSyncAt > BOARD_SYNC_FRESH_MS) return false;
  return meta.fingerprint === fingerprint;
}

export function extractBoardPresetIds(raw: string): Set<string> {
  const ids = new Set<string>();
  try {
    const trimmed = (raw ?? '').trim();
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start === -1 || end <= start) return ids;
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    if (!Array.isArray(parsed)) return ids;
    for (const p of parsed) {
      if (p && typeof p.id === 'string') ids.add(p.id);
    }
  } catch { /* ignore */ }
  return ids;
}

export function formatSyncStatusLabel(
  s: BoardSyncStatus,
  connectionState: string,
  scanTimedOut = false,
): string {
  if (connectionState === 'scanning') return 'Scanning for IllumaBuggy…';
  if (connectionState === 'connecting') return 'Connecting…';
  if (connectionState === 'disconnected') return 'Disconnected — reconnecting…';
  if (connectionState === 'error') {
    return scanTimedOut
      ? "Can't find IllumaBuggy — check the board is powered on"
      : 'Connection error — retrying…';
  }
  if (!s.commandsReady) {
    if (s.detail) return s.detail;
    if (s.phase === 'essential') return 'Applying wand & MagicBand settings…';
    if (s.phase === 'verifying') return 'Checking presets on board…';
    if (s.phase === 'layouts') return 'Syncing segment layouts…';
    if (s.phase === 'presets') {
      const p = s.presetProgress;
      if (p) return `Syncing presets to board (${p.current}/${p.total})…`;
      return 'Syncing presets to board…';
    }
    return 'Preparing board…';
  }
  if (s.backgroundBusy) {
    const p = s.presetProgress;
    if (p) return `Ready — updating library (${p.current}/${p.total})`;
    return s.detail || 'Ready — background sync in progress';
  }
  if (s.mappingComplete === false) {
    return 'Ready — MB+/Wand mapping incomplete, reconnect to retry';
  }
  if (s.mode === 'quick') return 'Ready — reconnected (board config up to date)';
  return 'Ready — board synced';
}
