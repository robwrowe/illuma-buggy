/**
 * Shared GPS → zones / brightness / BLE zone trigger logic (foreground + background task).
 */

import { useAppStore, type Zone, type LatLng } from '../stores/store';
import { findTriggerZone, findContainingIndoorZone, sunBasedBrightness, zonesContainingPoint } from './utils';
import { resolveActivePark } from './resolveActivePark';
import { bleService } from '../services/BLEService';
import { applyZonePreset } from './bleBoardSync';
import { updateStrollerNotification } from '../services/strollerNotification';
import { shouldProtectShowFromZones } from './showZoneGuard';

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

function applyZoneEntry(zone: Zone, force: boolean, reason: string) {
  if (!zone.presetId) return;
  if (!shouldApplyZone(zone, force)) {
    zoneLog(`skip re-apply "${zone.name}" (throttled)`, { presetId: zone.presetId, reason });
    return;
  }
  lastZoneApply = { zoneId: zone.id, at: Date.now() };

  const run = async () => {
    if (!bleService.isSessionReady()) {
      zoneLog(`apply deferred — session not ready`, { zone: zone.name, presetId: zone.presetId });
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
    });
    const ok = await applyZonePreset(preset, s.recallState, s.customSegmentLayouts);
    zoneLog(ok ? 'apply OK' : 'apply FAILED', { presetId: preset.id, zone: zone.name });
  };
  void run();
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
    if (!bleService.isSessionReady()) {
      pendingZone = triggerZone;
      zoneLog('queued pending zone apply', { zone: triggerZone.name });
      return;
    }
    applyZoneEntry(triggerZone, true, reason);
  } else if (prevId) {
    pendingZone = null;
    lastZoneApply = null;
    const left = zones.find(z => z.id === prevId);
    if (left?.presetId && bleService.isSessionReady()) {
      zoneLog('override_clear after zone exit');
      bleService.sendOverrideClear();
    }
  }
}

export function flushPendingZoneOnBleReady() {
  if (!pendingZone || !bleService.isSessionReady()) return;
  const s = useAppStore.getState();
  if (isShowProtectingZones(s.activeZoneIds)) return;
  const zone = pendingZone;
  pendingZone = null;
  currentZoneId = zone.id;
  zoneLog('flushing pending zone on BLE ready', { zone: zone.name });
  applyZoneEntry(zone, true, 'ble-ready');
}

export function reapplyCurrentZoneOnConnect() {
  const s = useAppStore.getState();
  if (!s.zonesEnabled) return;
  if (isShowProtectingZones(s.activeZoneIds)) return;
  const zone = s.zones.find(z => z.id === currentZoneId);
  if (!zone?.presetId) return;
  if (!bleService.isSessionReady()) {
    pendingZone = zone;
    return;
  }
  applyZoneEntry(zone, false, 'reconnect');
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
    if (bleService.isSessionReady()) bleService.sendBrightness(value);
  };

  if (nowIndoor !== isIndoor) {
    isIndoor = nowIndoor;
    if (brightnessTimer) clearTimeout(brightnessTimer);
    const target = nowIndoor ? brightnessConfig.indoor : outdoorBrightness;
    brightnessTimer = setTimeout(() => sendBrightnessIfChanged(target), nowIndoor ? 0 : BRIGHTNESS_RAMP_MS);
  } else if (!nowIndoor) {
    sendBrightnessIfChanged(outdoorBrightness);
  }

  const fireZone = findTriggerZone(pt, zones);
  const firePreset = fireZone?.presetId ? s.presets.find(p => p.id === fireZone.presetId) : undefined;
  void updateStrollerNotification({
    zoneName: fireZone?.name ?? (activeIds.length ? zones.find(z => activeIds.includes(z.id))?.name : null),
    bleConnected: bleService.isConnected(),
    bleReady: bleService.isSessionReady(),
    presetName: firePreset?.name ?? null,
    background: opts?.background,
  });

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
}

export function resetZoneLocationRuntime() {
  currentZoneId = null;
  pendingZone = null;
  lastZoneApply = null;
  zoneTriggersSuppressed = false;
  lastLoggedActiveIds = [];
}
