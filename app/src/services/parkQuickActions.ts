/**
 * Fire active zone preset and fade-to-black — shared by Home and notification actions.
 */

import { bleService } from './BLEService';
import { useAppStore } from '../stores/store';
import {
  triggerFadeToBlackEffect,
} from '../utils/effectTrigger';

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
  // Firmware override priority: NONE < ZONE < MANUAL < SHOW_MODE < BLE_MAGIC < BLE_STARLIGHT.
  // wled_raw with a preset_id sets MANUAL itself — only pre-clear when something outranks
  // MANUAL, otherwise clearing here just restores the old look for a moment before we
  // overwrite it (visible flash) with nothing gained.
  const status = s.deviceStatus;
  if ((status?.override ?? 0) > 2) {
    await bleService.sendOverrideClear();
    await new Promise(r => setTimeout(r, 250));
  }
  const { applyZonePreset } = await import('../utils/bleBoardSync');
  const ok = await applyZonePreset(preset, s.recallState, s.customSegmentLayouts, {
    trustSend: true,
    zoneGps: true,
  });
  return ok
    ? { ok: true }
    : { ok: false, message: 'Preset apply failed — check BLE/WLED connection.' };
}

let ftbInFlight: Promise<QuickActionResult> | null = null;
let lastFtbAt = 0;

export async function fadeToBlackQuick(): Promise<QuickActionResult> {
  const now = Date.now();
  if (now - lastFtbAt < 800) {
    return { ok: true };
  }
  if (ftbInFlight) return ftbInFlight;

  ftbInFlight = (async (): Promise<QuickActionResult> => {
    lastFtbAt = Date.now();
    const s = useAppStore.getState();
    if (!bleService.isConnected()) {
      return { ok: false, message: 'Not connected to the stroller board.' };
    }
    if (!bleService.isSessionReady()) {
      return { ok: false, message: 'Board still syncing.' };
    }
    // Same reasoning as fireActiveZonePreset — only clear if something outranks MANUAL.
    const status = s.deviceStatus;
    if ((status?.override ?? 0) > 2) {
      console.log('[Effect] FTB clearing override first', status.override);
      await bleService.sendOverrideClear();
      await new Promise(r => setTimeout(r, 300));
    }
    const ok = await triggerFadeToBlackEffect(
      s.ftbPresetId || undefined,
      s.bleEffectTransitionMs || 800,
      'quick-action-ftb',
    );
    return ok ? { ok: true } : { ok: false, message: 'Could not send fade-to-black.' };
  })();

  try {
    return await ftbInFlight;
  } finally {
    ftbInFlight = null;
  }
}
