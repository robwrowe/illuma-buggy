/**
 * Execute BLE commands queued when background send failed (main JS context).
 */

import { bleService } from '../services/BLEService';
import { useAppStore } from '../stores/store';
import { applyZonePreset } from './bleBoardSync';
import { drainPendingBle, enqueuePendingBle, type PendingBleAction } from './locationRuntimeBridge';

async function runAction(action: PendingBleAction): Promise<void> {
  if (action.type === 'brightness') {
    if (bleService.isConnected()) {
      await bleService.sendBrightness(action.value);
      console.log('[PendingBLE] brightness sent', action.value);
    }
    return;
  }
  if (action.type === 'override_clear') {
    if (bleService.isConnected()) {
      await bleService.sendOverrideClear();
      console.log('[PendingBLE] override_clear sent');
    }
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
    const ok = await applyZonePreset(preset, s.recallState, s.customSegmentLayouts, {
      trustSend: true,
      zoneGps: true,
    });
    console.log('[PendingBLE] zone_preset', zone?.name ?? preset.name, ok ? 'SENT' : 'FAILED');
  }
}

/** Drain queued BLE work — coalesce rapid zone_preset to the latest only. */
export async function drainPendingBleActions(reason: string): Promise<void> {
  const actions = await drainPendingBle();
  if (!actions.length) return;

  if (!bleService.isConnected()) {
    console.log('[PendingBLE] skip drain — BLE not connected', reason, `(${actions.length} queued)`);
    for (const a of actions) {
      if (a.type === 'zone_preset') await enqueuePendingBle({ type: 'zone_preset', presetId: a.presetId });
      else if (a.type === 'brightness') await enqueuePendingBle({ type: 'brightness', value: a.value });
      else await enqueuePendingBle({ type: 'override_clear' });
    }
    return;
  }

  if (!bleService.isSessionReady()) {
    console.log('[PendingBLE] skip drain — session not ready', reason, `(${actions.length} queued)`);
    for (const a of actions) {
      if (a.type === 'zone_preset') await enqueuePendingBle({ type: 'zone_preset', presetId: a.presetId });
      else if (a.type === 'brightness') await enqueuePendingBle({ type: 'brightness', value: a.value });
      else await enqueuePendingBle({ type: 'override_clear' });
    }
    return;
  }

  const coalesced: PendingBleAction[] = [];
  let latestZonePreset: PendingBleAction | null = null;
  for (const a of actions) {
    if (a.type === 'zone_preset') latestZonePreset = a;
    else coalesced.push(a);
  }
  if (latestZonePreset) coalesced.push(latestZonePreset);

  console.log('[PendingBLE] drain', reason, coalesced.length, 'actions');
  for (const action of coalesced) {
    try {
      await runAction(action);
    } catch (e) {
      console.warn('[PendingBLE] action failed:', action.type, e);
    }
  }
}
