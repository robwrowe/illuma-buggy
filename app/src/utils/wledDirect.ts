/**
 * Direct phone → WLED HTTP client for zone preset applies. Bypasses BLE + logic board
 * entirely. Only viable when phone WiFi is joined to the GLEDOPTO AP (StrollerNet),
 * which is always true when the phone is hosting the hotspot GLEDOPTO uses.
 */

import NetInfo from '@react-native-community/netinfo';
import { useAppStore } from '../stores/store';
import type { Preset, RecallState } from '../stores/store';
import type { CustomSegmentLayout, SharedSegmentMap } from './segmentLayouts';

const FETCH_TIMEOUT_MS = 2500;

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

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('WLED request timed out')), ms),
    ),
  ]);
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
  try {
    const res = await withTimeout(
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      FETCH_TIMEOUT_MS,
    );
    if (!res.ok) {
      console.warn('[WledDirect] WLED rejected request', res.status);
      return false;
    }
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
