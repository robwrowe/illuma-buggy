/**
 * Staged BLE connect bootstrap — avoid flooding the link at connect time.
 */

import { bleService } from '../services/BLEService';
import { useAppStore, mbMappingToBlePayload } from '../stores/store';
import { pushHeavyBoardConfig, syncPresetsToBoard } from './bleBoardSync';

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

export async function runConnectBootstrap(): Promise<void> {
  const token = ++bootstrapToken;
  bleService.markSessionReady(false);

  await delay(1200);
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  const s = useAppStore.getState();

  await bleService.sendSwConfig(s.starlightEnabled, s.starlightTimeoutSec * 1000);
  await delay(500);
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  await bleService.sendMbConfig(
    s.magicBandEnabled,
    s.magicBandFivePoint,
    s.magicBandTimeoutSec * 1000,
    false, // firmware applies MB locally; app ble_e9 is optional overlay
  );
  await delay(500);
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  await bleService.sendBleEffectConfig(s.bleEffectTransitionMs);
  await delay(500);
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  const presetListWait = waitForBleMessage('preset_list_raw', 45_000).catch(() => {});
  await bleService.sendPresetList();
  await presetListWait;
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  // Push all phone presets to board NVS so apply is a tiny preset_apply command.
  const afterList = useAppStore.getState();
  if (afterList.presets.length > 0) {
    await syncPresetsToBoard(afterList.presets, afterList.customSegmentLayouts);
  }
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  const latest = useAppStore.getState();
  if (latest.wledEffects.length === 0) {
    await delay(2500);
    if (!bleService.isConnected() || token !== bootstrapToken) return;

    const fxWait = waitForBleMessage('wled_fxdata_done', 60_000).catch(() => {});
    await bleService.sendGetFxData();
    await fxWait;
    await delay(1500);
    if (!bleService.isConnected() || token !== bootstrapToken) return;

    const effWait = waitForBleMessage('wled_effects_done', 45_000).catch(() => {});
    await bleService.sendGetEffects();
    await effWait;
    await delay(1500);
    if (!bleService.isConnected() || token !== bootstrapToken) return;

    await bleService.sendGetPalettes();
    await waitForBleMessage('wled_palettes_done', 30_000).catch(() => {});
  }

  await delay(2000);
  if (!bleService.isConnected() || token !== bootstrapToken) return;

  await pushHeavyBoardConfig(
    mbMappingToBlePayload(latest.mbMapping),
    latest.mbSegmentLayouts,
    latest.mbActiveSegmentLayoutId,
    latest.showModeConfig,
  ).catch((e) => console.warn('[Bootstrap] Heavy config push failed:', e));

  if (bleService.isConnected() && token === bootstrapToken) {
    bleService.markSessionReady(true);
    await bleService.sendStatus();
  }
}

export function cancelConnectBootstrap(): void {
  bootstrapToken++;
  bleService.markSessionReady(false);
}
