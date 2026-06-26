/**
 * useZoneManager.ts
 * Watches GPS location, evaluates zones, fires preset triggers,
 * and calculates brightness from sun position + indoor zones.
 */

import { useEffect, useRef, useCallback } from 'react';
import * as Location from 'expo-location';
import { useAppStore, Zone } from '../stores/store';
import {
  findContainingZone,
  findContainingIndoorZone,
  sunBasedBrightness,
} from '../utils/utils';
import { bleService } from '../services/BLEService';

const GPS_INTERVAL_MS    = 3000;   // poll every 3 seconds
const BRIGHTNESS_RAMP_MS = 2000;   // indoor fade duration

export function useZoneManager() {
  const {
    zones,
    indoorZones,
    brightnessConfig,
    overrideKillOnZone,
  } = useAppStore();

  // Refs to avoid stale closures in the interval callback
  const currentZoneRef    = useRef<Zone | null>(null);
  const isIndoorRef       = useRef(false);
  const brightnessRampRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyBrightness = useCallback((target: number, ramp = false) => {
    if (brightnessRampRef.current) clearTimeout(brightnessRampRef.current);

    if (!ramp) {
      bleService.sendBrightness(target);
      return;
    }

    // Fade: step brightness toward target over BRIGHTNESS_RAMP_MS
    // We send incremental steps every 100ms
    const steps    = BRIGHTNESS_RAMP_MS / 100;
    let   step     = 0;
    const interval = setInterval(() => {
      step++;
      const progress = step / steps;
      // We don't track current brightness locally — let the board handle it
      // Just send the final target at end of ramp
      if (step >= steps) {
        clearInterval(interval);
        bleService.sendBrightness(target);
      }
    }, 100);

    // Send final value after ramp completes
    brightnessRampRef.current = setTimeout(() => {
      clearInterval(interval);
      bleService.sendBrightness(target);
    }, BRIGHTNESS_RAMP_MS);
  }, []);

  useEffect(() => {
    let watchSub: Location.LocationSubscription | null = null;

    const start = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.warn('[Zone] Location permission denied');
        return;
      }

      watchSub = await Location.watchPositionAsync(
        {
          accuracy:        Location.Accuracy.Balanced,
          timeInterval:    GPS_INTERVAL_MS,
          distanceInterval: 5, // meters
        },
        (loc) => {
          const point = {
            latitude:  loc.coords.latitude,
            longitude: loc.coords.longitude,
          };

          // ── Indoor brightness ──
          const indoorZone = findContainingIndoorZone(point, indoorZones);
          const wasIndoor  = isIndoorRef.current;
          const nowIndoor  = indoorZone !== null;

          if (nowIndoor !== wasIndoor) {
            isIndoorRef.current = nowIndoor;
            if (nowIndoor) {
              applyBrightness(brightnessConfig.indoor, true);
            } else {
              // Exiting indoor zone — ramp back to sun-based brightness
              const sunBri = sunBasedBrightness(
                point.latitude, point.longitude, brightnessConfig
              );
              applyBrightness(sunBri, true);
            }
          } else if (!nowIndoor) {
            // Continuously update sun-based brightness outdoors
            const sunBri = sunBasedBrightness(
              point.latitude, point.longitude, brightnessConfig
            );
            bleService.sendBrightness(sunBri);
          }

          // ── Preset zones ──
          const matchedZone = findContainingZone(point, zones);
          const prevZone    = currentZoneRef.current;

          // No change
          if (matchedZone?.id === prevZone?.id) return;

          // Entered a new zone or left all zones
          currentZoneRef.current = matchedZone ?? null;

          if (matchedZone) {
            console.log('[Zone] Entered:', matchedZone.name);
            bleService.sendZoneTrigger(matchedZone.presetId);
          }
        }
      );
    };

    start();

    return () => {
      watchSub?.remove();
      if (brightnessRampRef.current) clearTimeout(brightnessRampRef.current);
    };
  }, [zones, indoorZones, brightnessConfig, overrideKillOnZone, applyBrightness]);
}
