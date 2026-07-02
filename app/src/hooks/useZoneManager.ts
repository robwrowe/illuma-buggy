import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { useAppStore, Zone, LatLng } from '../stores/store';
import { findContainingZone, findContainingIndoorZone, pointInPolygon, sunBasedBrightness } from '../utils/utils';
import { resolveActivePark } from '../utils/resolveActivePark';
import { bleService } from '../services/BLEService';
import { triggerZonePreset } from '../utils/bleBoardSync';

/** Foreground + zone triggers enabled */
const GPS_ACTIVE_MS = 5000;
const GPS_ACTIVE_M  = 8;
/** Foreground + zone triggers paused — still need indoor/brightness */
const GPS_IDLE_MS   = 30000;
const GPS_IDLE_M    = 25;
/** Min gap before re-sending the same zone preset (e.g. BLE reconnect while still in zone) */
const ZONE_REAPPLY_MS = 45_000;

const BRIGHTNESS_RAMP_MS = 2000;

function watchOptions(zonesEnabled: boolean): Location.LocationOptions {
  return {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: zonesEnabled ? GPS_ACTIVE_MS : GPS_IDLE_MS,
    distanceInterval: zonesEnabled ? GPS_ACTIVE_M : GPS_IDLE_M,
  };
}

export function useZoneManager() {
  const currentZoneRef     = useRef<Zone | null>(null);
  const pendingZoneRef     = useRef<Zone | null>(null);
  const lastZoneApplyRef   = useRef<{ zoneId: string; at: number } | null>(null);
  const isIndoorRef        = useRef(false);
  const lastBrightnessRef  = useRef<number | null>(null);
  const brightnessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const zonesRef              = useRef(useAppStore.getState().zones);
  const indoorZonesRef        = useRef(useAppStore.getState().indoorZones);
  const parksRef              = useRef(useAppStore.getState().parks);
  const setActiveParkRef      = useRef(useAppStore.getState().setActivePark);
  const brightnessConfigRef   = useRef(useAppStore.getState().brightnessConfig);
  const zonesEnabledRef       = useRef(useAppStore.getState().zonesEnabled);
  const setActiveZoneIdsRef   = useRef(useAppStore.getState().setActiveZoneIds);
  const setUserLocationRef    = useRef(useAppStore.getState().setUserLocation);

  useEffect(() => {
    return useAppStore.subscribe((state) => {
      zonesRef.current            = state.zones;
      indoorZonesRef.current      = state.indoorZones;
      parksRef.current            = state.parks;
      setActiveParkRef.current    = state.setActivePark;
      brightnessConfigRef.current = state.brightnessConfig;
      zonesEnabledRef.current     = state.zonesEnabled;
      setActiveZoneIdsRef.current = state.setActiveZoneIds;
      setUserLocationRef.current  = state.setUserLocation;
    });
  }, []);

  useEffect(() => {
    let watchSub: Location.LocationSubscription | null = null;
    let appState: AppStateStatus = AppState.currentState;
    let permissionGranted = false;

    const sendBrightnessIfChanged = (value: number) => {
      if (lastBrightnessRef.current === value) return;
      lastBrightnessRef.current = value;
      if (bleService.isSessionReady()) bleService.sendBrightness(value);
    };

    const shouldApplyZone = (zone: Zone, force: boolean): boolean => {
      if (force) return true;
      const last = lastZoneApplyRef.current;
      if (!last || last.zoneId !== zone.id) return true;
      return Date.now() - last.at >= ZONE_REAPPLY_MS;
    };

    const applyZoneEntry = (matchedZone: Zone, opts?: { force?: boolean }) => {
      if (!matchedZone.presetId) {
        console.log('[Zone] Entered (boundary only):', matchedZone.name);
        return;
      }
      if (!shouldApplyZone(matchedZone, opts?.force ?? false)) {
        console.log('[Zone] Skipping re-apply (throttled):', matchedZone.name);
        return;
      }
      console.log('[Zone] Applying:', matchedZone.name, 'preset:', matchedZone.presetId);
      lastZoneApplyRef.current = { zoneId: matchedZone.id, at: Date.now() };
      const s = useAppStore.getState();
      const preset = s.presets.find(p => p.id === matchedZone.presetId);
      if (preset) {
        void triggerZonePreset(preset, s.recallState, s.customSegmentLayouts);
      } else {
        bleService.sendZoneTrigger(matchedZone.presetId);
      }
    };

    const flushPendingZone = () => {
      const pending = pendingZoneRef.current;
      if (!pending || !bleService.isSessionReady()) return;
      pendingZoneRef.current = null;
      currentZoneRef.current = pending;
      applyZoneEntry(pending, { force: true });
    };

    const reapplyCurrentZoneOnConnect = () => {
      const zone = currentZoneRef.current;
      if (!zone?.presetId || !zonesEnabledRef.current) return;
      if (!bleService.isSessionReady()) {
        pendingZoneRef.current = zone;
        return;
      }
      applyZoneEntry(zone, { force: false });
    };

    const handleLocation = (pt: LatLng) => {
      const zones           = zonesRef.current;
      const indoorZones     = indoorZonesRef.current;
      const parks           = parksRef.current;
      const setActivePark   = setActiveParkRef.current;
      const bc              = brightnessConfigRef.current;
      const zonesEnabled    = zonesEnabledRef.current;
      const setActive       = setActiveZoneIdsRef.current;

      setUserLocationRef.current(pt);
      const resolvedPark = resolveActivePark(pt, parks, zones, indoorZones);
      const currentParkId = useAppStore.getState().activePark?.id;
      if (resolvedPark?.id !== currentParkId) {
        setActivePark(resolvedPark);
      }

      const activeIds = zones.filter(z => z.enabled && pointInPolygon(pt, z.polygon)).map(z => z.id);
      setActive(activeIds);

      const nowIndoor = findContainingIndoorZone(pt, indoorZones) !== null;
      const outdoorBrightness = sunBasedBrightness(pt.latitude, pt.longitude, bc);

      if (nowIndoor !== isIndoorRef.current) {
        isIndoorRef.current = nowIndoor;
        if (brightnessTimerRef.current) clearTimeout(brightnessTimerRef.current);
        const target = nowIndoor ? bc.indoor : outdoorBrightness;
        brightnessTimerRef.current = setTimeout(() => {
          sendBrightnessIfChanged(target);
        }, nowIndoor ? 0 : BRIGHTNESS_RAMP_MS);
      } else if (!nowIndoor) {
        sendBrightnessIfChanged(outdoorBrightness);
      }

      if (!zonesEnabled) return;
      const matchedZone = findContainingZone(pt, zones);
      const prevZone    = currentZoneRef.current;
      if (matchedZone?.id === prevZone?.id) return;
      currentZoneRef.current = matchedZone ?? null;
      if (matchedZone) {
        if (!bleService.isSessionReady()) {
          pendingZoneRef.current = matchedZone;
          return;
        }
        applyZoneEntry(matchedZone, { force: true });
      } else if (prevZone) {
        pendingZoneRef.current = null;
        lastZoneApplyRef.current = null;
        console.log('[Zone] Left all zones');
        if (prevZone.presetId && bleService.isSessionReady()) {
          bleService.sendOverrideClear();
        }
      }
    };

    const refreshLocationNow = async () => {
      if (!permissionGranted) return;
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        handleLocation({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
      } catch (e) {
        console.warn('[Zone] getCurrentPosition failed:', e);
      }
    };

    const stopWatch = () => {
      watchSub?.remove();
      watchSub = null;
    };

    const startWatch = async () => {
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
        (loc) => handleLocation({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        }),
      );
    };

    const restartWatch = async () => {
      stopWatch();
      await startWatch();
    };

    startWatch();

    const sessionSub = bleService.onSessionReady(async () => {
      await refreshLocationNow();
      flushPendingZone();
      reapplyCurrentZoneOnConnect();
    });

    const appStateSub = AppState.addEventListener('change', (next) => {
      appState = next;
      if (next === 'active') {
        startWatch();
        void refreshLocationNow();
      } else {
        stopWatch();
      }
    });

    const storeSub = useAppStore.subscribe((state, prev) => {
      if (state.zonesEnabled !== prev.zonesEnabled && appState === 'active') {
        restartWatch();
      }
    });

    return () => {
      stopWatch();
      sessionSub();
      appStateSub.remove();
      storeSub();
      if (brightnessTimerRef.current) clearTimeout(brightnessTimerRef.current);
    };
  }, []);
}
