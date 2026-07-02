/**
 * Shared GPS → zones / brightness / BLE zone trigger logic (foreground + background task).
 */

import { useAppStore, type Zone, type LatLng } from '../stores/store';
import { findTriggerZone, findContainingIndoorZone, sunBasedBrightness, zonesContainingPoint } from './utils';
import { resolveActivePark } from './resolveActivePark';
import { bleService } from '../services/BLEService';
import { triggerZonePreset } from './bleBoardSync';
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

function applyZoneEntry(zone: Zone, force: boolean) {
  if (!zone.presetId) return;
  if (!shouldApplyZone(zone, force)) return;
  lastZoneApply = { zoneId: zone.id, at: Date.now() };

  const run = async () => {
    if (!bleService.isSessionReady()) return;
    const s = useAppStore.getState();
    const preset = s.presets.find(p => p.id === zone.presetId);
    await bleService.sendOverrideClear();
    await new Promise(r => setTimeout(r, 200));
    if (!bleService.isConnected()) return;
    if (preset) {
      const ok = await triggerZonePreset(preset, s.recallState, s.customSegmentLayouts);
      if (!ok && zone.presetId) {
        console.warn('[Zone] triggerZonePreset failed — retrying zone_trigger', zone.presetId);
        bleService.sendZoneTrigger(zone.presetId);
      }
    } else {
      bleService.sendZoneTrigger(zone.presetId);
    }
  };
  void run();
}

function runZoneTriggerLogic(pt: LatLng, zones: Zone[], zonesEnabled: boolean, forceReeval = false) {
  if (!zonesEnabled) return;

  const triggerZone = findTriggerZone(pt, zones);
  let prevId = currentZoneId;

  if (forceReeval) {
    prevId = null;
    currentZoneId = null;
    lastZoneApply = null;
  }

  if (triggerZone?.id === prevId) return;

  currentZoneId = triggerZone?.id ?? null;
  if (triggerZone?.presetId) {
    if (!bleService.isSessionReady()) {
      pendingZone = triggerZone;
      return;
    }
    applyZoneEntry(triggerZone, true);
  } else if (prevId) {
    pendingZone = null;
    lastZoneApply = null;
    if (bleService.isSessionReady()) {
      const left = zones.find(z => z.id === prevId);
      if (left?.presetId) bleService.sendOverrideClear();
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
  applyZoneEntry(zone, true);
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
  applyZoneEntry(zone, false);
}

export function processLocationUpdate(pt: LatLng, opts?: { background?: boolean }) {
  const s = useAppStore.getState();
  const { zones, indoorZones, parks, brightnessConfig, zonesEnabled } = s;

  s.setUserLocation(pt);
  const resolvedPark = resolveActivePark(pt, parks, zones, indoorZones);
  if (resolvedPark?.id !== s.activePark?.id) {
    s.setActivePark(resolvedPark);
  }

  const activeIds = zonesContainingPoint(pt, zones).map(z => z.id);
  s.setActiveZoneIds(activeIds);

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
    zoneTriggersSuppressed = true;
    return;
  }

  const exitingShowProtection = zoneTriggersSuppressed;
  zoneTriggersSuppressed = false;

  runZoneTriggerLogic(pt, zones, zonesEnabled, exitingShowProtection);
}

export function resetZoneLocationRuntime() {
  currentZoneId = null;
  pendingZone = null;
  lastZoneApply = null;
  zoneTriggersSuppressed = false;
}
