import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { BACKGROUND_LOCATION_TASK } from '../tasks/locationTaskName';
import {
  useAppStore,
  DEFAULT_LOCATION_POLL_SEC,
  LOCATION_POLL_SEC_MIN,
  LOCATION_POLL_SEC_MAX,
} from '../stores/store';

export function getLocationPollMs(): number {
  const sec = useAppStore.getState().locationPollSec ?? DEFAULT_LOCATION_POLL_SEC;
  const clamped = Math.min(LOCATION_POLL_SEC_MAX, Math.max(LOCATION_POLL_SEC_MIN, sec));
  return clamped * 1000;
}

function locationTaskOptions(): Location.LocationTaskOptions {
  const pollMs = getLocationPollMs();
  const maxInterval = __DEV__ ? 3_000 : 15_000;
  return {
    accuracy: Location.Accuracy.High,
    timeInterval: Math.min(pollMs, maxInterval),
    distanceInterval: 0,
    deferredUpdatesInterval: 0,
    deferredUpdatesDistance: 0,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'Illuma Buggy',
      notificationBody: 'Tracking location for zone presets',
    },
  };
}

function assertTaskDefined(): void {
  if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
    throw new Error(
      `Location task "${BACKGROUND_LOCATION_TASK}" not defined — ensure index.js imports ./src/tasks/locationTask`,
    );
  }
}

/** True when expo-location background updates are active (FGS may already be running). */
export async function isLocationTaskRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch {
    return false;
  }
}

async function safeStopLocationTask(): Promise<void> {
  try {
    if (!(await isLocationTaskRunning())) return;
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('[Location] stop skipped:', msg);
  }
}

/**
 * Start FGS location updates if not already running.
 * Never stop an active task — Android 12+ cannot restart FGS from the background.
 */
export async function ensureLocationTaskRunning(reason: string): Promise<boolean> {
  assertTaskDefined();
  if (await isLocationTaskRunning()) {
    console.log('[Location] FGS already active', reason);
    return true;
  }
  if (AppState.currentState !== 'active') {
    console.warn(
      '[Location] FGS not running and cannot start while backgrounded — open app briefly',
      reason,
    );
    return false;
  }
  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, locationTaskOptions());
  console.log('[Location] FGS started', reason);
  return true;
}

/** Stop + start — only while foreground (e.g. poll interval changed). */
export async function restartLocationTask(): Promise<boolean> {
  assertTaskDefined();
  if (AppState.currentState !== 'active') {
    console.warn('[Location] FGS restart skipped — app not foreground');
    return isLocationTaskRunning();
  }
  await safeStopLocationTask();
  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, locationTaskOptions());
  console.log('[Location] FGS restarted (foreground)');
  return true;
}

export async function stopLocationTask(): Promise<void> {
  await safeStopLocationTask();
}
