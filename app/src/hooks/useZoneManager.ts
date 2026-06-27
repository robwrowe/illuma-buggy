import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { useAppStore, Zone } from '../stores/store';
import { findContainingZone, findContainingIndoorZone, pointInPolygon, sunBasedBrightness } from '../utils/utils';
import { bleService } from '../services/BLEService';

const GPS_INTERVAL_MS    = 3000;
const BRIGHTNESS_RAMP_MS = 2000;

export function useZoneManager() {
  const currentZoneRef    = useRef<Zone | null>(null);
  const isIndoorRef       = useRef(false);
  const brightnessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const zonesRef              = useRef(useAppStore.getState().zones);
  const indoorZonesRef        = useRef(useAppStore.getState().indoorZones);
  const brightnessConfigRef   = useRef(useAppStore.getState().brightnessConfig);
  const zonesEnabledRef       = useRef(useAppStore.getState().zonesEnabled);
  const setActiveZoneIdsRef   = useRef(useAppStore.getState().setActiveZoneIds);

  useEffect(() => {
    return useAppStore.subscribe((state) => {
      zonesRef.current            = state.zones;
      indoorZonesRef.current      = state.indoorZones;
      brightnessConfigRef.current = state.brightnessConfig;
      zonesEnabledRef.current     = state.zonesEnabled;
      setActiveZoneIdsRef.current = state.setActiveZoneIds;
    });
  }, []);

  useEffect(() => {
    let watchSub: Location.LocationSubscription | null = null;

    const start = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { console.warn('[Zone] Location permission denied'); return; }

      watchSub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: GPS_INTERVAL_MS, distanceInterval: 5 },
        (loc) => {
          const pt = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          const zones           = zonesRef.current;
          const indoorZones     = indoorZonesRef.current;
          const bc              = brightnessConfigRef.current;
          const zonesEnabled    = zonesEnabledRef.current;
          const setActive       = setActiveZoneIdsRef.current;

          // Update active zone IDs in store (for HomeScreen display)
          const activeIds = zones.filter(z => z.enabled && pointInPolygon(pt, z.polygon)).map(z => z.id);
          setActive(activeIds);

          // Indoor brightness
          const nowIndoor = findContainingIndoorZone(pt, indoorZones) !== null;
          if (nowIndoor !== isIndoorRef.current) {
            isIndoorRef.current = nowIndoor;
            if (brightnessTimerRef.current) clearTimeout(brightnessTimerRef.current);
            brightnessTimerRef.current = setTimeout(() => {
              bleService.sendBrightness(nowIndoor ? bc.indoor : sunBasedBrightness(pt.latitude, pt.longitude, bc));
            }, nowIndoor ? 0 : BRIGHTNESS_RAMP_MS);
          } else if (!nowIndoor) {
            bleService.sendBrightness(sunBasedBrightness(pt.latitude, pt.longitude, bc));
          }

          // Preset zone trigger
          if (!zonesEnabled) return;
          const matchedZone = findContainingZone(pt, zones);
          const prevZone    = currentZoneRef.current;
          if (matchedZone?.id === prevZone?.id) return;
          currentZoneRef.current = matchedZone ?? null;
          if (matchedZone) {
            console.log('[Zone] Entered:', matchedZone.name, 'preset:', matchedZone.presetId);
            bleService.sendZoneTrigger(matchedZone.presetId);
          } else {
            console.log('[Zone] Left all zones');
          }
        }
      );
    };

    start();
    return () => {
      watchSub?.remove();
      if (brightnessTimerRef.current) clearTimeout(brightnessTimerRef.current);
    };
  }, []);
}
