import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { useAppStore, Zone, LatLng } from '../stores/store';
import { findContainingZone, findContainingIndoorZone, pointInPolygon, sunBasedBrightness } from '../utils/utils';
import { resolveActivePark } from '../utils/resolveActivePark';
import { bleService } from '../services/BLEService';
import { triggerZonePreset } from '../utils/bleBoardSync';

/** Foreground + zone triggers enabled */
const GPS_ACTIVE_MS = 8000;
const GPS_ACTIVE_M  = 12;
/** Foreground + zone triggers paused — still need indoor/brightness */
const GPS_IDLE_MS   = 30000;
const GPS_IDLE_M    = 25;

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
      bleService.sendBrightness(value);
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
      setActivePark(resolveActivePark(pt, parks, zones, indoorZones));

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
        console.log('[Zone] Entered:', matchedZone.name, 'preset:', matchedZone.presetId);
        const s = useAppStore.getState();
        const preset = s.presets.find(p => p.id === matchedZone.presetId);
        if (preset) {
          void triggerZonePreset(preset, s.recallState, s.customSegmentLayouts);
        } else {
          bleService.sendZoneTrigger(matchedZone.presetId);
        }
      } else if (prevZone) {
        console.log('[Zone] Left all zones');
        bleService.sendOverrideClear();
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

    const appStateSub = AppState.addEventListener('change', (next) => {
      appState = next;
      if (next === 'active') startWatch();
      else stopWatch();
    });

    const storeSub = useAppStore.subscribe((state, prev) => {
      if (state.zonesEnabled !== prev.zonesEnabled && appState === 'active') {
        restartWatch();
      }
    });

    return () => {
      stopWatch();
      appStateSub.remove();
      storeSub();
      if (brightnessTimerRef.current) clearTimeout(brightnessTimerRef.current);
    };
  }, []);
}
