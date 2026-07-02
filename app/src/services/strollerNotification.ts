/**
 * Ongoing Android notification with Fire zone + FTB quick actions.
 * Shown only at a park (activePark set) with zones enabled — high priority channel.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useAppStore } from '../stores/store';

const NOTIFICATION_ID = 'illuma-stroller-controls';
/** New channel id — Android channel importance is immutable after first create. */
const CHANNEL_ID = 'stroller-controls-high';
let initialized = false;

export async function initStrollerNotifications(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Stroller controls (in park)',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: false,
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
  // Home / away from parks — no persistent notification clutter.
  if (!s.zonesEnabled || !s.activePark) {
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

  const title = s.activePark.name
    ? `Illuma Buggy · ${s.activePark.name}`
    : 'Illuma Buggy';

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_ID,
    content: {
      title,
      body: parts.join(' · ') || 'Watching location for zones',
      categoryIdentifier: 'stroller_controls',
      sticky: true,
      priority: Notifications.AndroidNotificationPriority.HIGH,
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
