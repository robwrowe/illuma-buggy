import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { useAppStore } from '../stores/store';
import { bleService } from '../services/BLEService';
import {
  processLocationUpdate,
  flushPendingZoneOnBleReady,
  reapplyCurrentZoneOnConnect,
} from '../utils/zoneLocationCore';
import { BACKGROUND_LOCATION_TASK } from '../tasks/locationTask';
import { dismissStrollerNotification } from '../services/strollerNotification';

const GPS_ACTIVE_MS = 5000;
const GPS_ACTIVE_M = 8;
const GPS_IDLE_MS = 30000;
const GPS_IDLE_M = 25;

function watchOptions(zonesEnabled: boolean): Location.LocationOptions {
  return {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: zonesEnabled ? GPS_ACTIVE_MS : GPS_IDLE_MS,
    distanceInterval: zonesEnabled ? GPS_ACTIVE_M : GPS_IDLE_M,
  };
}

export function useZoneManager() {
  const zonesEnabledRef = useRef(useAppStore.getState().zonesEnabled);

  useEffect(() => {
    return useAppStore.subscribe((state) => {
      zonesEnabledRef.current = state.zonesEnabled;
    });
  }, []);

  useEffect(() => {
    let watchSub: Location.LocationSubscription | null = null;
    let appState: AppStateStatus = AppState.currentState;
    let permissionGranted = false;
    let backgroundGranted = false;
    let backgroundRunning = false;

    const refreshLocationNow = async (reason: string) => {
      if (!permissionGranted) return;
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        console.log('[Location] refresh', reason, loc.coords.latitude.toFixed(5), loc.coords.longitude.toFixed(5));
        processLocationUpdate({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
      } catch (e) {
        console.warn('[Location] getCurrentPosition failed:', reason, e);
      }
    };

    const stopForegroundWatch = () => {
      watchSub?.remove();
      watchSub = null;
    };

    const startForegroundWatch = async () => {
      if (appState !== 'active' || watchSub) return;
      if (!permissionGranted) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.warn('[Zone] Location permission denied');
          return;
        }
        permissionGranted = true;
      }
      await refreshLocationNow('foreground-start');
      watchSub = await Location.watchPositionAsync(
        watchOptions(zonesEnabledRef.current),
        (loc) => {
          processLocationUpdate({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
        },
      );
      console.log('[Location] foreground watch started');
    };

    const ensureBackgroundTracking = async () => {
      if (!zonesEnabledRef.current) return;
      if (!permissionGranted) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        permissionGranted = true;
      }
      if (!backgroundGranted) {
        const { status } = await Location.requestBackgroundPermissionsAsync();
        backgroundGranted = status === 'granted';
        if (!backgroundGranted) {
          console.warn('[Location] Background permission denied — foreground-only when app open');
          return;
        }
      }
      const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (started) {
        backgroundRunning = true;
        return;
      }
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 10000,
        distanceInterval: 10,
        showsBackgroundLocationIndicator: true,
        pausesUpdatesAutomatically: false,
        foregroundService: {
          notificationTitle: 'Illuma Buggy',
          notificationBody: 'Tracking location for zone presets',
        },
      });
      backgroundRunning = true;
      console.log('[Location] background task started');
    };

    const stopBackgroundTracking = async () => {
      const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (started) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        console.log('[Location] background task stopped');
      }
      backgroundRunning = false;
    };

    const syncWatchMode = async () => {
      if (!zonesEnabledRef.current) {
        stopForegroundWatch();
        await stopBackgroundTracking();
        await dismissStrollerNotification();
        return;
      }
      // Keep background updates running whenever zones are on (not only when app backgrounded).
      await ensureBackgroundTracking();
      if (appState === 'active') {
        await startForegroundWatch();
      } else {
        stopForegroundWatch();
      }
    };

    void syncWatchMode();

    const sessionSub = bleService.onSessionReady(async () => {
      console.log('[Zone] BLE session ready — refresh location + pending zone');
      await refreshLocationNow('ble-session-ready');
      flushPendingZoneOnBleReady();
      reapplyCurrentZoneOnConnect();
    });

    const appStateSub = AppState.addEventListener('change', (next) => {
      appState = next;
      console.log('[Location] appState →', next);
      void syncWatchMode();
      if (next === 'active') void refreshLocationNow('app-foreground');
    });

    const storeSub = useAppStore.subscribe((state, prev) => {
      if (state.zonesEnabled !== prev.zonesEnabled) {
        void syncWatchMode();
      }
    });

    return () => {
      stopForegroundWatch();
      void stopBackgroundTracking();
      sessionSub();
      appStateSub.remove();
      storeSub();
    };
  }, []);
}
