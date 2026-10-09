/**
 * Direct phone → WLED HTTP client for zone preset applies. Bypasses BLE + logic board
 * entirely. Routing uses `isWledReachable()` (HTTP probe) rather than SSID matching —
 * works whether the phone joined StrollerNet or is hosting the hotspot GLEDOPTO joins.
 * `isOnWledNetwork()` remains for UI "on StrollerNet" display only.
 */

import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useAppStore } from '../stores/store';
import type { Preset, RecallState } from '../stores/store';
import type { CustomSegmentLayout, SharedSegmentMap } from './segmentLayouts';
import { restFetch } from './restFetch';

const FETCH_TIMEOUT_MS = 2500;
const PROBE_TIMEOUT_MS = 700;
const PROBE_CACHE_MS = 12_000;
const BG_FALSE_CACHE_MS = 2_000;
const BG_PROBE_TIMEOUT_MS = 2_000;
const BG_POST_TIMEOUT_MS = 8_000;
const SKIP_PROBE_AFTER_OK_MS = 60_000;

let lastProbeAt = 0;
let lastProbeResult = false;
let lastDirectOkAt = 0;

/** Current WiFi SSID the phone is joined to, or null if not on WiFi / unavailable. */
export async function getCurrentWifiSsid(): Promise<string | null> {
  try {
    const state = await NetInfo.fetch();
    if (state.type !== 'wifi') return null;
    // Android requires location permission granted for SSID to be populated;
    // the app already requests this for zone/GPS features.
    const details = state.details as { ssid?: string | null } | null;
    return details?.ssid ?? null;
  } catch {
    return null;
  }
}

/** True if the phone is currently on the configured GLEDOPTO/StrollerNet SSID. */
export async function isOnWledNetwork(): Promise<boolean> {
  const { wledSsid } = useAppStore.getState();
  if (!wledSsid) return false;
  const current = await getCurrentWifiSsid();
  if (!current) return false;
  // SSID compare — case-sensitive exact match, same as GLEDOPTO join.
  return current === wledSsid;
}

function probeCacheMs(): number {
  if (!lastProbeResult && AppState.currentState !== 'active') return BG_FALSE_CACHE_MS;
  return PROBE_CACHE_MS;
}

async function probeOnce(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await restFetch('wled-probe', url, { method: 'GET' }, { timeoutMs });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Best-effort check that WLED is reachable right now over whatever network
 * path the phone currently has — hotspot-hosting, joined-AP, doesn't matter.
 * A recent successful POST skips the probe. A background false result is only
 * cached for a couple of seconds, and the probe is retried once.
 */
export async function isWledReachable(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && now - lastDirectOkAt < SKIP_PROBE_AFTER_OK_MS) {
    return true;
  }
  if (!force && now - lastProbeAt < probeCacheMs()) {
    return lastProbeResult;
  }
  const { wledIp, wledPort } = useAppStore.getState();
  const host = (wledIp || '').trim();
  if (!host) {
    lastProbeAt = now;
    lastProbeResult = false;
    return false;
  }
  const port = wledPort || 80;
  const url = `http://${host}:${port}/json/info`;
  const background = AppState.currentState !== 'active';
  const timeoutMs = background ? Math.max(PROBE_TIMEOUT_MS, BG_PROBE_TIMEOUT_MS) : PROBE_TIMEOUT_MS;
  let ok = await probeOnce(url, timeoutMs);
  if (!ok) ok = await probeOnce(url, timeoutMs);
  lastProbeResult = ok;
  lastProbeAt = Date.now();
  return lastProbeResult;
}

/** Invalidate the cached reachability result — call after WLED IP/port changes. */
export function invalidateWledReachabilityCache(): void {
  lastProbeAt = 0;
  lastDirectOkAt = 0;
}

/** POST a resolved WLED state payload directly to WLED's HTTP JSON API. */
export async function postWledStateDirect(payload: object): Promise<boolean> {
  const { wledIp, wledPort } = useAppStore.getState();
  const host = (wledIp || '').trim();
  if (!host) {
    console.warn('[WledDirect] no wledIp configured');
    return false;
  }
  const port = wledPort || 80;
  const url = `http://${host}:${port}/json/state`;
  const background = AppState.currentState !== 'active';
  const timeoutMs = background ? Math.max(FETCH_TIMEOUT_MS, BG_POST_TIMEOUT_MS) : FETCH_TIMEOUT_MS;
  try {
    const res = await restFetch('wled-state', url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, { timeoutMs });
    if (!res.ok) {
      console.warn('[WledDirect] WLED rejected request', res.status);
      return false;
    }
    lastDirectOkAt = Date.now();
    return true;
  } catch (e) {
    console.warn('[WledDirect] request failed', e);
    return false;
  }
}

/** Apply a preset directly to WLED over HTTP — same payload shape as board `wled_raw`. */
export async function applyPresetWledDirect(
  preset: Preset,
  recall: RecallState,
  sharedMaps: SharedSegmentMap[],
  layouts: CustomSegmentLayout[],
): Promise<boolean> {
  // Dynamic import avoids a static cycle with bleBoardSync (which imports this module).
  const { presetWledForBoard } = await import('./bleBoardSync');
  const payload = presetWledForBoard(preset, sharedMaps, layouts, recall);
  console.log('[WledDirect] applying', preset.id, preset.name);
  const ok = await postWledStateDirect(payload);
  console.log('[WledDirect]', ok ? 'ok' : 'failed', preset.id);
  return ok;
}
