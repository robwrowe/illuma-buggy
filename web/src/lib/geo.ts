/**
 * geo.js — point-in-polygon + nearest-zone helpers for the web tool.
 * Web zones use {lat, lng} (see normalizePolygonPoint in ./utils.js);
 * this is a separate implementation from app/src/utils/utils.ts, which
 * uses {latitude, longitude} for react-native-maps. Keep both in sync
 * manually if the ray-casting algorithm itself ever needs a bugfix —
 * there is no shared package between web/ and app/ to import from.
 */

/** Ray-casting point-in-polygon. polygon: [{lat,lng}, ...], point: {lat,lng}. */
export function pointInPolygon(point, polygon) {
  if (!polygon || polygon.length < 3) return false;
  const { lat: y, lng: x } = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    const intersect = (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Shoelace area — used to prefer smaller/inner zones over larger/outer ones on overlap. */
export function polygonArea(poly) {
  if (!poly || poly.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].lat * poly[j].lng - poly[j].lat * poly[i].lng;
  }
  return Math.abs(area / 2);
}

/** All enabled zones (from the given list) whose polygon contains point. */
export function zonesContainingPoint(point, zones) {
  return (zones || []).filter((z) => z.enabled && pointInPolygon(point, z.polygon || []));
}

/**
 * Zone to treat as "current" when overlapping — prefers zones with a presetId,
 * then smallest polygonArea (matches app findTriggerZone).
 */
export function findTriggerZone(point, zones) {
  const containing = zonesContainingPoint(point, zones);
  if (!containing.length) return null;
  const withPreset = containing.filter((z) => z.presetId);
  const candidates = withPreset.length ? withPreset : containing;
  return candidates.reduce((best, z) =>
    polygonArea(z.polygon || []) < polygonArea(best.polygon || []) ? z : best,
  );
}
