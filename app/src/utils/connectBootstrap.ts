/**
 * Staged BLE connect bootstrap — avoid flooding the link at connect time.
 * Quick reconnect: within BOARD_SYNC_FRESH_MS + matching fingerprint, skip heavy pushes.
 */

import { bleService } from '../services/BLEService';
import { useAppStore, mbMappingToBlePayload } from '../stores/store';
import {
  ensureMappingPresetsOnBoard,
  ensurePresetOnBoard,
  pushHeavyBoardConfig,
  pushMbSegmentLayoutsToBoard,
  refreshWledCatalog,
  syncPresetsToBoard,
} from './bleBoardSync';
import {
  computeBoardConfigFingerprint,
  extractBoardPresetIds,
  isBoardSyncFresh,
  loadBoardSyncMeta,
  markBoardSyncBackgroundBusy,
  resetBoardSyncStatus,
  setBoardSyncPhase,
  setBoardSyncPresetProgress,
  setBoardSyncReady,
} from './boardSyncState';
import {
  markAllPresetsSynced,
  persistPresetSyncCache,
  restoreBoardPresetSyncCache,
  clearBoardPresetSyncCache,
} from './blePresetCache';

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function waitForBleMessage(type: string, timeoutMs: number): Promise<string | void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`Timed out waiting for ${type}`));
    }, timeoutMs);
    const unsub = bleService.onMessage((msg) => {
      if (msg.type !== type) return;
      clearTimeout(timer);
      unsub();
      resolve((msg.raw as string) ?? undefined);
    });
  });
}

let bootstrapToken = 0;
let forceFullSync = false;

export function requestFullBoardSync(): void {
  forceFullSync = true;
  clearBoardPresetSyncCache();
  if (bleService.isConnected()) {
    void runConnectBootstrap().catch((e) =>
      console.warn('[Bootstrap] Forced full sync failed:', e),
    );
  }
}

function getFingerprint() {
  const s = useAppStore.getState();
  return computeBoardConfigFingerprint({
    presets: s.presets,
    mbMapping: s.mbMapping,
    mbSegmentLayouts: s.mbSegmentLayouts,
    mbActiveSegmentLayoutId: s.mbActiveSegmentLayoutId,
    showModeConfig: s.showModeConfig,
    starlightEnabled: s.starlightEnabled,
    magicBandEnabled: s.magicBandEnabled,
    bleEffectTransitionMs: s.bleEffectTransitionMs,
  });
}

async function runEssentialConfig(token: number): Promise<boolean> {
  setBoardSyncPhase('essential', 'Applying wand & MagicBand settings…', {
    mode: 'full',
    commandsReady: false,
    backgroundBusy: false,
  });

  useAppStore.getState().hydrateMbMappingFromActiveLayout();
  const s = useAppStore.getState();

  await bleService.sendSwConfig(s.starlightEnabled, s.starlightTimeoutSec * 1000);
  await delay(400);
  if (!bleService.isConnected() || token !== bootstrapToken) return false;

  await bleService.sendMbConfig(
    s.magicBandEnabled,
    s.magicBandFivePoint,
    s.magicBandTimeoutSec * 1000,
    false,
  );
  await delay(400);
  if (!bleService.isConnected() || token !== bootstrapToken) return false;

  await bleService.sendBleEffectConfig(s.bleEffectTransitionMs);
  await delay(300);
  return bleService.isConnected() && token === bootstrapToken;
}

async function fetchBoardPresetIds(token: number): Promise<Set<string> | null> {
  setBoardSyncPhase('verifying', 'Checking presets on board…', { commandsReady: false });
  try {
    const listPromise = waitForBleMessage('preset_list_raw', 45_000);
    await bleService.sendPresetList();
    const raw = await listPromise;
    if (!bleService.isConnected() || token !== bootstrapToken) return null;
    if (typeof raw === 'string' && raw.length > 0) {
      useAppStore.getState().syncBoardPresets(raw);
    }
    const boardIds = typeof raw === 'string' ? extractBoardPresetIds(raw) : new Set<string>();
    markAllPresetsSynced([...boardIds]);
    return boardIds;
  } catch (e) {
    console.warn('[Bootstrap] Preset list verify failed:', e);
    return null;
  }
}

async function syncMissingPresets(
  token: number,
  boardIds: Set<string>,
  background: boolean,
): Promise<void> {
  const s = useAppStore.getState();
  const missing = s.presets.filter(p => !boardIds.has(p.id));
  if (missing.length === 0) return;

  const label = `Syncing ${missing.length} preset(s) to board…`;
  if (background) {
    markBoardSyncBackgroundBusy(true, label);
  } else {
    setBoardSyncPhase('presets', label, {
      presetProgress: { current: 0, total: missing.length },
      commandsReady: false,
    });
  }

  for (let i = 0; i < missing.length; i++) {
    if (!bleService.isConnected() || token !== bootstrapToken) return;
    const p = missing[i];
    await ensurePresetOnBoard(p, s.recallState, s.customSegmentLayouts);
    boardIds.add(p.id);
    setBoardSyncPresetProgress(i + 1, missing.length, label);
    await delay(350);
  }
}

async function runFullLayoutSync(token: number): Promise<void> {
  setBoardSyncPhase('layouts', 'Syncing segment layouts & MB mapping…', {
    mode: 'full',
    commandsReady: false,
  });
  const s = useAppStore.getState();

  await ensureMappingPresetsOnBoard(
    s.mbMapping,
    s.presets,
    s.recallState,
    s.customSegmentLayouts,
  ).catch((e) => console.warn('[Bootstrap] Mapping preset sync failed:', e));
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  await pushMbSegmentLayoutsToBoard(
    s.mbSegmentLayouts,
    s.mbActiveSegmentLayoutId,
    mbMappingToBlePayload(useAppStore.getState().mbMapping),
  ).catch((e) => console.warn('[Bootstrap] MB layout push failed:', e));
}

async function runBackgroundFullSync(token: number, fingerprint: string): Promise<void> {
  await delay(3000);
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  const afterList = useAppStore.getState();
  if (afterList.presets.length > 0) {
    markBoardSyncBackgroundBusy(true, 'Syncing full preset library…');
    await syncPresetsToBoard(
      afterList.presets,
      afterList.customSegmentLayouts,
      (current, total) => setBoardSyncPresetProgress(current, total, 'Syncing full preset library…'),
    );
  }
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  await pushHeavyBoardConfig(afterList.showModeConfig);
  await persistPresetSyncCache(fingerprint, true);
  markBoardSyncBackgroundBusy(false);
  setBoardSyncReady('full', 'Ready — board fully synced');
}

function markSessionReadyAndStatus(mode: 'quick' | 'full', detail: string) {
  bleService.markSessionReady(true);
  setBoardSyncReady(mode, detail);
  void bleService.sendStatus();
  void refreshWledCatalog().catch((e) =>
    console.warn('[Bootstrap] WLED catalog refresh failed:', e),
  );
}

export async function runConnectBootstrap(): Promise<void> {
  const token = ++bootstrapToken;
  bleService.markSessionReady(false);
  resetBoardSyncStatus();
  setBoardSyncPhase('connecting', 'Connected — preparing board…', {
    mode: 'none',
    commandsReady: false,
    backgroundBusy: false,
  });

  await delay(800);
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  const fingerprint = getFingerprint();
  const meta = await loadBoardSyncMeta();
  const useQuick = !forceFullSync && isBoardSyncFresh(meta, fingerprint);
  forceFullSync = false;

  if (useQuick && meta?.syncedPresetIds?.length) {
    restoreBoardPresetSyncCache(meta.syncedPresetIds);
  }

  const ok = await runEssentialConfig(token);
  if (!ok) return;

  if (useQuick) {
    setBoardSyncPhase('verifying', 'Quick reconnect — verifying board…', { mode: 'quick' });
    const boardIds = await fetchBoardPresetIds(token);
    if (!bleService.isConnected() || token !== bootstrapToken) return;

    const s = useAppStore.getState();
    const allOnBoard = s.presets.length === 0
      || (boardIds !== null && s.presets.every(p => boardIds.has(p.id)));

    if (!allOnBoard && boardIds) {
      await syncMissingPresets(token, boardIds, false);
    }
    if (!bleService.isConnected() || token !== bootstrapToken) return;

    await persistPresetSyncCache(fingerprint, false);
    const readyDetail = boardIds === null
      ? 'Ready — could not verify presets (tap Sync Board if commands fail)'
      : 'Ready — reconnected (board config up to date)';
    markSessionReadyAndStatus('quick', readyDetail);
    return;
  }

  // Full sync path
  setBoardSyncPhase('layouts', 'Full sync — pushing config…', { mode: 'full' });
  await runFullLayoutSync(token);
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  const boardIds = await fetchBoardPresetIds(token);
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  if (boardIds) {
    const s = useAppStore.getState();
    const missing = s.presets.filter(p => !boardIds.has(p.id));
    if (missing.length > 0) {
      await syncMissingPresets(token, boardIds, false);
    }
  }
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  markSessionReadyAndStatus('full', 'Ready — essential sync complete');
  void runBackgroundFullSync(token, fingerprint).catch((e) =>
    console.warn('[Bootstrap] Background full sync failed:', e),
  );
}

export function cancelConnectBootstrap(): void {
  bootstrapToken++;
  bleService.markSessionReady(false);
  resetBoardSyncStatus();
}
