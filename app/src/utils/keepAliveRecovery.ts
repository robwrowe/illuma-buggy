/**
 * Restart the location foreground service after a background wake, or ask the
 * user to open the app when Android will not allow a background FGS start.
 */

import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { bleService } from '../services/BLEService';
import { dismissResumeNotification, notifyTapToResume } from '../services/strollerNotification';
import {
  ensureLocationTaskRunning,
  isLocationTaskRunning,
} from './locationTracking';
import { acquireRadioLocks } from './keepAliveNative';
import { shouldKeepProcessAlive } from './keepAlivePolicy';

const FGS_WANTED_KEY = 'illuma-fgs-wanted';
const BATTERY_PROMPT_KEY = 'illuma-battery-opt-prompted';
const RESUME_NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;

let lastResumeNotifyAt = 0;

export async function setFgsWanted(wanted: boolean): Promise<void> {
  await AsyncStorage.setItem(FGS_WANTED_KEY, wanted ? '1' : '0');
}

export async function getFgsWanted(): Promise<boolean> {
  return (await AsyncStorage.getItem(FGS_WANTED_KEY)) === '1';
}

export async function maybePromptBatteryExemption(): Promise<void> {
  if (AppState.currentState !== 'active') return;
  const { isIgnoringBatteryOptimizations, isNativeKeepAliveAvailable, requestIgnoreBatteryOptimizations } =
    await import('./keepAliveNative');
  if (!isNativeKeepAliveAvailable()) return;
  if (isIgnoringBatteryOptimizations()) return;
  const prompted = await AsyncStorage.getItem(BATTERY_PROMPT_KEY);
  if (prompted) return;
  await AsyncStorage.setItem(BATTERY_PROMPT_KEY, String(Date.now()));
  requestIgnoreBatteryOptimizations();
}

/**
 * Called from a background wake (BLE restore, background entry). Android 12+
 * will refuse to start a foreground service unless the activity is resumed.
 */
export async function onBackgroundWake(reason: string): Promise<void> {
  const wanted = await getFgsWanted();
  const needed = wanted || shouldKeepProcessAlive(bleService.isConnected());
  if (!needed) return;

  if (await isLocationTaskRunning()) {
    acquireRadioLocks();
    await dismissResumeNotification();
    return;
  }

  const started = await ensureLocationTaskRunning(`wake:${reason}`);
  if (started) {
    acquireRadioLocks();
    await dismissResumeNotification();
    return;
  }

  const now = Date.now();
  if (now - lastResumeNotifyAt < RESUME_NOTIFY_COOLDOWN_MS) return;
  lastResumeNotifyAt = now;
  console.warn('[Location] FGS wanted but cannot start while backgrounded', reason);
  await notifyTapToResume();
}
