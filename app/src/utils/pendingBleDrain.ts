/**
 * Execute BLE commands queued by the headless location task (main JS context only).
 */

import { bleService } from '../services/BLEService';
import { useAppStore } from '../stores/store';
import {
  triggerZonePresetEffect,
  triggerBrightnessEffect,
  triggerOverrideClearEffect,
} from './effectTrigger';
import { drainPendingBle, type PendingBleAction } from './locationRuntimeBridge';

async function runAction(action: PendingBleAction): Promise<void> {
  if (action.type === 'brightness') {
    await triggerBrightnessEffect(action.value, 'pending-drain');
    return;
  }
  if (action.type === 'override_clear') {
    await triggerOverrideClearEffect('pending-drain');
    return;
  }
  if (action.type === 'zone_preset') {
    const s = useAppStore.getState();
    const preset = s.presets.find(p => p.id === action.presetId);
    const zone = s.zones.find(z => z.presetId === action.presetId);
    if (!preset) {
      console.warn('[PendingBLE] preset missing', action.presetId);
      return;
    }
    await triggerZonePresetEffect(
      action.presetId,
      zone?.name ?? preset.name,
      'pending-drain',
    );
  }
}

/** Drain queued headless BLE work — coalesce rapid zone_preset to the latest only. */
export async function drainPendingBleActions(reason: string): Promise<void> {
  const actions = await drainPendingBle();
  if (!actions.length) return;

  if (!bleService.isConnected()) {
    console.log('[PendingBLE] skip drain — BLE not connected', reason, `(${actions.length} queued)`);
    // Re-queue so we don't lose actions
    for (const a of actions) {
      const { enqueuePendingBle } = await import('./locationRuntimeBridge');
      if (a.type === 'zone_preset') await enqueuePendingBle({ type: 'zone_preset', presetId: a.presetId });
      else if (a.type === 'brightness') await enqueuePendingBle({ type: 'brightness', value: a.value });
      else await enqueuePendingBle({ type: 'override_clear' });
    }
    return;
  }

  const coalesced: PendingBleAction[] = [];
  let latestZonePreset: PendingBleAction | null = null;
  for (const a of actions) {
    if (a.type === 'zone_preset') {
      latestZonePreset = a;
    } else {
      coalesced.push(a);
    }
  }
  if (latestZonePreset) coalesced.push(latestZonePreset);

  console.log('[PendingBLE] drain', reason, coalesced.length, 'actions', {
    connected: bleService.isConnected(),
    sessionReady: bleService.isSessionReady(),
  });
  for (const action of coalesced) {
    try {
      await runAction(action);
    } catch (e) {
      console.warn('[PendingBLE] action failed:', action.type, e);
    }
  }
}
