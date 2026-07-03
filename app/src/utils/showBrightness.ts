/**
 * Show live brightness — nighttime only, when auto-brightness is enabled.
 */

import { bleService } from '../services/BLEService';
import { useAppStore } from '../stores/store';
import type { BrightnessConfig } from '../stores/store';
import { applyAmbientBrightnessNow } from './zoneLocationCore';
import { solarElevation } from './utils';

let showBrightnessActive = false;

export function isNighttimeAt(
  lat: number,
  lng: number,
  config: BrightnessConfig,
  date: Date = new Date(),
): boolean {
  return solarElevation(lat, lng, date) < config.solarThresholdDeg;
}

/** Apply show night brightness when live starts (manual or automated). */
export async function applyShowLiveBrightnessIfNeeded(): Promise<void> {
  if (!bleService.isConnected()) return;
  const { showSettings, brightnessConfig, userLocation } = useAppStore.getState();
  if (!showSettings.showAutoBrightness) return;
  if (!userLocation) {
    console.log('[Show] live brightness skipped — no GPS');
    return;
  }
  if (!isNighttimeAt(userLocation.latitude, userLocation.longitude, brightnessConfig)) {
    console.log('[Show] live brightness skipped — daytime');
    return;
  }
  const bri = Math.min(255, Math.max(0, Math.round(showSettings.showNightBrightness)));
  console.log('[Show] applying live brightness', bri);
  await bleService.sendBrightness(bri);
  showBrightnessActive = true;
}

/** Restore solar/indoor brightness after show ends if live dimming was applied. */
export async function restoreShowBrightnessIfNeeded(): Promise<void> {
  if (!showBrightnessActive) return;
  showBrightnessActive = false;
  if (!bleService.isConnected()) return;
  const { userLocation } = useAppStore.getState();
  if (!userLocation) {
    console.log('[Show] restore brightness skipped — no GPS');
    return;
  }
  console.log('[Show] restoring ambient brightness');
  applyAmbientBrightnessNow();
}
