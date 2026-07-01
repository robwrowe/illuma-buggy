import type { ParkConfig } from './configMigration';
import type { LatLng, Zone, IndoorZone } from '../stores/store';
import { pointInPolygon } from './utils';

const NEAR_PARK_KM = 2;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Active park from GPS zone match, else nearest park center within 2 km. */
export function resolveActivePark(
  currentGps: LatLng | null,
  parks: ParkConfig[],
  zones: Zone[],
  indoorZones: IndoorZone[],
): ParkConfig | null {
  if (!currentGps || parks.length === 0) return null;

  for (const z of zones) {
    if (!z.enabled || !z.parkId) continue;
    if (pointInPolygon(currentGps, z.polygon)) {
      const park = parks.find(p => p.id === z.parkId);
      if (park) return park;
    }
  }
  for (const z of indoorZones) {
    if (!z.enabled || !z.parkId) continue;
    if (pointInPolygon(currentGps, z.polygon)) {
      const park = parks.find(p => p.id === z.parkId);
      if (park) return park;
    }
  }

  let best: ParkConfig | null = null;
  let bestDist = Infinity;
  for (const park of parks) {
    if (park.centerLat == null || park.centerLng == null) continue;
    const d = haversineKm(
      currentGps.latitude, currentGps.longitude,
      park.centerLat, park.centerLng,
    );
    if (d <= NEAR_PARK_KM && d < bestDist) {
      bestDist = d;
      best = park;
    }
  }
  return best;
}
