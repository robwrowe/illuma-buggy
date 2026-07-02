/**
 * Shared GPS → zones / brightness / BLE zone trigger logic (foreground + background task).
 */

import { useAppStore, type Zone, type LatLng } from '../stores/store';
import { findContainingZone, findContainingIndoorZone, pointInPolygon, sunBasedBrightness } from './utils';
import { resolveActivePark } from './resolveActivePark';
import { bleService } from '../services/BLEService';
import { triggerZonePreset } from './bleBoardSync';
import { updateStrollerNotification } from '../services/strollerNotification';

const ZONE_REAPPLY_MS = 45_000;
const BRIGHTNESS_RAMP_MS = 2000;

let currentZoneId: string | null = null;
let pendingZone: Zone | null = null;
let lastZoneApply: { zoneId: string; at: number } | null = null;
let isIndoor = false;
let lastBrightness: number | null = null;
let brightnessTimer: ReturnType<typeof setTimeout> | null = null;

function shouldApplyZone(zone: Zone, force: boolean): boolean {
  if (force) return true;
  if (!lastZoneApply || lastZoneApply.zoneId !== zone.id) return true;
  return Date.now() - lastZoneApply.at >= ZONE_REAPPLY_MS;
}

function applyZoneEntry(zone: Zone, force: boolean) {
  if (!zone.presetId) return;
  if (!shouldApplyZone(zone, force)) return;
  lastZoneApply = { zoneId: zone.id, at: Date.now() };
  const s = useAppStore.getState();
  const preset = s.presets.find(p => p.id === zone.presetId);
  if (preset) {
    void triggerZonePreset(preset, s.recallState, s.customSegmentLayouts);
  } else {
    bleService.sendZoneTrigger(zone.presetId);
  }
}

export function flushPendingZoneOnBleReady() {
  if (!pendingZone || !bleService.isSessionReady()) return;
  const zone = pendingZone;
  pendingZone = null;
  currentZoneId = zone.id;
  applyZoneEntry(zone, true);
}

export function reapplyCurrentZoneOnConnect() {
  const s = useAppStore.getState();
  if (!s.zonesEnabled) return;
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

  const activeIds = zones.filter(z => z.enabled && pointInPolygon(pt, z.polygon)).map(z => z.id);
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

  const fireZone = zones.find(z => activeIds.includes(z.id) && z.presetId);
  const firePreset = fireZone ? s.presets.find(p => p.id === fireZone.presetId) : undefined;
  void updateStrollerNotification({
    zoneName: fireZone?.name ?? (activeIds.length ? zones.find(z => activeIds.includes(z.id))?.name : null),
    bleConnected: bleService.isConnected(),
    bleReady: bleService.isSessionReady(),
    presetName: firePreset?.name ?? null,
    background: opts?.background,
  });

  if (!zonesEnabled) return;

  const matchedZone = findContainingZone(pt, zones);
  const prevId = currentZoneId;
  if (matchedZone?.id === prevId) return;

  currentZoneId = matchedZone?.id ?? null;
  if (matchedZone) {
    if (!bleService.isSessionReady()) {
      pendingZone = matchedZone;
      return;
    }
    applyZoneEntry(matchedZone, true);
  } else if (prevId) {
    pendingZone = null;
    lastZoneApply = null;
    if (bleService.isSessionReady()) {
      const left = zones.find(z => z.id === prevId);
      if (left?.presetId) bleService.sendOverrideClear();
    }
  }
}

export function resetZoneLocationRuntime() {
  currentZoneId = null;
  pendingZone = null;
  lastZoneApply = null;
}
