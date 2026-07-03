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
  syncRuntimeLocationFromBridge,
} from '../utils/zoneLocationCore';
import { drainPendingBleActions } from '../utils/pendingBleDrain';
import * as runtimeBridge from '../utils/locationRuntimeBridge';
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
    let drainTimer: ReturnType<typeof setInterval> | null = null;
    let positionSub: Location.LocationSubscription | null = null;
    let watchStarting = false;
    let trackingGeneration = 0;
    let appStateGeneration = 0;
    let fgsStartPending = false;

    const persistAppVisibility = (state: AppStateStatus | 'unknown') => {
      const setter = (runtimeBridge as any).setAppVisibility as
        | ((s: 'active' | 'background' | 'inactive' | 'unknown') => Promise<void>)
        | undefined;
      if (typeof setter === 'function') {
        void setter((state as 'active' | 'background' | 'inactive') ?? 'unknown');
      }
    };

    persistAppVisibility(appState);

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

    const stopDrainPoll = () => {
      if (drainTimer) {
        clearInterval(drainTimer);
        drainTimer = null;
      }
    };

    const startDrainPoll = () => {
      stopDrainPoll();
      drainTimer = setInterval(() => {
        void (async () => {
          // refreshLocationNow probes GPS + drains pending BLE; catches mock-GPS
          // changes between native FGS ticks while Illuma is backgrounded.
          if (appState !== 'active') {
            await refreshLocationNow('drain-poll');
          } else {
            await syncBackgroundSnapshot('drain-poll');
          }
        })();
      }, 5000);
      console.log('[Location] drain poll started every 5s');
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
      console.log('[Location] background permission status', cur.status);
      if (cur.status === 'granted') {
        backgroundGranted = true;
        return true;
      }
      if (AppState.currentState !== 'active') return false;
      const { status } = await Location.requestBackgroundPermissionsAsync();
      backgroundGranted = status === 'granted';
      console.log('[Location] background permission requested →', status);
      return backgroundGranted;
    };

    const tryLastKnownLocation = async (reason: string) => {
      if (!(await hasForegroundPermission())) return;
      try {
        const loc = await Location.getLastKnownPositionAsync({ maxAge: 15_000 });
        if (!loc) return;
        console.log(
          '[Location] lastKnown',
          reason,
          loc.coords.latitude.toFixed(5),
          loc.coords.longitude.toFixed(5),
        );
        processLocationUpdate(
          { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
          { background: appState !== 'active' },
        );
      } catch (e) {
        console.warn('[Location] lastKnown failed:', reason, e);
      }
    };

    const syncBackgroundSnapshot = async (reason: string) => {
      const updated = await syncRuntimeLocationFromBridge();
      if (updated) {
        console.log('[Location] synced background snapshot', reason);
      }
      if (appState !== 'active') {
        await tryLastKnownLocation(reason);
      }
      await drainPendingBleActions(reason);
    };

    const refreshLocationNow = async (reason: string) => {
      await syncBackgroundSnapshot(reason);
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
            distanceInterval: 0,
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
      if (!backgroundGranted) {
        console.log('[Location] FGS skipped — no background permission', reason);
        return;
      }
      if (AppState.currentState !== 'active') {
        fgsStartPending = true;
        console.log('[Location] FGS deferred until foreground', reason);
        return;
      }
      try {
        await ensureLocationTaskRunning(reason);
        fgsStartPending = false;
        const running = await isLocationTaskRunning();
        console.log('[Location] FGS state', { running, reason });
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

      backgroundGranted = await refreshBackgroundPermission();
      if (gen !== trackingGeneration) return;

      if (backgroundGranted) {
        await startBackgroundTask(reason);
      } else {
        console.warn(
          '[Location] background permission not granted — zone updates only work while app is open. Grant "Allow all the time" in Settings.',
        );
      }
      if (gen !== trackingGeneration) return;

      startPoll();
      void refreshLocationNow(reason);
      if (appState === 'active') {
        void startForegroundWatch();
      }
    };

    const stopTracking = async () => {
      trackingGeneration++;
      stopPoll();
      stopDrainPoll();
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
      void runtimeBridge.setBleLinkStatus(bleService.isConnected(), true);
      console.log('[Zone] BLE session ready — refresh location + pending zone');
      await refreshLocationNow('ble-session-ready');
      flushPendingZoneOnBleReady();
      reapplyCurrentZoneOnConnect();
      await drainPendingBleActions('ble-session-ready');
    });

    const connSub = bleService.onStateChange((state) => {
      void runtimeBridge.setBleLinkStatus(
        state === 'connected',
        state === 'connected' && bleService.isSessionReady(),
      );
      if (state === 'connected') {
        // Zone flush waits for session ready + board sync idle (see onSessionReady).
      }
    });

    const appStateSub = AppState.addEventListener('change', (next) => {
      const prev = appState;
      appState = next;
      persistAppVisibility(next);
      const gen = ++appStateGeneration;
      console.log('[Location] appState', prev, '→', next);
      if (!zonesEnabledRef.current) return;

      if (next === 'active') {
        stopDrainPoll();
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
          if (backgroundGranted) {
            void restartLocationTask().catch((e) =>
              console.warn('[Location] FGS refresh on foreground failed:', e),
            );
          }
          await refreshLocationNow('app-foreground');
        })();
      } else if (prev === 'active') {
        stopForegroundWatch();
        startDrainPoll();
        void (async () => {
          if (gen !== appStateGeneration) return;
          if (!pollTimer) {
            await syncWatchMode('app-background-recover');
            return;
          }
          if (backgroundGranted) {
            const running = await isLocationTaskRunning();
            console.log('[Location] FGS on background entry', { running });
            if (!running) {
              fgsStartPending = true;
              console.warn(
                '[Location] FGS not running — open app in foreground once to restart zone GPS',
              );
            }
          } else {
            console.warn(
              '[Location] no background permission — GPS zones only work in foreground. Grant "Allow all the time".',
            );
          }
          await syncBackgroundSnapshot('app-background');
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
      stopDrainPoll();
      stopForegroundWatch();
      void stopLocationTask();
      sessionSub();
      connSub();
      appStateSub.remove();
      storeSub();
    };
  }, []);
}
