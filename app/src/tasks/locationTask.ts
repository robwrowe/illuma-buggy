import * as TaskManager from 'expo-task-manager';
import type * as Location from 'expo-location';
import { BACKGROUND_LOCATION_TASK } from './locationTaskName';

export { BACKGROUND_LOCATION_TASK };

let storeHydrated = false;
let lastProcessedAt = 0;
const MIN_PROCESS_INTERVAL_MS = 1000;
const FOREGROUND_VISIBILITY_MAX_AGE_MS = 12_000;

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  try {
    if (error) {
      console.warn('[LocationTask] error:', error.message);
      return;
    }
    // Foreground watchPositionAsync already drives zone logic while the app is open.
    // Use the persisted visibility snapshot (written by useZoneManager on AppState change)
    // instead of AppState.currentState — task callbacks can run in contexts where
    // AppState is stale, and the previous AppState gate blocked all background ticks.
    const bridge =
      require('../utils/locationRuntimeBridge') as typeof import('../utils/locationRuntimeBridge');
    if (typeof bridge.getAppVisibility !== 'function') return;
    const vis = await bridge.getAppVisibility();
    if (
      vis.state === 'active' &&
      Date.now() - vis.updatedAt < FOREGROUND_VISIBILITY_MAX_AGE_MS
    ) {
      return;
    }

    const now = Date.now();
    if (now - lastProcessedAt < MIN_PROCESS_INTERVAL_MS) return;
    lastProcessedAt = now;

    const locations = (data as { locations?: Location.LocationObject[] })?.locations;
    const eventLoc = locations?.[0];
    if (!eventLoc) return;

    let loc = eventLoc;
    try {
      const LocationMod = require('expo-location') as typeof import('expo-location');
      const liveLoc = await LocationMod.getCurrentPositionAsync({
        accuracy: LocationMod.Accuracy.High,
        mayShowUserSettingsDialog: false,
      });
      if (liveLoc?.coords) {
        loc = liveLoc;
      }
    } catch {
      // Keep using task event coordinates when direct probe is unavailable.
    }

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
    if (bleService.getConnectionState() === 'disconnected') {
      void bleService.connect().catch((e) => console.warn('[LocationTask] reconnect failed:', e));
    }

    const { processLocationUpdate } =
      require('../utils/zoneLocationCore') as typeof import('../utils/zoneLocationCore');
    processLocationUpdate(
      { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
      { background: true },
    );
  } catch (e: unknown) {
    console.warn('[LocationTask] handler failed:', e);
  }
});
