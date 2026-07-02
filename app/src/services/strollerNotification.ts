/**
 * Ongoing Android notification with Fire zone + FTB quick actions.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useAppStore } from '../stores/store';

const NOTIFICATION_ID = 'illuma-stroller-controls';
const CHANNEL_ID = 'stroller-controls';
let initialized = false;

export async function initStrollerNotifications(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Stroller controls',
      importance: Notifications.AndroidImportance.LOW,
      vibrationPattern: [],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  await Notifications.setNotificationCategoryAsync('stroller_controls', [
    { identifier: 'FIRE_ZONE', buttonTitle: 'Fire zone', options: { opensAppToForeground: false } },
    { identifier: 'FTB', buttonTitle: 'FTB', options: { opensAppToForeground: false } },
  ]);
}

export async function updateStrollerNotification(opts: {
  zoneName?: string | null;
  bleConnected: boolean;
  bleReady: boolean;
  presetName?: string | null;
  background?: boolean;
}): Promise<void> {
  const s = useAppStore.getState();
  if (!s.zonesEnabled) {
    await dismissStrollerNotification();
    return;
  }

  await initStrollerNotifications();

  const parts: string[] = [];
  if (opts.zoneName) parts.push(opts.zoneName);
  if (opts.presetName) parts.push(opts.presetName);
  if (!opts.bleConnected) parts.push('BLE disconnected');
  else if (!opts.bleReady) parts.push('Board syncing');
  else parts.push('BLE ready');

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_ID,
    content: {
      title: 'Illuma Buggy',
      body: parts.join(' · ') || 'Watching location for zones',
      categoryIdentifier: 'stroller_controls',
      sticky: true,
      priority: Notifications.AndroidNotificationPriority.LOW,
      data: { type: 'stroller_controls' },
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: null,
  });
}

export async function dismissStrollerNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(NOTIFICATION_ID);
  } catch {
    // not shown
  }
}
