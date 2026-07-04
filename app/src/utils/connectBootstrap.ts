/**
 * Staged BLE connect bootstrap — avoid flooding the link at connect time.
 * Commands are enabled quickly; heavy work runs in the background.
 */

import { bleService } from '../services/BLEService';
import { useAppStore } from '../stores/store';
import {
  ensureMappingPresetsOnBoard,
  ensurePresetOnBoard,
  mbMappingEssentialPayload,
  pushHeavyBoardConfig,
  pushMbSegmentLayoutsToBoard,
  resolveActiveLayoutIndex,
} from './bleBoardSync';
import { collectMappingPresetIds } from './mbConfig';
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
  type BoardSyncMeta,
} from './boardSyncState';
import {
  markAllPresetsSynced,
  persistPresetSyncCache,
  restoreBoardPresetSyncCache,
  clearBoardPresetSyncCache,
  isPresetSynced,
} from './blePresetCache';

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface BoardStatusSnapshot {
  boardPresetCount: number;
  mbLayoutActive: number;
  mbLayoutCount: number;
  mbMappingLoaded: boolean;
}

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

function requestBoardStatus(timeoutMs = 8000): Promise<BoardStatusSnapshot | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(null);
    }, timeoutMs);
    const unsub = bleService.onMessage((msg) => {
      if (msg.type !== 'status') return;
      clearTimeout(timer);
      unsub();
      resolve({
        boardPresetCount: Number(msg.preset_count ?? 0),
        mbLayoutActive: Number(msg.mb_layout_active ?? 0),
        mbLayoutCount: Number(msg.mb_layout_count ?? 0),
        mbMappingLoaded: msg.mb_mapping_loaded !== false,
      });
    });
    void bleService.sendStatus();
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

function layoutMatchesBoard(
  meta: BoardSyncMeta | null,
  status: BoardStatusSnapshot,
  activeLayoutIdx: number,
): boolean {
  if (!meta?.mbLayoutCount) return false;
  return meta.mbLayoutCount === status.mbLayoutCount
    && meta.mbLayoutActive === status.mbLayoutActive
    && meta.mbLayoutActive === activeLayoutIdx;
}

function shouldForceMappingPresetSync(
  status: BoardStatusSnapshot | null,
  mbMapping: ReturnType<typeof useAppStore.getState>['mbMapping'],
): boolean {
  if (!status) return false;
  const mappingIds = collectMappingPresetIds(mbMapping);
  if (mappingIds.length === 0) return false;
  if (!status.mbMappingLoaded) return true;
  return status.boardPresetCount < mappingIds.length;
}

async function runEssentialConfig(token: number): Promise<{ ok: boolean; mappingSyncOk: boolean }> {
  setBoardSyncPhase('essential', 'Applying wand & MagicBand settings…', {
    mode: 'full',
    commandsReady: false,
    backgroundBusy: false,
  });

  useAppStore.getState().hydrateMbMappingFromActiveLayout();
  const s = useAppStore.getState();

  await bleService.sendSwConfig(s.starlightEnabled, s.starlightTimeoutSec * 1000);
  await delay(400);
  if (!bleService.isConnected() || token !== bootstrapToken) return { ok: false, mappingSyncOk: false };

  await bleService.sendMbConfig(
    s.magicBandEnabled,
    s.magicBandFivePoint,
    s.magicBandTimeoutSec * 1000,
    false,
  );
  await delay(400);
  if (!bleService.isConnected() || token !== bootstrapToken) return { ok: false, mappingSyncOk: false };

  await bleService.sendBleEffectConfig(s.bleEffectTransitionMs);
  await delay(300);
  if (!bleService.isConnected() || token !== bootstrapToken) return { ok: false, mappingSyncOk: false };

  await bleService.sendMbMappingConfig(
    mbMappingEssentialPayload(s.mbMapping, s.presets, s.recallState, s.customSegmentLayouts),
  );
  await delay(500);
  if (!bleService.isConnected() || token !== bootstrapToken) return { ok: false, mappingSyncOk: false };

  // Mapped presets (wand cast, MB animations) must exist on board NVS.
  const mappingSyncOk = await ensureMappingPresetsOnBoard(
    s.mbMapping,
    s.presets,
    s.recallState,
    s.customSegmentLayouts,
  ).catch((e) => {
    console.warn('[Bootstrap] Mapping preset sync failed:', e);
    return false;
  });
  await delay(400);

  const ok = bleService.isConnected() && token === bootstrapToken;
  return { ok, mappingSyncOk };
}

async function fetchBoardPresetIds(token: number): Promise<Set<string> | null> {
  setBoardSyncPhase('verifying', 'Checking presets on board…', { commandsReady: true });
  try {
    const listPromise = waitForBleMessage('preset_list_raw', 60_000);
    await delay(400);
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

async function syncMissingPresets(token: number, boardIds: Set<string>): Promise<void> {
  const s = useAppStore.getState();
  const missing = s.presets.filter(p => !boardIds.has(p.id));
  if (missing.length === 0) return;

  const label = `Syncing ${missing.length} preset(s) to board…`;
  markBoardSyncBackgroundBusy(true, label);
  setBoardSyncPresetProgress(0, missing.length, label);

  for (let i = 0; i < missing.length; i++) {
    if (!bleService.isConnected() || token !== bootstrapToken) return;
    const p = missing[i];
    await ensurePresetOnBoard(p, s.recallState, s.customSegmentLayouts);
    boardIds.add(p.id);
    setBoardSyncPresetProgress(i + 1, missing.length, label);
    await delay(500);
  }
}

async function runLayoutPush(token: number): Promise<BoardStatusSnapshot | null> {
  setBoardSyncPhase('layouts', 'Syncing segment layouts & MB mapping…', {
    commandsReady: true,
    backgroundBusy: true,
  });
  const s = useAppStore.getState();

  await ensureMappingPresetsOnBoard(
    s.mbMapping,
    s.presets,
    s.recallState,
    s.customSegmentLayouts,
  ).catch((e) => {
    console.warn('[Bootstrap] Mapping preset sync failed:', e);
    return false;
  });
  if (!bleService.isConnected() || token !== bootstrapToken) return null;

  await pushMbSegmentLayoutsToBoard(
    s.mbSegmentLayouts,
    s.mbActiveSegmentLayoutId,
    mbMappingEssentialPayload(
      useAppStore.getState().mbMapping,
      s.presets,
      s.recallState,
      s.customSegmentLayouts,
    ),
  ).catch((e) => console.warn('[Bootstrap] MB layout push failed:', e));
  if (!bleService.isConnected() || token !== bootstrapToken) return null;

  // pushMbSegmentLayoutsToBoard writes raw WLED segment geometry without going through
  // the override system — if a zone preset was live when this background sync ran, its
  // segments/colors just got stomped by the MB layout geometry. Force-restore it.
  const { reapplyCurrentZoneForced } = await import('./zoneLocationCore');
  reapplyCurrentZoneForced('post-layout-sync');

  return requestBoardStatus();
}

function markSessionReadyAndStatus(
  mode: 'quick' | 'full',
  detail: string,
  mappingSyncOk = true,
) {
  bleService.markSessionReady(true);
  const finalDetail = mappingSyncOk
    ? detail
    : 'Ready — MB+/Wand mapping incomplete, reconnect to retry';
  setBoardSyncReady(mode, finalDetail, mappingSyncOk);
  void bleService.sendStatus();
}

async function syncUnsyncedPresetsOnly(token: number): Promise<void> {
  const s = useAppStore.getState();
  const missing = s.presets.filter(p => !isPresetSynced(p.id));
  if (missing.length === 0) {
    console.log('[Bootstrap] Preset verify skipped — all presets cached as on-board');
    return;
  }
  const label = `Syncing ${missing.length} new preset(s) to board…`;
  markBoardSyncBackgroundBusy(true, label);
  setBoardSyncPresetProgress(0, missing.length, label);
  for (let i = 0; i < missing.length; i++) {
    if (!bleService.isConnected() || token !== bootstrapToken) return;
    await ensurePresetOnBoard(missing[i], s.recallState, s.customSegmentLayouts);
    setBoardSyncPresetProgress(i + 1, missing.length, label);
    await delay(500);
  }
}

async function runBackgroundSync(
  token: number,
  fingerprint: string,
  mode: 'quick' | 'full',
  opts: {
    needsLayout: boolean;
    activeLayoutIdx: number;
    status: BoardStatusSnapshot | null;
    requestedFullSync: boolean;
  },
): Promise<void> {
  // Let the post-connect zone re-apply finish before background board work.
  await delay(mode === 'quick' ? 5000 : 8000);
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  let status = opts.status;
  if (opts.needsLayout) {
    status = await runLayoutPush(token);
    if (!bleService.isConnected() || token !== bootstrapToken) return;
  }

  const s = useAppStore.getState();
  const phoneCount = s.presets.length;
  let presetVerifyOk = true;

  if (phoneCount === 0) {
    // nothing
  } else if (opts.requestedFullSync) {
    const boardIds = await fetchBoardPresetIds(token);
    if (!bleService.isConnected() || token !== bootstrapToken) return;
    if (!boardIds) {
      presetVerifyOk = false;
      bleService.clearInboundChunks();
      console.warn('[Bootstrap] Preset verify failed — leaving live WLED state untouched');
    } else {
      await syncMissingPresets(token, boardIds);
    }
  } else {
    await syncUnsyncedPresetsOnly(token);
  }

  if (!bleService.isConnected() || token !== bootstrapToken) return;
  if (presetVerifyOk) {
    await pushHeavyBoardConfig(s.showModeConfig);
  }

  const finalStatus = status ?? await requestBoardStatus();
  await persistPresetSyncCache(fingerprint, presetVerifyOk, finalStatus ? {
    active: finalStatus.mbLayoutActive,
    count: finalStatus.mbLayoutCount,
  } : undefined);

  markBoardSyncBackgroundBusy(false);
  setBoardSyncPresetProgress(0, 0);
  setBoardSyncReady(mode, presetVerifyOk
    ? (mode === 'quick' ? 'Ready — reconnected (board up to date)' : 'Ready — board synced')
    : 'Ready — preset verify skipped (zone preset unchanged)');
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

  await delay(600);
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  // Manual sync mode: skip all essential-config/mapping/layout/preset push.
  // Board runs entirely off its own NVS. User must tap "Sync board config".
  if (useAppStore.getState().syncMode === 'manual' && !forceFullSync) {
    markSessionReadyAndStatus('quick', 'Ready — manual sync (using board NVS)');
    return;
  }

  const fingerprint = getFingerprint();
  const meta = await loadBoardSyncMeta();
  const requestedFullSync = forceFullSync;
  const useQuick = !requestedFullSync && isBoardSyncFresh(meta, fingerprint);
  forceFullSync = false;

  const s = useAppStore.getState();
  const resolvedLayoutIdx = resolveActiveLayoutIndex(
    s.mbSegmentLayouts,
    s.mbActiveSegmentLayoutId,
  );

  // Restore last-known on-board preset ids so reconnect skips preset_list unless forced.
  if (meta?.syncedPresetIds?.length) {
    restoreBoardPresetSyncCache(meta.syncedPresetIds);
  }

  let mappingSyncOk = true;
  if (useQuick) {
    // Quick reconnect — skip essential BLE config push.
  } else {
    const essential = await runEssentialConfig(token);
    if (!essential.ok) return;
    mappingSyncOk = essential.mappingSyncOk;
  }

  const status = await requestBoardStatus();
  if (shouldForceMappingPresetSync(status, s.mbMapping)) {
    setBoardSyncPhase('essential', 'Syncing MB+/Wand mapping presets…', {
      commandsReady: false,
      backgroundBusy: false,
    });
    if (status && !status.mbMappingLoaded) {
      await bleService.sendMbMappingConfig(
        mbMappingEssentialPayload(s.mbMapping, s.presets, s.recallState, s.customSegmentLayouts),
      );
      await delay(500);
      if (!bleService.isConnected() || token !== bootstrapToken) return;
    }
    mappingSyncOk = await ensureMappingPresetsOnBoard(
      s.mbMapping,
      s.presets,
      s.recallState,
      s.customSegmentLayouts,
      true,
    ).catch((e) => {
      console.warn('[Bootstrap] Forced mapping preset sync failed:', e);
      return false;
    });
    if (!bleService.isConnected() || token !== bootstrapToken) return;
  }
  // MB layout push can stomp live segments/colors. Keep reconnect bootstrap stable by
  // only pushing layouts on explicit full-sync requests from the user.
  const needsLayout = requestedFullSync
    && !layoutMatchesBoard(
      meta,
      status ?? { boardPresetCount: 0, mbLayoutActive: 0, mbLayoutCount: 0, mbMappingLoaded: false },
      resolvedLayoutIdx,
    );

  const phoneCount = s.presets.length;
  const boardCount = status?.boardPresetCount ?? 0;
  const canTrustQuick = useQuick
    && mappingSyncOk
    && meta?.syncedPresetIds?.length
    && phoneCount > 0
    && boardCount >= phoneCount
    && !needsLayout;

  if (canTrustQuick) {
    markAllPresetsSynced(s.presets.map(p => p.id));
    await persistPresetSyncCache(fingerprint, false, status ? {
      active: status.mbLayoutActive,
      count: status.mbLayoutCount,
    } : undefined);
    markSessionReadyAndStatus('quick', 'Ready — reconnected (board up to date)', mappingSyncOk);
    return;
  }

  markSessionReadyAndStatus(
    useQuick ? 'quick' : 'full',
    'Ready — syncing board in background…',
    mappingSyncOk,
  );

  void runBackgroundSync(token, fingerprint, useQuick ? 'quick' : 'full', {
    needsLayout,
    activeLayoutIdx: resolvedLayoutIdx,
    status,
    requestedFullSync,
  }).catch((e) => console.warn('[Bootstrap] Background sync failed:', e));
}

export function cancelConnectBootstrap(): void {
  bootstrapToken++;
  bleService.markSessionReady(false);
  resetBoardSyncStatus();
}
