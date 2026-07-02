/**
 * Fire active zone preset and fade-to-black — shared by Home and notification actions.
 */

import { bleService } from './BLEService';
import { useAppStore } from '../stores/store';
import { applyPresetToBoard } from '../utils/bleBoardSync';

export interface QuickActionResult {
  ok: boolean;
  message?: string;
}

export async function fireActiveZonePreset(): Promise<QuickActionResult> {
  const s = useAppStore.getState();
  const zone = s.zones.find(z => s.activeZoneIds.includes(z.id) && z.presetId);
  if (!zone?.presetId) {
    return { ok: false, message: 'Not in a zone with a preset assigned.' };
  }
  if (!bleService.isConnected()) {
    return { ok: false, message: 'Not connected to the stroller board.' };
  }
  if (!bleService.isSessionReady()) {
    return { ok: false, message: 'Board still syncing — wait for Ready on Home.' };
  }
  const preset = s.presets.find(p => p.id === zone.presetId);
  if (!preset) {
    return { ok: false, message: `Preset missing for zone "${zone.name}".` };
  }
  const status = s.deviceStatus;
  if ((status?.override ?? 0) > 0) {
    await bleService.sendOverrideClear();
    await new Promise(r => setTimeout(r, 250));
  }
  const ok = await applyPresetToBoard(preset, s.recallState, s.customSegmentLayouts);
  return ok
    ? { ok: true }
    : { ok: false, message: 'Preset apply failed — check BLE/WLED connection.' };
}

export async function fadeToBlackQuick(): Promise<QuickActionResult> {
  const s = useAppStore.getState();
  if (!bleService.isConnected()) {
    return { ok: false, message: 'Not connected to the stroller board.' };
  }
  if (!bleService.isSessionReady()) {
    return { ok: false, message: 'Board still syncing.' };
  }
  const sent = await bleService.sendFadeToBlack(
    s.ftbPresetId || undefined,
    s.bleEffectTransitionMs || 800,
  );
  return sent ? { ok: true } : { ok: false, message: 'Could not send fade-to-black.' };
}
