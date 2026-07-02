import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { useAppStore } from '../stores/store';
import { bleService } from '../services/BLEService';
import {
  processLocationUpdate,
  flushPendingZoneOnBleReady,
  flushPendingZoneIfConnected,
  reapplyCurrentZoneOnConnect,
} from '../utils/zoneLocationCore';
import {
  getLocationPollMs,
  ensureLocationTaskRunning,
  isLocationTaskRunning,
  restartLocationTask,
  stopLocationTask,
} from '../utils/locationTracking';
import { dismissStrollerNotification } from '../services/strollerNotification';

export function useZoneManager() {
  const zonesEnabledRef = useRef(useAppStore.getState().zonesEnabled);

  useEffect(() => {
    return useAppStore.subscribe((state) => {
      zonesEnabledRef.current = state.zonesEnabled;
    });
  }, []);

  useEffect(() => {
    let appState: AppStateStatus = AppState.currentState;
    let backgroundGranted = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let positionSub: Location.LocationSubscription | null = null;
    let watchStarting = false;
    let trackingGeneration = 0;
    let appStateGeneration = 0;
    let fgsStartPending = false;

    const isFgsManifestError = (e: unknown): boolean => {
      const msg = e instanceof Error ? e.message : String(e);
      return msg.includes('manifest') || msg.includes('Foreground service permissions');
    };

    const isFgsStartBlocked = (e: unknown): boolean => {
      const msg = e instanceof Error ? e.message : String(e);
      return (
        msg.includes('in the background') ||
        msg.includes('ForegroundServiceStartNotAllowed') ||
        msg.includes('mAllowStartForeground')
      );
    };

    const stopPoll = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const stopForegroundWatch = () => {
      positionSub?.remove();
      positionSub = null;
    };

    const hasForegroundPermission = async (): Promise<boolean> => {
      const fg = await Location.getForegroundPermissionsAsync();
      return fg.status === 'granted';
    };

    const ensureForegroundPermission = async (): Promise<boolean> => {
      if (await hasForegroundPermission()) return true;
      if (AppState.currentState !== 'active') {
        console.log('[Location] foreground permission deferred — app not active');
        return false;
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.warn('[Location] foreground permission denied');
      }
      return status === 'granted';
    };

    const refreshBackgroundPermission = async (): Promise<boolean> => {
      const cur = await Location.getBackgroundPermissionsAsync();
      if (cur.status === 'granted') {
        backgroundGranted = true;
        return true;
      }
      if (AppState.currentState !== 'active') return false;
      const { status } = await Location.requestBackgroundPermissionsAsync();
      backgroundGranted = status === 'granted';
      console.log('[Location] background permission', status);
      return backgroundGranted;
    };

    const refreshLocationNow = async (reason: string) => {
      if (!(await hasForegroundPermission())) return;
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
          mayShowUserSettingsDialog: false,
        });
        console.log(
          '[Location] refresh',
          reason,
          loc.coords.latitude.toFixed(5),
          loc.coords.longitude.toFixed(5),
        );
        processLocationUpdate(
          { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
          { background: appState !== 'active' },
        );
      } catch (e) {
        console.warn('[Location] getCurrentPosition failed:', reason, e);
      }
    };

    const startPoll = () => {
      stopPoll();
      const pollMs = getLocationPollMs();
      pollTimer = setInterval(() => {
        void refreshLocationNow('poll');
      }, pollMs);
      console.log('[Location] poll started every', pollMs, 'ms');
    };

    const startForegroundWatch = async () => {
      if (positionSub || watchStarting || appState !== 'active') return;
      if (!(await hasForegroundPermission())) return;
      watchStarting = true;
      try {
        positionSub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 3000,
            distanceInterval: 1,
            mayShowUserSettingsDialog: false,
          },
          (loc) => {
            processLocationUpdate(
              { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
              { background: false },
            );
          },
        );
        console.log('[Location] foreground watch started');
      } catch (e) {
        console.warn('[Location] foreground watch failed:', e);
      } finally {
        watchStarting = false;
      }
    };

    const startBackgroundTask = async (reason: string) => {
      if (!backgroundGranted) return;
      if (AppState.currentState !== 'active') {
        fgsStartPending = true;
        console.log('[Location] FGS deferred until foreground', reason);
        return;
      }
      try {
        const wasRunning = await isLocationTaskRunning();
        if (wasRunning && !fgsStartPending) {
          return;
        }
        await ensureLocationTaskRunning();
        fgsStartPending = false;
        if (!wasRunning) {
          console.log('[Location] background task running', reason);
        }
      } catch (e) {
        if (isFgsManifestError(e)) {
          console.warn(
            '[Location] FGS unavailable — rebuild APK with FOREGROUND_SERVICE_LOCATION. Poll still runs while process is alive.',
          );
        } else if (isFgsStartBlocked(e)) {
          fgsStartPending = true;
          if (!(await isLocationTaskRunning())) {
            console.log('[Location] FGS start blocked by Android — will retry on next foreground', reason);
          }
        } else {
          console.warn('[Location] task start failed:', e);
        }
      }
    };

    const startTracking = async (reason: string) => {
      const gen = ++trackingGeneration;
      console.log('[Location] startTracking', reason, { zones: zonesEnabledRef.current });

      if (!(await ensureForegroundPermission())) {
        console.warn('[Location] startTracking paused — grant location while app is open');
        return;
      }
      if (gen !== trackingGeneration) return;

      startPoll();
      void refreshLocationNow(reason);
      if (appState === 'active') {
        void startForegroundWatch();
      }

      void refreshBackgroundPermission().then((bg) => {
        if (gen !== trackingGeneration) return;
        if (bg) void startBackgroundTask(reason);
      });
    };

    const stopTracking = async () => {
      trackingGeneration++;
      stopPoll();
      stopForegroundWatch();
      await stopLocationTask();
      await dismissStrollerNotification();
      fgsStartPending = false;
      console.log('[Location] tracking stopped');
    };

    const syncWatchMode = async (reason: string) => {
      if (!zonesEnabledRef.current) {
        console.log('[Location] zones disabled — not tracking');
        await stopTracking();
        return;
      }
      await startTracking(reason);
    };

    void syncWatchMode('init');

    const sessionSub = bleService.onSessionReady(async () => {
      console.log('[Zone] BLE session ready — refresh location + pending zone');
      await refreshLocationNow('ble-session-ready');
      flushPendingZoneOnBleReady();
      reapplyCurrentZoneOnConnect();
    });

    const connSub = bleService.onStateChange((state) => {
      if (state === 'connected') {
        flushPendingZoneIfConnected('ble-connected');
      }
    });

    const appStateSub = AppState.addEventListener('change', (next) => {
      const prev = appState;
      appState = next;
      const gen = ++appStateGeneration;
      console.log('[Location] appState', prev, '→', next);
      if (!zonesEnabledRef.current) return;

      if (next === 'active') {
        void (async () => {
          if (gen !== appStateGeneration) return;
          if (!pollTimer) {
            await syncWatchMode('app-foreground-recover');
            return;
          }
          await ensureForegroundPermission();
          if (gen !== appStateGeneration) return;
          void startForegroundWatch();
          flushPendingZoneIfConnected('app-foreground');
          if (fgsStartPending && backgroundGranted) {
            void startBackgroundTask('fgs-pending');
          }
          await refreshLocationNow('app-foreground');
        })();
      } else if (prev === 'active') {
        stopForegroundWatch();
        void (async () => {
          if (gen !== appStateGeneration) return;
          if (!pollTimer) {
            await syncWatchMode('app-background-recover');
            return;
          }
          await refreshLocationNow('app-background');
        })();
      }
    });

    const storeSub = useAppStore.subscribe((state, prev) => {
      if (state.zonesEnabled !== prev.zonesEnabled) {
        void syncWatchMode('zones-toggle');
        return;
      }
      if (state.locationPollSec !== prev.locationPollSec && zonesEnabledRef.current) {
        startPoll();
        if (AppState.currentState === 'active' && backgroundGranted) {
          void restartLocationTask().catch((e) => console.warn('[Location] task restart failed:', e));
        }
      }
    });

    return () => {
      trackingGeneration++;
      appStateGeneration++;
      stopPoll();
      stopForegroundWatch();
      void stopLocationTask();
      sessionSub();
      connSub();
      appStateSub.remove();
      storeSub();
    };
  }, []);
}
