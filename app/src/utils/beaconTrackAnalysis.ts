import type { BleCapturePacket, BleCaptureSession } from './bleCapture';
import { STALE_FIX_MAX_AGE_MS } from './locationRuntimeBridge';

export interface BeaconTrack {
  deviceId: string;
  tag: string;
  packetCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  /**
   * Not measurable from a phone-only capture: packet GPS is the receiver's
   * position, not the transmitter's position.
   */
  ownDisplacementM: number | null;
  /** Maximum phone displacement while this beacon was observed. */
  userDisplacementM: number | null;
  classification: 'fixed' | 'moving_correlated' | 'moving_independent' | 'insufficient_gps';
  rssiTrend: 'rising' | 'falling' | 'rise_then_fall' | 'flat' | 'noisy';
  freshGpsFixCount: number;
}

interface FreshPacket extends BleCapturePacket {
  lat: number;
  lng: number;
  gpsUpdatedAt: number;
}

const MIN_CLASSIFY_FIXES = 4;
const MIN_CLASSIFY_WINDOW_MS = 15_000;

function isFreshGpsPacket(p: BleCapturePacket): p is FreshPacket {
  if (
    p.lat == null || p.lng == null || p.gpsUpdatedAt == null
    || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)
  ) return false;
  const age = p.receivedAt - p.gpsUpdatedAt;
  return age >= 0 && age < STALE_FIX_MAX_AGE_MS;
}

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = Math.PI / 180;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function sampled<T>(items: T[], max = 300): T[] {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, i) =>
    items[Math.round(i * (items.length - 1) / (max - 1))]);
}

function maxPairwiseDistanceM(points: FreshPacket[]): number | null {
  if (points.length < 2) return null;
  const limited = sampled(points);
  let max = 0;
  for (let i = 0; i < limited.length - 1; i++) {
    for (let j = i + 1; j < limited.length; j++) {
      max = Math.max(max, distanceM(limited[i], limited[j]));
    }
  }
  return max;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  const avg = mean(values);
  return Math.sqrt(mean(values.map(value => (value - avg) ** 2)));
}

function rssiTrend(packets: BleCapturePacket[]): BeaconTrack['rssiTrend'] {
  const values = packets.map(p => p.rssi).filter(Number.isFinite);
  if (values.length < 4) return 'noisy';
  const third = Math.max(1, Math.floor(values.length / 3));
  const first = mean(values.slice(0, third));
  const middleStart = Math.floor((values.length - third) / 2);
  const middle = mean(values.slice(middleStart, middleStart + third));
  const last = mean(values.slice(-third));

  if (middle >= first + 6 && middle >= last + 6) return 'rise_then_fall';
  if (last >= first + 6) return 'rising';
  if (last <= first - 6) return 'falling';
  if (Math.max(first, middle, last) - Math.min(first, middle, last) <= 4
      && standardDeviation(values) <= 7) return 'flat';
  return 'noisy';
}

function mostCommonTag(packets: BleCapturePacket[]): string {
  const counts = new Map<string, number>();
  for (const packet of packets) counts.set(packet.tag, (counts.get(packet.tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'DISNEY';
}

function correlation(xs: number[], ys: number[]): number {
  if (xs.length < 3 || xs.length !== ys.length) return 0;
  const xMean = mean(xs);
  const yMean = mean(ys);
  let numerator = 0;
  let xSq = 0;
  let ySq = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] - xMean;
    const y = ys[i] - yMean;
    numerator += x * y;
    xSq += x * x;
    ySq += y * y;
  }
  return xSq > 0 && ySq > 0 ? numerator / Math.sqrt(xSq * ySq) : 0;
}

/**
 * A coarse fixed-transmitter check: for a fixed beacon, RSSI should generally
 * improve as the phone approaches the location where its strongest sample was
 * observed. This is evidence, not a transmitter position estimate.
 */
function fixedSpatialScore(points: FreshPacket[]): number {
  if (points.length < MIN_CLASSIFY_FIXES) return 0;
  const limited = sampled(points);
  const strongest = limited.reduce((best, point) => point.rssi > best.rssi ? point : best);
  const proximity = limited.map(point => -Math.log(Math.max(1, distanceM(point, strongest))));
  return correlation(proximity, limited.map(point => point.rssi));
}

function noiseFloorM(points: FreshPacket[]): number {
  const accuracies = points
    .map(point => point.accuracyM)
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const median = accuracies.length ? accuracies[Math.floor(accuracies.length / 2)] : 7.5;
  return Math.max(10, Math.min(40, median * 2));
}

function classify(
  points: FreshPacket[],
  displacementM: number | null,
  trend: BeaconTrack['rssiTrend'],
): BeaconTrack['classification'] {
  if (
    points.length < MIN_CLASSIFY_FIXES
    || points[points.length - 1].receivedAt - points[0].receivedAt < MIN_CLASSIFY_WINDOW_MS
    || displacementM == null
  ) return 'insufficient_gps';

  const rssiValues = points.map(point => point.rssi);
  const rssiRange = Math.max(...rssiValues) - Math.min(...rssiValues);
  const receiverMoved = displacementM > noiseFloorM(points);

  // With a stationary receiver, fixed and co-moving transmitters are not
  // distinguishable. A strong pass-by curve is the one useful exception.
  if (!receiverMoved) {
    return trend === 'rise_then_fall' && rssiRange >= 10
      ? 'moving_independent'
      : 'insufficient_gps';
  }

  if (trend === 'rise_then_fall' && rssiRange >= 10) return 'moving_independent';
  if (rssiRange >= 6 && fixedSpatialScore(points) >= 0.45) return 'fixed';
  if (trend === 'flat') return 'moving_correlated';
  return 'insufficient_gps';
}

export function analyzeBeaconTracks(session: BleCaptureSession): BeaconTrack[] {
  const grouped = new Map<string, BleCapturePacket[]>();
  for (const packet of session.packets) {
    if (!packet.deviceId) continue;
    const packets = grouped.get(packet.deviceId) ?? [];
    packets.push(packet);
    grouped.set(packet.deviceId, packets);
  }

  return [...grouped.entries()].map(([deviceId, unsorted]) => {
    const packets = [...unsorted].sort((a, b) => a.receivedAt - b.receivedAt);
    const fresh = packets.filter(isFreshGpsPacket);
    const displacementM = maxPairwiseDistanceM(fresh);
    const trend = rssiTrend(packets);
    return {
      deviceId,
      tag: mostCommonTag(packets),
      packetCount: packets.length,
      firstSeenAt: packets[0].receivedAt,
      lastSeenAt: packets[packets.length - 1].receivedAt,
      ownDisplacementM: null,
      userDisplacementM: displacementM,
      classification: classify(fresh, displacementM, trend),
      rssiTrend: trend,
      freshGpsFixCount: fresh.length,
    };
  });
}
