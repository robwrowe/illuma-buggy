/**
 * Show pre/live/post automation that does not depend on React timers.
 * The location foreground-service tick and the foreground hook both call
 * `showAutomationTick`. Fired phase keys are persisted so the two contexts
 * don't double-fire.
 */

import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '../stores/store';
import { bleService } from './BLEService';
import { getEntityLiveData, extractShowtimes } from './themeParksApi';
import {
  getParkShowtimesCache,
  hydrateParkShowtimesCache,
  setParkShowtimesCache,
  setParkDaySchedule,
  getParkDaySchedule,
} from './parkShowtimesCache';
import { fetchParkSchedule, getEntity } from './themeParksApi';
import { parkDateString } from '../utils/showCues';
import { cueExecutorTick } from './cueExecutor';
import { buildUpcomingShows, type UpcomingShow } from './showSchedule';
import { shouldScheduleProtectZones } from '../utils/showBindings';
import { runShowPhase, stopShowMode } from './showControl';
import { sweepStaleRequests } from '../utils/restFetch';
import { markShowsTick } from '../utils/backgroundHealth';

const POLL_MS = 15 * 60 * 1000;
const FIRED_KEY = 'illuma-show-auto-fired';
const FIRED_MAX_AGE_MS = 36 * 60 * 60 * 1000;

const firedKeys = new Set<string>();
let firedHydrated = false;
let firedHydratePromise: Promise<void> | null = null;
let inFlight = false;
let lastUpcoming: UpcomingShow[] = [];
let lastFetchError: string | null = null;

export function getShowFetchError(): string | null {
  return lastFetchError;
}

export function getShowFetchAt(): number | null {
  const at = getParkShowtimesCache().fetchedAt;
  return at > 0 ? at : null;
}

async function hydrateFiredKeys(): Promise<void> {
  if (firedHydrated) return;
  if (!firedHydratePromise) {
    firedHydratePromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(FIRED_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) {
            for (const key of parsed) {
              if (typeof key === 'string') firedKeys.add(key);
            }
          }
        }
      } catch (e) {
        console.warn('[Shows] fired-keys hydrate failed', e);
      } finally {
        firedHydrated = true;
      }
    })();
  }
  await firedHydratePromise;
}

function pruneFiredKeys(now: number): void {
  for (const key of firedKeys) {
    const match = key.match(/-(\d+):/);
    if (!match) continue;
    const startMs = Number(match[1]);
    if (Number.isFinite(startMs) && now - startMs > FIRED_MAX_AGE_MS) firedKeys.delete(key);
  }
}

async function persistFiredKeys(): Promise<void> {
  try {
    await AsyncStorage.setItem(FIRED_KEY, JSON.stringify([...firedKeys]));
  } catch (e) {
    console.warn('[Shows] fired-keys persist failed', e);
  }
}

function claimFired(key: string): boolean {
  if (firedKeys.has(key)) return false;
  firedKeys.add(key);
  return true;
}

export function computeUpcomingFromStore(now = Date.now()): UpcomingShow[] {
  const s = useAppStore.getState();
  const parkId = s.activePark?.id;
  const { raw } = getParkShowtimesCache();
  if (!parkId || raw.length === 0) {
    s.setShowProtectsZones(false);
    return [];
  }
  const upcoming = buildUpcomingShows(
    raw,
    s.showBindings,
    parkId,
    s.showSettings,
    s.showInstanceOverrides,
    now,
    s.activeZoneIds,
    s.cues ?? [],
    s.showSettings.cueMaxHoldSec ?? 900,
  );
  s.setShowProtectsZones(upcoming.some(shouldScheduleProtectZones));
  return upcoming;
}

async function refreshShowtimes(): Promise<void> {
  const s = useAppStore.getState();
  const entityId = s.activePark?.themeParksApiEntityId;
  const parkId = s.activePark?.id;
  if (!entityId || !parkId) {
    setParkShowtimesCache([], null, 0);
    s.setShowProtectsZones(false);
    lastFetchError = null;
    return;
  }
  try {
    const data = await getEntityLiveData(entityId);
    const raw = extractShowtimes(data.liveData || []);
    setParkShowtimesCache(raw, entityId, Date.now());
    lastFetchError = null;
  } catch (e) {
    lastFetchError = 'Showtimes unavailable';
    console.warn('[Shows] showtimes refresh failed', e);
  }
  const tz = s.activePark?.timezone || 'America/New_York';
  const date = parkDateString(Date.now(), tz);
  if (!getParkDaySchedule(date)) {
    try {
      setParkDaySchedule(await fetchParkSchedule(entityId, date));
    } catch (e) {
      console.warn('[Shows] park schedule refresh failed', e);
    }
  }
  if (s.activePark && !s.activePark.timezone) {
    try {
      const entity = await getEntity(entityId);
      if (entity.timezone) {
        const tzName = entity.timezone;
        useAppStore.setState((st) => ({
          parks: st.parks.map((p) => (p.id === parkId ? { ...p, timezone: tzName } : p)),
          activePark: st.activePark?.id === parkId ? { ...st.activePark, timezone: tzName } : st.activePark,
        }));
        useAppStore.getState().saveToStorage();
      }
    } catch (e) {
      console.warn('[Shows] park timezone lookup failed', e);
    }
  }
}

function showtimesAreStale(): boolean {
  const s = useAppStore.getState();
  const entityId = s.activePark?.themeParksApiEntityId ?? null;
  const cache = getParkShowtimesCache();
  if (!entityId) return false;
  if (cache.entityId !== entityId) return true;
  if (!cache.fetchedAt) return true;
  return Date.now() - cache.fetchedAt > POLL_MS;
}

async function runShowAutomation(upcoming: UpcomingShow[]): Promise<void> {
  if (!bleService.isSessionReady()) return;
  const s = useAppStore.getState();
  const now = Date.now();
  let dirty = false;
  pruneFiredKeys(now);

  for (const show of upcoming) {
    if (!show.inScope) continue;
    const preKey = `${show.id}:pre`;
    const liveKey = `${show.id}:live`;
    const postKey = `${show.id}:post`;
    const exitKey = `${show.id}:exit`;
    const postAt = show.endMs + show.binding.postDelaySec * 1000;

    if (!show.autoPrePostDisabled && show.status === 'pre' && claimFired(preKey)) {
      dirty = true;
      await persistFiredKeys();
      void runShowPhase(
        show.binding, 'pre',
        s.presets, s.recallState, s.customSegmentLayouts, s.bleEffectTransitionMs,
      );
    }
    if (!show.autoLiveDisabled && show.status === 'live' && claimFired(liveKey)) {
      dirty = true;
      await persistFiredKeys();
      void runShowPhase(
        show.binding, 'live',
        s.presets, s.recallState, s.customSegmentLayouts, s.bleEffectTransitionMs,
      );
    }
    if (
      !show.autoPrePostDisabled
      && now >= postAt
      && show.status === 'ended'
      && claimFired(postKey)
    ) {
      dirty = true;
      await persistFiredKeys();
      const ran = await runShowPhase(
        show.binding, 'post',
        s.presets, s.recallState, s.customSegmentLayouts, s.bleEffectTransitionMs,
      );
      if (ran && claimFired(exitKey)) {
        await persistFiredKeys();
        void stopShowMode();
      }
    }
  }

  if (dirty) await persistFiredKeys();
}

export async function showAutomationTick(opts?: {
  background?: boolean;
  forceRefresh?: boolean;
  reconnect?: boolean;
}): Promise<UpcomingShow[]> {
  const background = opts?.background ?? AppState.currentState !== 'active';
  console.log(`[Shows] tick bg=${background}`);
  markShowsTick();
  sweepStaleRequests();

  if (inFlight) return lastUpcoming;
  inFlight = true;
  try {
    if (background && opts?.reconnect !== false && bleService.getConnectionState() === 'disconnected') {
      void bleService.connect().catch((e) => console.warn('[Shows] reconnect failed', e));
    }
    await hydrateParkShowtimesCache();
    await hydrateFiredKeys();
    if (opts?.forceRefresh || showtimesAreStale()) {
      await refreshShowtimes();
    }
    const upcoming = computeUpcomingFromStore();
    lastUpcoming = upcoming;
    const scheduleProtects = useAppStore.getState().showProtectsZones;
    const cueHolding = await cueExecutorTick();
    useAppStore.getState().setShowProtectsZones(cueHolding || scheduleProtects);
    if (!cueHolding) await runShowAutomation(upcoming);
    return upcoming;
  } finally {
    inFlight = false;
  }
}
