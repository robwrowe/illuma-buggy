import { AppState } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import type * as Location from 'expo-location';
import { BACKGROUND_LOCATION_TASK } from './locationTaskName';

export { BACKGROUND_LOCATION_TASK };

let storeHydrated = false;

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[LocationTask] error:', error.message);
    return;
  }
  // The foreground GPS watcher (useZoneManager) already drives zone logic while the app
  // is in the foreground — this FGS task keeps delivering updates the whole time too.
  // Use persisted app visibility instead of AppState.currentState, because task callbacks
  // can execute in a separate JS context where AppState can be stale.
  const bridge =
    require('../utils/locationRuntimeBridge') as typeof import('../utils/locationRuntimeBridge');
  let appVisibility: 'active' | 'background' | 'inactive' | 'unknown' =
    (AppState.currentState as 'active' | 'background' | 'inactive') ?? 'unknown';
  if (typeof bridge.getAppVisibility === 'function') {
    const visibility = await bridge.getAppVisibility();
    appVisibility = visibility.state;
  }
  if (appVisibility === 'active') return;

  const locations = (data as { locations?: Location.LocationObject[] })?.locations;
  const loc = locations?.[0];
  if (!loc) return;
  console.log(
    '[LocationTask] tick',
    loc.coords.latitude.toFixed(5),
    loc.coords.longitude.toFixed(5),
  );

  const { useAppStore } = require('../stores/store') as typeof import('../stores/store');
  if (!storeHydrated) {
    await useAppStore.getState().loadFromStorage();
    storeHydrated = true;
  }

  const { bleService } = require('../services/BLEService') as typeof import('../services/BLEService');
  // If this callback is running in a fresh headless JS instance (app process was killed
  // and Android woke it just for this task), bleService starts with no connection —
  // give it a chance to reconnect before the zone logic below queues the apply.
  if (bleService.getConnectionState() === 'disconnected') {
    void bleService.connect().catch((e) => console.warn('[LocationTask] reconnect failed:', e));
  }

  const { processLocationUpdate } =
    require('../utils/zoneLocationCore') as typeof import('../utils/zoneLocationCore');
  try {
    processLocationUpdate(
      { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
      { background: true },
    );
  } catch (e: unknown) {
    console.warn('[LocationTask] handler failed:', e);
  }
});
