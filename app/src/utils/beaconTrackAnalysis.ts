import type { BleCapturePacket, BleCaptureSession } from './bleCapture';
import { disneyPayload, hexToBytes } from './e9Parser';
import { STALE_FIX_MAX_AGE_MS } from './locationRuntimeBridge';

export type MergeConfidence = 'high' | 'low' | 'single';

export interface MergedTrack {
  mergedId: string;
  memberDeviceIds: string[];
  mergeConfidence: MergeConfidence;
}

export interface BeaconTrack {
  mergedId: string;
  memberDeviceIds: string[];
  mergeConfidence: MergeConfidence;
  /** Primary display id — first member, kept for existing UI helpers. */
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

interface DeviceSeries {
  deviceId: string;
  packets: BleCapturePacket[];
  tag: string;
  fingerprint: string;
  firstSeenAt: number;
  lastSeenAt: number;
  lastFresh: FreshPacket | null;
  firstFresh: FreshPacket | null;
  meanRssi: number;
  lastRssi: number;
}

const MIN_CLASSIFY_FIXES = 4;
const MIN_CLASSIFY_WINDOW_MS = 15_000;
const MERGE_GAP_HIGH_MS = 15_000;
const MERGE_GAP_LOW_MS = 45_000;
const RSSI_JUMP_DB = 15;

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

/**
 * Stable-ish identity for MAC-rotation merge. Wand casts ignore the 6 rolling
 * bytes and palette so one simulator/board across address rotations still matches.
 */
export function packetFingerprint(packet: BleCapturePacket): string {
  const p = disneyPayload(hexToBytes(packet.hex));
  if (packet.tag === 'WAND-CAST' || (p.length === 13 && p[0] === 0xCF && p[1] === 0x0B)) {
    return 'WAND-CAST';
  }
  if (packet.tag === 'WAND-CF9B' || (p.length >= 8 && p[0] === 0xCF && p[1] === 0x9B)) {
    return 'WAND-CF9B';
  }
  if (packet.tag === 'WAND-IDLE' || (p.length >= 4 && p[0] === 0x0F && p[1] === 0x11)) {
    return 'WAND-IDLE';
  }
  if (packet.tag === 'PING' || (p.length >= 2 && p[0] === 0xCC && p[1] === 0x03)) {
    return 'PING';
  }
  if (p.length >= 5 && (p[0] === 0xE1 || p[0] === 0xE2) && p[2] === 0xE9) {
    const opcode = ((p[3] ?? 0) << 8) | (p[4] ?? 0);
    return `MB+:${opcode.toString(16)}`;
  }
  if (p.length >= 2 && p[0] === 0xE9) {
    const opcode = (p[0] << 8) | (p[1] ?? 0);
    return `SHOW:${opcode.toString(16)}`;
  }
  return `${packet.tag}:${p.slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('')}`;
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

function seriesNoiseFloorM(a: DeviceSeries, b: DeviceSeries): number {
  const pts = [a.lastFresh, b.firstFresh].filter((p): p is FreshPacket => p != null);
  return noiseFloorM(pts);
}

function buildDeviceSeries(deviceId: string, unsorted: BleCapturePacket[]): DeviceSeries {
  const packets = [...unsorted].sort((a, b) => a.receivedAt - b.receivedAt);
  const fresh = packets.filter(isFreshGpsPacket);
  const rssi = packets.map(p => p.rssi).filter(Number.isFinite);
  return {
    deviceId,
    packets,
    tag: mostCommonTag(packets),
    fingerprint: packetFingerprint(packets[packets.length - 1]),
    firstSeenAt: packets[0].receivedAt,
    lastSeenAt: packets[packets.length - 1].receivedAt,
    firstFresh: fresh[0] ?? null,
    lastFresh: fresh[fresh.length - 1] ?? null,
    meanRssi: rssi.length ? mean(rssi) : 0,
    lastRssi: packets[packets.length - 1].rssi,
  };
}

function mergeConfidenceForPair(prev: DeviceSeries, next: DeviceSeries): MergeConfidence | null {
  if (prev.fingerprint !== next.fingerprint) return null;
  if (prev.tag !== next.tag) return null;

  const gap = next.firstSeenAt - prev.lastSeenAt;
  if (gap < 0 || gap > MERGE_GAP_LOW_MS) return null;

  const floor = seriesNoiseFloorM(prev, next);
  let gpsOkHigh = true;
  let gpsOkLow = true;
  if (prev.lastFresh && next.firstFresh) {
    const d = distanceM(prev.lastFresh, next.firstFresh);
    gpsOkHigh = d <= floor;
    gpsOkLow = d <= floor * 2;
  } else {
    // No shared fresh GPS — allow only as a low-confidence timing/pattern merge.
    gpsOkHigh = false;
    gpsOkLow = true;
  }

  const rssiJump = Math.abs(next.packets[0].rssi - prev.lastRssi);
  const rssiContinuous = rssiJump <= RSSI_JUMP_DB;

  if (gap <= MERGE_GAP_HIGH_MS && gpsOkHigh && rssiContinuous) return 'high';
  if (gap <= MERGE_GAP_LOW_MS && gpsOkLow) return 'low';
  return null;
}

function worstMergeConfidence(a: MergeConfidence, b: MergeConfidence): MergeConfidence {
  if (a === 'single') return b;
  if (b === 'single') return a;
  if (a === 'low' || b === 'low') return 'low';
  return 'high';
}

/**
 * Merges deviceIds that are plausibly the same physical beacon across a BLE
 * random-address rotation: same tag/fingerprint family, GPS continuous within
 * noise floor, and a short gap between the old id's last packet and the new
 * id's first packet.
 */
export function mergeRotatedDeviceIds(packets: BleCapturePacket[]): MergedTrack[] {
  const byDevice = new Map<string, BleCapturePacket[]>();
  for (const packet of packets) {
    if (!packet.deviceId) continue;
    const list = byDevice.get(packet.deviceId) ?? [];
    list.push(packet);
    byDevice.set(packet.deviceId, list);
  }

  const series = [...byDevice.entries()]
    .map(([deviceId, list]) => buildDeviceSeries(deviceId, list))
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.deviceId.localeCompare(b.deviceId));

  const parent = new Map<string, string>();
  const confidence = new Map<string, MergeConfidence>();
  for (const s of series) {
    parent.set(s.deviceId, s.deviceId);
    confidence.set(s.deviceId, 'single');
  }

  const find = (id: string): string => {
    const p = parent.get(id)!;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };

  const unite = (a: string, b: string, conf: MergeConfidence) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) {
      confidence.set(ra, worstMergeConfidence(confidence.get(ra) ?? 'single', conf));
      return;
    }
    // Prefer older root as merged id base.
    const keep = series.find(s => s.deviceId === ra)!.firstSeenAt
      <= series.find(s => s.deviceId === rb)!.firstSeenAt
      ? ra
      : rb;
    const drop = keep === ra ? rb : ra;
    parent.set(drop, keep);
    confidence.set(
      keep,
      worstMergeConfidence(
        worstMergeConfidence(confidence.get(ra) ?? 'single', confidence.get(rb) ?? 'single'),
        conf,
      ),
    );
  };

  // Greedy chain: attach each series to the temporally nearest prior candidate
  // with the same fingerprint that still fits the gap window.
  for (let i = 0; i < series.length; i++) {
    const next = series[i];
    let best: { prev: DeviceSeries; conf: MergeConfidence; gap: number } | null = null;
    for (let j = 0; j < i; j++) {
      const prev = series[j];
      const gap = next.firstSeenAt - prev.lastSeenAt;
      if (gap < 0 || gap > MERGE_GAP_LOW_MS) continue;
      const conf = mergeConfidenceForPair(prev, next);
      if (!conf) continue;
      if (!best || gap < best.gap || (gap === best.gap && conf === 'high' && best.conf !== 'high')) {
        best = { prev, conf, gap };
      }
    }
    if (best) unite(best.prev.deviceId, next.deviceId, best.conf);
  }

  const groups = new Map<string, string[]>();
  for (const s of series) {
    const root = find(s.deviceId);
    const members = groups.get(root) ?? [];
    members.push(s.deviceId);
    groups.set(root, members);
  }

  return [...groups.entries()].map(([root, members]) => {
    const ordered = members
      .map(id => series.find(s => s.deviceId === id)!)
      .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
      .map(s => s.deviceId);
    const conf = ordered.length === 1
      ? 'single' as const
      : (confidence.get(root) ?? 'low');
    return {
      mergedId: `merge_${ordered[0]}`,
      memberDeviceIds: ordered,
      mergeConfidence: conf === 'single' && ordered.length > 1 ? 'low' : conf,
    };
  });
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
  const merges = mergeRotatedDeviceIds(session.packets);
  const byDevice = new Map<string, BleCapturePacket[]>();
  for (const packet of session.packets) {
    if (!packet.deviceId) continue;
    const list = byDevice.get(packet.deviceId) ?? [];
    list.push(packet);
    byDevice.set(packet.deviceId, list);
  }

  return merges.map(merge => {
    const packets = merge.memberDeviceIds
      .flatMap(id => byDevice.get(id) ?? [])
      .sort((a, b) => a.receivedAt - b.receivedAt);
    const fresh = packets.filter(isFreshGpsPacket);
    const displacementM = maxPairwiseDistanceM(fresh);
    const trend = rssiTrend(packets);
    return {
      mergedId: merge.mergedId,
      memberDeviceIds: merge.memberDeviceIds,
      mergeConfidence: merge.mergeConfidence,
      deviceId: merge.memberDeviceIds[0],
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
