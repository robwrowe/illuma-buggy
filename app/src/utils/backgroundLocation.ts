/**
 * Headless-safe GPS → zones handler for expo-location background task.
 * BLE commands are queued only — main JS context drains via pendingBleDrain.
 */

import { useAppStore, type LatLng, type Zone } from '../stores/store';
import { findTriggerZone, findContainingIndoorZone, sunBasedBrightness, zonesContainingPoint } from './utils';
import { resolveActivePark } from './resolveActivePark';
import { shouldProtectShowFromZones } from './showZoneGuard';
import { updateStrollerNotification } from '../services/strollerNotification';
import {
  saveLocationRuntime,
  saveZoneRuntime,
  loadZoneRuntime,
  enqueuePendingBle,
  getBleLinkStatus,
  type ZoneRuntimeSnapshot,
} from './locationRuntimeBridge';

const ZONE_REAPPLY_MS = 45_000;

let storeHydrated = false;

async function ensureStoreHydrated(): Promise<void> {
  if (storeHydrated) return;
  await useAppStore.getState().loadFromStorage();
  storeHydrated = true;
}

function defaultZoneRuntime(): ZoneRuntimeSnapshot {
  return {
    currentZoneId: null,
    lastZoneApply: null,
    isIndoor: false,
    lastBrightness: null,
    zoneTriggersSuppressed: false,
  };
}

function shouldApplyZone(
  zone: Zone,
  runtime: ZoneRuntimeSnapshot,
  force: boolean,
): boolean {
  if (force) return true;
  if (!runtime.lastZoneApply || runtime.lastZoneApply.zoneId !== zone.id) return true;
  return Date.now() - runtime.lastZoneApply.at >= ZONE_REAPPLY_MS;
}

async function applyZoneEntryBg(
  zone: Zone,
  runtime: ZoneRuntimeSnapshot,
  force: boolean,
): Promise<ZoneRuntimeSnapshot> {
  if (!zone.presetId) return runtime;
  if (!shouldApplyZone(zone, runtime, force)) {
    console.log('[LocationTask] skip re-apply', zone.name);
    return runtime;
  }
  console.log('[LocationTask] zone ENTER →', zone.name, zone.presetId);
  await enqueuePendingBle({ type: 'zone_preset', presetId: zone.presetId });
  console.log('[Effect] QUEUED zone_preset', { zone: zone.name, presetId: zone.presetId, reason: 'bg-location' });
  return {
    ...runtime,
    currentZoneId: zone.id,
    lastZoneApply: { zoneId: zone.id, at: Date.now() },
  };
}

export async function handleBackgroundLocationTick(pt: LatLng): Promise<void> {
  await ensureStoreHydrated();
  const s = useAppStore.getState();
  if (!s.zonesEnabled) {
    console.log('[LocationTask] zones disabled — skip');
    return;
  }

  const { zones, indoorZones, parks, brightnessConfig } = s;
  let runtime = (await loadZoneRuntime()) ?? defaultZoneRuntime();

  const resolvedPark = resolveActivePark(pt, parks, zones, indoorZones);
  const activeIds = zonesContainingPoint(pt, zones).map(z => z.id);
  const activeNames = activeIds.map(id => zones.find(z => z.id === id)?.name ?? id);
  console.log('[LocationTask] active zones', activeNames);

  const nowIndoor = findContainingIndoorZone(pt, indoorZones) !== null;
  const outdoorBrightness = sunBasedBrightness(pt.latitude, pt.longitude, brightnessConfig);
  let targetBrightness: number | null = null;

  if (nowIndoor !== runtime.isIndoor) {
    runtime = { ...runtime, isIndoor: nowIndoor };
    targetBrightness = nowIndoor ? brightnessConfig.indoor : outdoorBrightness;
  } else if (!nowIndoor) {
    targetBrightness = outdoorBrightness;
  }

  if (targetBrightness != null && targetBrightness !== runtime.lastBrightness) {
    runtime = { ...runtime, lastBrightness: targetBrightness };
    await enqueuePendingBle({ type: 'brightness', value: targetBrightness });
    console.log('[Effect] QUEUED brightness', { value: targetBrightness, reason: 'bg-location' });
  }

  const fireZone = findTriggerZone(pt, zones);
  const firePreset = fireZone?.presetId
    ? s.presets.find(p => p.id === fireZone.presetId)
    : undefined;

  const protectShow = shouldProtectShowFromZones({
    activeParkId: resolvedPark?.id ?? s.activePark?.id,
    activeZoneIds: activeIds,
    showBindings: s.showBindings,
    deviceStatus: s.deviceStatus,
    showScheduleProtects: s.showProtectsZones,
  });

  if (!protectShow) {
    const triggerZone = findTriggerZone(pt, zones);
    const prevId = runtime.currentZoneId;

    if (triggerZone?.id !== prevId) {
      if (triggerZone?.presetId) {
        runtime = await applyZoneEntryBg(triggerZone, runtime, true);
      } else if (prevId) {
        console.log('[LocationTask] zone EXIT', prevId);
        runtime = {
          ...runtime,
          currentZoneId: null,
          lastZoneApply: null,
        };
        await enqueuePendingBle({ type: 'override_clear' });
        console.log('[Effect] QUEUED override_clear', { reason: 'bg-location' });
      } else {
        runtime = { ...runtime, currentZoneId: null };
      }
    }
    runtime = { ...runtime, zoneTriggersSuppressed: false };
  } else {
    console.log('[LocationTask] zone triggers suppressed — show active');
    runtime = { ...runtime, zoneTriggersSuppressed: true };
  }

  await saveZoneRuntime(runtime);
  s.setUserLocation(pt);
  s.setActiveZoneIds(activeIds);
  s.setActivePark(resolvedPark);
  await saveLocationRuntime({
    userLocation: pt,
    activeZoneIds: activeIds,
    activePark: resolvedPark,
    updatedAt: Date.now(),
  });

  const ble = await getBleLinkStatus();
  await updateStrollerNotification({
    zoneName: fireZone?.name ?? (activeIds.length ? activeNames[0] : null),
    bleConnected: ble.connected,
    bleReady: ble.ready,
    presetName: firePreset?.name ?? null,
    background: true,
  });
}
