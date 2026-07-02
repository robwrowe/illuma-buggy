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
  return {
    accuracy: Location.Accuracy.High,
    timeInterval: Math.min(pollMs, 15_000),
    distanceInterval: 1,
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
    // Native task may already be gone (TaskNotFoundException) — ignore.
    const msg = e instanceof Error ? e.message : String(e);
    console.log('[Location] stop skipped:', msg);
  }
}

/** Start background updates only if not already running — avoids stop/start churn on app resume. */
export async function ensureLocationTaskRunning(): Promise<boolean> {
  assertTaskDefined();
  if (await isLocationTaskRunning()) return true;
  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, locationTaskOptions());
  console.log('[Location] background task started');
  return true;
}

/** Stop + start — only when options change (poll interval). */
export async function restartLocationTask(): Promise<boolean> {
  assertTaskDefined();
  await safeStopLocationTask();
  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, locationTaskOptions());
  console.log('[Location] background task restarted');
  return true;
}

export async function stopLocationTask(): Promise<void> {
  await safeStopLocationTask();
}
