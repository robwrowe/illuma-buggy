/**
 * Shared GPS → zones / brightness / BLE zone trigger logic (foreground + background task).
 */

import { useAppStore, type Zone, type LatLng } from '../stores/store';
import { findTriggerZone, findContainingIndoorZone, sunBasedBrightness, zonesContainingPoint } from './utils';
import { resolveActivePark } from './resolveActivePark';
import { bleService } from '../services/BLEService';
import { applyZonePreset } from './bleBoardSync';
import { getBoardSyncStatus, onBoardSyncStatus } from './boardSyncState';
import { notifyZoneEffectApplied, dismissZoneEffectNotification } from '../services/strollerNotification';
import { shouldProtectShowFromZones } from './showZoneGuard';
import {
  saveLocationRuntime,
  saveZoneRuntime,
  loadZoneRuntime,
} from './locationRuntimeBridge';

const ZONE_REAPPLY_MS = 45_000;
const BRIGHTNESS_RAMP_MS = 2000;

let currentZoneId: string | null = null;
let pendingZone: Zone | null = null;
let lastZoneApply: { zoneId: string; at: number } | null = null;
let isIndoor = false;
let lastBrightness: number | null = null;
let brightnessTimer: ReturnType<typeof setTimeout> | null = null;
let zoneTriggersSuppressed = false;
let lastLoggedActiveIds: string[] = [];
let zoneApplyChain: Promise<void> = Promise.resolve();

function zoneLog(msg: string, extra?: Record<string, unknown>) {
  if (extra) console.log('[Zone]', msg, extra);
  else console.log('[Zone]', msg);
}

function isShowProtectingZones(activeZoneIds: string[]): boolean {
  const s = useAppStore.getState();
  return shouldProtectShowFromZones({
    activeParkId: s.activePark?.id,
    activeZoneIds,
    showBindings: s.showBindings,
    deviceStatus: s.deviceStatus,
    showScheduleProtects: s.showProtectsZones,
  });
}

function shouldApplyZone(zone: Zone, force: boolean): boolean {
  if (force) return true;
  if (!lastZoneApply || lastZoneApply.zoneId !== zone.id) return true;
  return Date.now() - lastZoneApply.at >= ZONE_REAPPLY_MS;
}

function canApplyZoneNow(): boolean {
  if (!bleService.isConnected() || !bleService.isSessionReady()) return false;
  const phase = getBoardSyncStatus().phase;
  if (phase === 'connecting' || phase === 'essential') return false;
  return true;
}

function applyZoneEntry(zone: Zone, force: boolean, reason: string) {
  if (!zone.presetId) return;
  if (!shouldApplyZone(zone, force)) {
    zoneLog(`skip re-apply "${zone.name}" (throttled)`, { presetId: zone.presetId, reason });
    return;
  }
  lastZoneApply = { zoneId: zone.id, at: Date.now() };

  const run = async () => {
    if (!canApplyZoneNow()) {
      pendingZone = zone;
      zoneLog('apply deferred — BLE busy or not ready', {
        zone: zone.name,
        presetId: zone.presetId,
        connected: bleService.isConnected(),
        sessionReady: bleService.isSessionReady(),
        syncPhase: getBoardSyncStatus().phase,
      });
      return;
    }
    const s = useAppStore.getState();
    const preset = s.presets.find(p => p.id === zone.presetId);
    if (!preset) {
      zoneLog(`preset missing in app`, { zone: zone.name, presetId: zone.presetId });
      return;
    }
    zoneLog(`ENTER → wled_raw "${preset.name}"`, {
      zone: zone.name,
      presetId: preset.id,
      reason,
      connected: bleService.isConnected(),
      sessionReady: bleService.isSessionReady(),
    });
    const ok = await applyZonePreset(preset, s.recallState, s.customSegmentLayouts, {
      trustSend: true,
      zoneGps: true,
    });
    zoneLog(ok ? 'apply OK' : 'apply FAILED', { presetId: preset.id, zone: zone.name });
    if (ok) {
      pendingZone = null;
      void notifyZoneEffectApplied({
        triggerZoneId: zone.id,
        zoneName: zone.name,
        presetName: preset.name,
        sent: true,
        parkName: s.activePark?.name ?? null,
      });
    } else {
      pendingZone = zone;
    }
  };
  zoneApplyChain = zoneApplyChain.then(run).catch((e) => {
    console.warn('[Zone] apply error:', e);
  });
}

function runZoneTriggerLogic(
  pt: LatLng,
  zones: Zone[],
  zonesEnabled: boolean,
  forceReeval = false,
  reason = 'gps',
) {
  if (!zonesEnabled) return;

  const triggerZone = findTriggerZone(pt, zones);
  let prevId = currentZoneId;

  if (forceReeval) {
    prevId = null;
    currentZoneId = null;
    lastZoneApply = null;
    zoneLog('re-evaluating zones after show protection ended', { reason });
  }

  if (triggerZone?.id === prevId) return;

  if (triggerZone?.presetId) {
    zoneLog(`transition → "${triggerZone.name}"`, {
      from: prevId,
      to: triggerZone.id,
      presetId: triggerZone.presetId,
      reason,
    });
  } else if (prevId) {
    const left = zones.find(z => z.id === prevId);
    zoneLog(`EXIT "${left?.name ?? prevId}"`, { reason });
  }

  currentZoneId = triggerZone?.id ?? null;
  if (triggerZone?.presetId) {
    if (!bleService.isConnected()) {
      pendingZone = triggerZone;
      zoneLog('queued pending zone apply (not connected)', { zone: triggerZone.name });
      return;
    }
    if (!canApplyZoneNow()) {
      pendingZone = triggerZone;
      zoneLog('queued pending zone apply (BLE not ready)', { zone: triggerZone.name });
      return;
    }
    applyZoneEntry(triggerZone, true, reason);
  } else if (prevId) {
    pendingZone = null;
    lastZoneApply = null;
    const left = zones.find(z => z.id === prevId);
    if (left?.presetId && bleService.isConnected()) {
      zoneLog('override_clear after zone exit');
      bleService.sendOverrideClear();
      void dismissZoneEffectNotification();
    }
  }
}

/** Flush a zone that was queued while BLE was disconnected or board still syncing. */
export function flushPendingZoneIfConnected(reason: string) {
  if (!pendingZone || !canApplyZoneNow()) return;
  const s = useAppStore.getState();
  if (isShowProtectingZones(s.activeZoneIds)) return;
  const zone = pendingZone;
  pendingZone = null;
  currentZoneId = zone.id;
  zoneLog('flushing pending zone', { zone: zone.name, reason });
  applyZoneEntry(zone, true, reason);
}

export function flushPendingZoneOnBleReady() {
  flushPendingZoneIfConnected('ble-ready');
}

export function reapplyCurrentZoneOnConnect() {
  const s = useAppStore.getState();
  if (!s.zonesEnabled) return;
  if (isShowProtectingZones(s.activeZoneIds)) return;
  const zone = s.zones.find(z => z.id === currentZoneId);
  if (!zone?.presetId) return;
  if (!canApplyZoneNow()) {
    pendingZone = zone;
    return;
  }
  applyZoneEntry(zone, false, 'reconnect');
}

/**
 * Force re-send the currently active zone's preset, bypassing the reapply throttle.
 * Needed after any raw board write that can stomp live segments outside the zone
 * apply path (e.g. MB layout / segment geometry push during background board sync).
 */
export function reapplyCurrentZoneForced(reason: string) {
  const s = useAppStore.getState();
  if (!s.zonesEnabled) return;
  if (isShowProtectingZones(s.activeZoneIds)) return;
  const zone = s.zones.find(z => z.id === currentZoneId);
  if (!zone?.presetId) return;
  if (!canApplyZoneNow()) {
    pendingZone = zone;
    return;
  }
  zoneLog('restoring zone after board write', { zone: zone.name, reason });
  applyZoneEntry(zone, true, reason);
}

export function processLocationUpdate(pt: LatLng, opts?: { background?: boolean }) {
  const s = useAppStore.getState();
  const { zones, indoorZones, parks, brightnessConfig, zonesEnabled } = s;
  const src = opts?.background ? 'bg' : 'fg';

  s.setUserLocation(pt);
  const resolvedPark = resolveActivePark(pt, parks, zones, indoorZones);
  if (resolvedPark?.id !== s.activePark?.id) {
    zoneLog(`park → ${resolvedPark?.name ?? 'none'}`, { src });
    s.setActivePark(resolvedPark);
  }

  const activeIds = zonesContainingPoint(pt, zones).map(z => z.id);
  s.setActiveZoneIds(activeIds);

  const activeIdsKey = activeIds.join(',');
  const lastKey = lastLoggedActiveIds.join(',');
  if (activeIdsKey !== lastKey) {
    const names = activeIds.map(id => zones.find(z => z.id === id)?.name ?? id);
    zoneLog(`active zones [${src}]`, { zones: names });
    lastLoggedActiveIds = activeIds;
  }

  const nowIndoor = findContainingIndoorZone(pt, indoorZones) !== null;
  const outdoorBrightness = sunBasedBrightness(pt.latitude, pt.longitude, brightnessConfig);

  const sendBrightnessIfChanged = (value: number) => {
    if (lastBrightness === value) return;
    lastBrightness = value;
    if (bleService.isConnected()) bleService.sendBrightness(value);
  };

  if (nowIndoor !== isIndoor) {
    isIndoor = nowIndoor;
    if (brightnessTimer) clearTimeout(brightnessTimer);
    const target = nowIndoor ? brightnessConfig.indoor : outdoorBrightness;
    brightnessTimer = setTimeout(() => sendBrightnessIfChanged(target), nowIndoor ? 0 : BRIGHTNESS_RAMP_MS);
  } else if (!nowIndoor) {
    sendBrightnessIfChanged(outdoorBrightness);
  }

  const protectShow = isShowProtectingZones(activeIds);

  if (protectShow) {
    if (!zoneTriggersSuppressed) {
      zoneLog('triggers suppressed — show active in scope', { src });
    }
    zoneTriggersSuppressed = true;
    return;
  }

  const exitingShowProtection = zoneTriggersSuppressed;
  zoneTriggersSuppressed = false;

  runZoneTriggerLogic(pt, zones, zonesEnabled, exitingShowProtection, src);
  flushPendingZoneIfConnected('gps-tick');

  void saveLocationRuntime({
    userLocation: pt,
    activeZoneIds: activeIds,
    activePark: resolvedPark ?? s.activePark,
    updatedAt: Date.now(),
  });
  void saveZoneRuntime({
    currentZoneId,
    lastZoneApply,
    isIndoor,
    lastBrightness,
    zoneTriggersSuppressed,
  });
}

/** Pull latest GPS snapshot written by the headless background task into the live store. */
export async function syncRuntimeLocationFromBridge(): Promise<boolean> {
  const { loadLocationRuntime } = await import('./locationRuntimeBridge');
  const snap = await loadLocationRuntime();
  if (!snap) return false;
  const s = useAppStore.getState();
  const parkChanged = snap.activePark?.id !== s.activePark?.id;
  const locChanged =
    s.userLocation?.latitude !== snap.userLocation.latitude ||
    s.userLocation?.longitude !== snap.userLocation.longitude;
  const zonesChanged = snap.activeZoneIds.join(',') !== s.activeZoneIds.join(',');
  if (!parkChanged && !locChanged && !zonesChanged) return false;
  s.setUserLocation(snap.userLocation);
  s.setActiveZoneIds(snap.activeZoneIds);
  s.setActivePark(snap.activePark);
  const zoneRuntime = await loadZoneRuntime();
  if (zoneRuntime) {
    currentZoneId = zoneRuntime.currentZoneId;
    lastZoneApply = zoneRuntime.lastZoneApply;
    isIndoor = zoneRuntime.isIndoor;
    lastBrightness = zoneRuntime.lastBrightness;
    zoneTriggersSuppressed = zoneRuntime.zoneTriggersSuppressed;
  }
  return true;
}

/** Re-apply solar/indoor brightness from current GPS (e.g. after show live dimming). */
export function applyAmbientBrightnessNow(): void {
  const s = useAppStore.getState();
  const pt = s.userLocation;
  if (!pt) return;
  const { indoorZones, brightnessConfig } = s;
  const nowIndoor = findContainingIndoorZone(pt, indoorZones) !== null;
  const target = nowIndoor
    ? brightnessConfig.indoor
    : sunBasedBrightness(pt.latitude, pt.longitude, brightnessConfig);
  if (brightnessTimer) {
    clearTimeout(brightnessTimer);
    brightnessTimer = null;
  }
  isIndoor = nowIndoor;
  lastBrightness = target;
  if (bleService.isConnected()) bleService.sendBrightness(target);
}

export function resetZoneLocationRuntime() {
  currentZoneId = null;
  pendingZone = null;
  lastZoneApply = null;
  zoneTriggersSuppressed = false;
  lastLoggedActiveIds = [];
}

onBoardSyncStatus((status) => {
  if (pendingZone && canApplyZoneNow()) {
    flushPendingZoneIfConnected('board-sync-idle');
  }
});
