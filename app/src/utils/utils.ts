/**
 * utils.ts
 * Solar elevation math, point-in-polygon, zone evaluation.
 */

import { LatLng, Zone, IndoorZone, BrightnessConfig } from '../stores/store';

// ─────────────────────────────────────────────
// Solar elevation
// Returns sun elevation angle in degrees above horizon.
// Negative = below horizon (nighttime).
// ─────────────────────────────────────────────

export function solarElevation(lat: number, lng: number, date: Date = new Date()): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;

  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000
  );

  // Declination
  const declination = toRad(23.45 * Math.sin(toRad((360 / 365) * (dayOfYear - 81))));

  // Hour angle
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const solarNoon = 12 - lng / 15;
  const hourAngle = toRad(15 * (utcHours - solarNoon));

  const latRad = toRad(lat);

  const sinElevation =
    Math.sin(latRad) * Math.sin(declination) +
    Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);

  return toDeg(Math.asin(sinElevation));
}

/**
 * Calculate target brightness based on sun elevation.
 * Applies gradual ramp around the threshold (civil twilight by default).
 */
export function sunBasedBrightness(
  lat: number,
  lng: number,
  config: BrightnessConfig,
  date: Date = new Date()
): number {
  const elevation = solarElevation(lat, lng, date);
  const { daytime, nighttime, transitionMinutes, solarThresholdDeg } = config;

  // Each degree of elevation ≈ 4 minutes of solar time
  // transitionMinutes / 4 = transition range in degrees
  const transitionDeg = transitionMinutes / 4;
  const upperBound = solarThresholdDeg + transitionDeg / 2;
  const lowerBound = solarThresholdDeg - transitionDeg / 2;

  if (elevation >= upperBound) return daytime;
  if (elevation <= lowerBound) return nighttime;

  // Linear interpolation through transition band
  const t = (elevation - lowerBound) / (upperBound - lowerBound);
  return Math.round(nighttime + t * (daytime - nighttime));
}

// ─────────────────────────────────────────────
// Point-in-polygon — ray casting algorithm
// ─────────────────────────────────────────────

export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  const { latitude: y, longitude: x } = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].longitude;
    const yi = polygon[i].latitude;
    const xj = polygon[j].longitude;
    const yj = polygon[j].latitude;

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

// ─────────────────────────────────────────────
// Zone evaluation
// ─────────────────────────────────────────────

/**
 * Find the first zone (by array order = entry order) that contains the point.
 * "First-entered" priority is maintained by the app tracking which zone was
 * entered first and only switching when that zone is exited.
 */
export function findContainingZone(point: LatLng, zones: Zone[]): Zone | null {
  return zones.find((z) => z.enabled && pointInPolygon(point, z.polygon)) ?? null;
}

export function findContainingIndoorZone(
  point: LatLng,
  zones: IndoorZone[]
): IndoorZone | null {
  return zones.find((z) => z.enabled && pointInPolygon(point, z.polygon)) ?? null;
}

/**
 * Check if two polygons overlap (any vertex of A is inside B or vice versa).
 * Used by the zone drawing UI to warn about overlaps.
 */
export function polygonsOverlap(a: LatLng[], b: LatLng[]): boolean {
  return (
    a.some((pt) => pointInPolygon(pt, b)) ||
    b.some((pt) => pointInPolygon(pt, a))
  );
}

// ─────────────────────────────────────────────
// ID generation
// ─────────────────────────────────────────────

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
