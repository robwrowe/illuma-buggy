/**
 * AsyncStorage bridge for location + zone runtime across headless background tasks
 * and the main React Native JS context.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LatLng, ParkConfig } from '../stores/store';

const LOCATION_RUNTIME_KEY = 'illuma-location-runtime';
const ZONE_RUNTIME_KEY = 'illuma-zone-runtime';
const PENDING_BLE_KEY = 'illuma-pending-ble';
const BLE_LINK_KEY = 'illuma-ble-link';
const BLE_DEVICE_ID_KEY = 'illuma-ble-device-id';
const APP_VISIBILITY_KEY = 'illuma-app-visibility';

export type PendingBleAction =
  | { type: 'zone_preset'; presetId: string; at: number }
  | { type: 'brightness'; value: number; at: number }
  | { type: 'override_clear'; at: number };

export interface LocationRuntimeSnapshot {
  userLocation: LatLng;
  activeZoneIds: string[];
  activePark: ParkConfig | null;
  accuracyM?: number;
  updatedAt: number;
}

export interface CaptureGpsFix {
  latitude: number;
  longitude: number;
  accuracyM?: number;
  updatedAt: number;
}

export const STALE_FIX_MAX_AGE_MS = 5 * 60_000;

let lastLocationSnapshot: LocationRuntimeSnapshot | null = null;

export interface ZoneRuntimeSnapshot {
  currentZoneId: string | null;
  lastZoneApply: { zoneId: string; at: number } | null;
  isIndoor: boolean;
  lastBrightness: number | null;
  zoneTriggersSuppressed: boolean;
}

export interface BleLinkSnapshot {
  connected: boolean;
  ready: boolean;
  updatedAt: number;
}

export interface AppVisibilitySnapshot {
  state: 'active' | 'background' | 'inactive' | 'unknown';
  updatedAt: number;
}

export async function saveLocationRuntime(snapshot: LocationRuntimeSnapshot): Promise<void> {
  // Keep capture packet tagging synchronous while AsyncStorage mirrors the fix
  // for a future/headless JS context.
  lastLocationSnapshot = snapshot;
  await AsyncStorage.setItem(LOCATION_RUNTIME_KEY, JSON.stringify(snapshot));
}

export async function loadLocationRuntime(): Promise<LocationRuntimeSnapshot | null> {
  const raw = await AsyncStorage.getItem(LOCATION_RUNTIME_KEY);
  if (!raw) return null;
  try {
    const snapshot = JSON.parse(raw) as LocationRuntimeSnapshot;
    lastLocationSnapshot = snapshot;
    return snapshot;
  } catch {
    return null;
  }
}

/** Warm the synchronous capture-fix cache from the persisted background snapshot. */
export async function primeLocationRuntimeCache(): Promise<void> {
  await loadLocationRuntime();
}

/**
 * Returns a fresh fix for BLE packet tagging without making the scan callback
 * asynchronous. A live store coordinate is only used when the timestamped
 * runtime snapshot proves that the location pipeline is still updating.
 */
export function getBestAvailableFixSync(
  liveUserLocation: LatLng | null,
  now = Date.now(),
): CaptureGpsFix | null {
  const snapshot = lastLocationSnapshot;
  if (
    !snapshot
    || !Number.isFinite(snapshot.updatedAt)
    || now - snapshot.updatedAt < 0
    || now - snapshot.updatedAt >= STALE_FIX_MAX_AGE_MS
  ) {
    return null;
  }

  const point = liveUserLocation ?? snapshot.userLocation;
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    ...(snapshot.accuracyM != null && Number.isFinite(snapshot.accuracyM)
      ? { accuracyM: snapshot.accuracyM }
      : {}),
    updatedAt: snapshot.updatedAt,
  };
}

export async function saveZoneRuntime(snapshot: ZoneRuntimeSnapshot): Promise<void> {
  await AsyncStorage.setItem(ZONE_RUNTIME_KEY, JSON.stringify(snapshot));
}

export async function loadZoneRuntime(): Promise<ZoneRuntimeSnapshot | null> {
  const raw = await AsyncStorage.getItem(ZONE_RUNTIME_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ZoneRuntimeSnapshot;
  } catch {
    return null;
  }
}

export async function saveBleDeviceId(deviceId: string | null): Promise<void> {
  if (!deviceId) {
    await AsyncStorage.removeItem(BLE_DEVICE_ID_KEY);
    return;
  }
  await AsyncStorage.setItem(BLE_DEVICE_ID_KEY, deviceId);
}

export async function loadBleDeviceId(): Promise<string | null> {
  return AsyncStorage.getItem(BLE_DEVICE_ID_KEY);
}

export async function setBleLinkStatus(connected: boolean, ready: boolean): Promise<void> {
  const snap: BleLinkSnapshot = { connected, ready, updatedAt: Date.now() };
  await AsyncStorage.setItem(BLE_LINK_KEY, JSON.stringify(snap));
}

export async function getBleLinkStatus(): Promise<BleLinkSnapshot> {
  const raw = await AsyncStorage.getItem(BLE_LINK_KEY);
  if (!raw) return { connected: false, ready: false, updatedAt: 0 };
  try {
    return JSON.parse(raw) as BleLinkSnapshot;
  } catch {
    return { connected: false, ready: false, updatedAt: 0 };
  }
}


export async function setAppVisibility(state: 'active' | 'background' | 'inactive' | 'unknown'): Promise<void> {
  const snap: AppVisibilitySnapshot = { state, updatedAt: Date.now() };
  await AsyncStorage.setItem(APP_VISIBILITY_KEY, JSON.stringify(snap));
}

export async function getAppVisibility(): Promise<AppVisibilitySnapshot> {
  const raw = await AsyncStorage.getItem(APP_VISIBILITY_KEY);
  if (!raw) return { state: 'unknown', updatedAt: 0 };
  try {
    return JSON.parse(raw) as AppVisibilitySnapshot;
  } catch {
    return { state: 'unknown', updatedAt: 0 };
  }
}

export type PendingBleActionInput =
  | { type: 'zone_preset'; presetId: string }
  | { type: 'brightness'; value: number }
  | { type: 'override_clear' };

export async function enqueuePendingBle(action: PendingBleActionInput): Promise<void> {
  const raw = await AsyncStorage.getItem(PENDING_BLE_KEY);
  let queue: PendingBleAction[] = [];
  if (raw) {
    try {
      queue = JSON.parse(raw) as PendingBleAction[];
    } catch {
      queue = [];
    }
  }
  queue.push({ ...action, at: Date.now() } as PendingBleAction);
  // Keep queue bounded — latest zone preset wins over older duplicates.
  if (queue.length > 24) queue = queue.slice(-24);
  await AsyncStorage.setItem(PENDING_BLE_KEY, JSON.stringify(queue));
}

export async function drainPendingBle(): Promise<PendingBleAction[]> {
  const raw = await AsyncStorage.getItem(PENDING_BLE_KEY);
  await AsyncStorage.removeItem(PENDING_BLE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PendingBleAction[];
  } catch {
    return [];
  }
}

/** Apply a background snapshot to the live Zustand store (main JS context). */
export function applyLocationRuntimeToStore(
  snap: LocationRuntimeSnapshot,
  setState: (patch: {
    userLocation: LatLng;
    activeZoneIds: string[];
    activePark: ParkConfig | null;
  }) => void,
): void {
  setState({
    userLocation: snap.userLocation,
    activeZoneIds: snap.activeZoneIds,
    activePark: snap.activePark,
  });
}
