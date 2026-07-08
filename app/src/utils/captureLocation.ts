/**
 * GPS fixes for phone-direct BLE capture — runs during active capture sessions
 * so lat/lng are stamped even when zone tracking is off.
 */

import * as Location from 'expo-location';

export interface CaptureGpsFix {
  latitude: number;
  longitude: number;
  accuracyM?: number;
}

let lastFix: CaptureGpsFix | null = null;
let subscription: Location.LocationSubscription | null = null;
let startPromise: Promise<void> | null = null;

export function getCaptureLocation(): CaptureGpsFix | null {
  return lastFix;
}

export async function startCaptureLocation(): Promise<void> {
  if (subscription) return;
  if (startPromise) return startPromise;

  startPromise = (async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.warn('[CaptureGPS] Foreground location permission not granted');
      return;
    }

    const applyFix = (coords: Location.LocationObjectCoords) => {
      lastFix = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracyM: coords.accuracy ?? undefined,
      };
    };

    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: false,
      });
      applyFix(loc.coords);
    } catch (e) {
      console.warn('[CaptureGPS] getCurrentPosition failed:', e);
    }

    try {
      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 2000,
          distanceInterval: 1,
          mayShowUserSettingsDialog: false,
        },
        (loc) => applyFix(loc.coords),
      );
    } catch (e) {
      console.warn('[CaptureGPS] watchPosition failed:', e);
    }
  })();

  try {
    await startPromise;
  } finally {
    startPromise = null;
  }
}

export function stopCaptureLocation(): void {
  subscription?.remove();
  subscription = null;
  lastFix = null;
  startPromise = null;
}
