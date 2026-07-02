/**
 * Staged BLE connect bootstrap — avoid flooding the link at connect time.
 */

import { bleService } from '../services/BLEService';
import { useAppStore, mbMappingToBlePayload } from '../stores/store';
import {
  ensureMappingPresetsOnBoard,
  pushHeavyBoardConfig,
  pushMbSegmentLayoutsToBoard,
  refreshWledCatalog,
  syncPresetsToBoard,
} from './bleBoardSync';

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function waitForBleMessage(type: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`Timed out waiting for ${type}`));
    }, timeoutMs);
    const unsub = bleService.onMessage((msg) => {
      if (msg.type !== type) return;
      clearTimeout(timer);
      unsub();
      resolve();
    });
  });
}

let bootstrapToken = 0;

async function runBackgroundSync(token: number): Promise<void> {
  // Let connect-time MB layout + early Fire commands finish before preset bulk sync.
  await delay(5000);
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  const presetListWait = waitForBleMessage('preset_list_raw', 45_000).catch(() => {});
  await bleService.sendPresetList();
  await presetListWait;
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  const afterList = useAppStore.getState();
  if (afterList.presets.length > 0) {
    await syncPresetsToBoard(afterList.presets, afterList.customSegmentLayouts);
  }
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  await pushHeavyBoardConfig(afterList.showModeConfig);
}

export async function runConnectBootstrap(): Promise<void> {
  const token = ++bootstrapToken;
  bleService.markSessionReady(false);

  await delay(1200);
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  useAppStore.getState().hydrateMbMappingFromActiveLayout();
  const s = useAppStore.getState();

  await bleService.sendSwConfig(s.starlightEnabled, s.starlightTimeoutSec * 1000);
  await delay(500);
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  await bleService.sendMbConfig(
    s.magicBandEnabled,
    s.magicBandFivePoint,
    s.magicBandTimeoutSec * 1000,
    false,
  );
  await delay(500);
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  await bleService.sendBleEffectConfig(s.bleEffectTransitionMs);
  await delay(500);
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  // Wand/MB animation presets (e.g. swAnimations.wand → "Starlight Wand Cast") must be on board NVS.
  await ensureMappingPresetsOnBoard(
    s.mbMapping,
    s.presets,
    s.recallState,
    s.customSegmentLayouts,
  ).catch((e) => console.warn('[Bootstrap] Mapping preset sync failed:', e));
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  // MB segment layouts — push + switch before long preset/catalog sync.
  await pushMbSegmentLayoutsToBoard(
    s.mbSegmentLayouts,
    s.mbActiveSegmentLayoutId,
    mbMappingToBlePayload(useAppStore.getState().mbMapping),
  ).catch((e) => console.warn('[Bootstrap] MB layout push failed:', e));

  if (bleService.isConnected() && token === bootstrapToken) {
    bleService.markSessionReady(true);
    await bleService.sendStatus();
    // WLED catalog in parallel — Library tab should populate within a few seconds.
    void refreshWledCatalog().catch((e) =>
      console.warn('[Bootstrap] WLED catalog refresh failed:', e),
    );
  }

  // Preset sync + WLED catalog run in background — don't block Fire / Library.
  void runBackgroundSync(token).catch((e) =>
    console.warn('[Bootstrap] Background sync failed:', e),
  );
}

export function cancelConnectBootstrap(): void {
  bootstrapToken++;
  bleService.markSessionReady(false);
}
