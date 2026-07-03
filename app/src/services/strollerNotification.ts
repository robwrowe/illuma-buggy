/**
 * Zone-effect notification (Fire zone + FTB actions).
 * Shown only when the trigger zone changes and an effect is sent/queued — not every GPS tick.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ZONE_EFFECT_NOTIFICATION_ID = 'illuma-zone-effect';
const BLE_DISCONNECT_NOTIFICATION_ID = 'illuma-ble-disconnected';
const CHANNEL_ID = 'stroller-controls-high';
const LAST_NOTIFIED_ZONE_KEY = 'illuma-last-notified-zone';
const BLE_DISCONNECT_DEBOUNCE_MS = 30_000;
let initialized = false;
let lastBleDisconnectAt = 0;

export async function initStrollerNotifications(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Stroller zone effects',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 120, 80, 120],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: false,
    });
  }

  await Notifications.setNotificationCategoryAsync('stroller_controls', [
    { identifier: 'FIRE_ZONE', buttonTitle: 'Fire zone', options: { opensAppToForeground: false } },
    { identifier: 'FTB', buttonTitle: 'FTB', options: { opensAppToForeground: false } },
  ]);
}

async function getLastNotifiedZoneId(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_NOTIFIED_ZONE_KEY);
}

async function setLastNotifiedZoneId(zoneId: string | null): Promise<void> {
  if (!zoneId) {
    await AsyncStorage.removeItem(LAST_NOTIFIED_ZONE_KEY);
    return;
  }
  await AsyncStorage.setItem(LAST_NOTIFIED_ZONE_KEY, zoneId);
}

/** Alert once per trigger-zone entry when a preset effect is sent or queued. */
export async function notifyZoneEffectApplied(opts: {
  triggerZoneId: string;
  zoneName: string;
  presetName?: string | null;
  sent: boolean;
  parkName?: string | null;
}): Promise<void> {
  const last = await getLastNotifiedZoneId();
  if (last === opts.triggerZoneId) return;
  await setLastNotifiedZoneId(opts.triggerZoneId);
  await initStrollerNotifications();

  const title = opts.parkName
    ? `Zone · ${opts.parkName}`
    : 'Illuma Buggy zone';
  const status = opts.sent ? 'Preset sent' : 'Preset queued';
  const body = [opts.zoneName, opts.presetName, status].filter(Boolean).join(' · ');

  await Notifications.scheduleNotificationAsync({
    identifier: ZONE_EFFECT_NOTIFICATION_ID,
    content: {
      title,
      body,
      categoryIdentifier: 'stroller_controls',
      sticky: false,
      priority: Notifications.AndroidNotificationPriority.HIGH,
      data: { type: 'zone_effect', zoneId: opts.triggerZoneId },
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: null,
  });
}

/** Clear zone-effect notification when leaving a trigger zone. */
export async function dismissZoneEffectNotification(): Promise<void> {
  await setLastNotifiedZoneId(null);
  try {
    await Notifications.dismissNotificationAsync(ZONE_EFFECT_NOTIFICATION_ID);
  } catch {
    // not shown
  }
}

/** @deprecated use notifyZoneEffectApplied / dismissZoneEffectNotification */
export async function updateStrollerNotification(_opts: {
  zoneName?: string | null;
  bleConnected: boolean;
  bleReady: boolean;
  presetName?: string | null;
  background?: boolean;
}): Promise<void> {
  // No-op — per-tick updates caused notification spam; FGS handles ongoing location.
}


export async function notifyBleDisconnected(): Promise<void> {
  const now = Date.now();
  if (now - lastBleDisconnectAt < BLE_DISCONNECT_DEBOUNCE_MS) return;
  lastBleDisconnectAt = now;
  await initStrollerNotifications();
  await Notifications.scheduleNotificationAsync({
    identifier: BLE_DISCONNECT_NOTIFICATION_ID,
    content: {
      title: 'Illuma Buggy disconnected',
      body: 'BLE link to the stroller dropped. Open app to reconnect.',
      sticky: false,
      priority: Notifications.AndroidNotificationPriority.HIGH,
      data: { type: 'ble_disconnected' },
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: null,
  });
}

export async function dismissBleDisconnectedNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(BLE_DISCONNECT_NOTIFICATION_ID);
  } catch {
    // not shown
  }
}

export async function dismissStrollerNotification(): Promise<void> {
  await dismissZoneEffectNotification();
  await dismissBleDisconnectedNotification();
}
