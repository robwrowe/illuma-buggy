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

    const refreshLocationNow = async () => {
      if (!permissionGranted) return;
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        processLocationUpdate({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
      } catch (e) {
        console.warn('[Zone] getCurrentPosition failed:', e);
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
      await refreshLocationNow();
      watchSub = await Location.watchPositionAsync(
        watchOptions(zonesEnabledRef.current),
        (loc) => processLocationUpdate({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        }),
      );
    };

    const startBackgroundTracking = async () => {
      if (!zonesEnabledRef.current) return;
      if (!permissionGranted) return;
      if (!backgroundGranted) {
        const { status } = await Location.requestBackgroundPermissionsAsync();
        backgroundGranted = status === 'granted';
        if (!backgroundGranted) {
          console.warn('[Zone] Background location denied — zones update only in foreground');
          return;
        }
      }
      const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (started) return;
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 15000,
        distanceInterval: 12,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Illuma Buggy',
          notificationBody: 'Tracking location for zone presets',
        },
      });
    };

    const stopBackgroundTracking = async () => {
      const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (started) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    };

    const syncWatchMode = async () => {
      if (!zonesEnabledRef.current) {
        stopForegroundWatch();
        await stopBackgroundTracking();
        await dismissStrollerNotification();
        return;
      }
      if (appState === 'active') {
        await stopBackgroundTracking();
        await startForegroundWatch();
      } else {
        stopForegroundWatch();
        await startBackgroundTracking();
      }
    };

    void syncWatchMode();

    const sessionSub = bleService.onSessionReady(async () => {
      await refreshLocationNow();
      flushPendingZoneOnBleReady();
      reapplyCurrentZoneOnConnect();
    });

    const appStateSub = AppState.addEventListener('change', (next) => {
      appState = next;
      void syncWatchMode();
      if (next === 'active') void refreshLocationNow();
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
