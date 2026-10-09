/**
 * Shared Theme Parks API showtimes cache.
 * Written by show automation / capture; read by BleCaptureScreen.
 * Persisted so a background JS context and the foreground UI agree on the
 * last schedule and don't each refetch on every wake.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ParkDaySchedule } from '../utils/showCues';

const STORAGE_KEY = 'illuma-park-showtimes';

export interface ParkShowtimeEntity {
  id: string;
  name: string;
  showtimes: string[];
}

let lastRaw: ParkShowtimeEntity[] = [];
let lastEntityId: string | null = null;
let lastFetchedAt = 0;
let daySchedule: ParkDaySchedule | null = null;
let hydrated = false;
let hydratePromise: Promise<void> | null = null;

const SCHEDULE_KEY = 'illuma-park-day-schedule';

export function setParkShowtimesCache(
  raw: ParkShowtimeEntity[],
  entityId: string | null,
  fetchedAt = raw.length || entityId ? Date.now() : 0,
) {
  lastRaw = raw || [];
  lastEntityId = entityId;
  lastFetchedAt = fetchedAt;
  hydrated = true;
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({
    raw: lastRaw,
    entityId: lastEntityId,
    fetchedAt: lastFetchedAt,
  })).catch((e) => console.warn('[Shows] showtimes persist failed', e));
}

export function getParkShowtimesCache(): {
  raw: ParkShowtimeEntity[];
  entityId: string | null;
  fetchedAt: number;
} {
  return { raw: lastRaw, entityId: lastEntityId, fetchedAt: lastFetchedAt };
}

export function setParkDaySchedule(schedule: ParkDaySchedule | null): void {
  daySchedule = schedule;
  void AsyncStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedule)).catch((e) => {
    console.warn('[Shows] schedule persist failed', e);
  });
}

export function getParkDaySchedule(date?: string): ParkDaySchedule | null {
  if (!daySchedule) return null;
  if (date && daySchedule.date !== date) return null;
  return daySchedule;
}

export async function hydrateParkShowtimesCache(): Promise<void> {
  if (hydrated) return;
  if (!hydratePromise) {
    hydratePromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            raw?: ParkShowtimeEntity[];
            entityId?: string | null;
            fetchedAt?: number;
          };
          lastRaw = Array.isArray(parsed.raw) ? parsed.raw : [];
          lastEntityId = parsed.entityId ?? null;
          lastFetchedAt = Number.isFinite(parsed.fetchedAt) ? parsed.fetchedAt! : 0;
        }
        const sched = await AsyncStorage.getItem(SCHEDULE_KEY);
        if (sched) {
          const parsedSched = JSON.parse(sched) as ParkDaySchedule | null;
          if (parsedSched && Array.isArray(parsedSched.operating)) daySchedule = parsedSched;
        }
      } catch (e) {
        console.warn('[Shows] showtimes hydrate failed', e);
      } finally {
        hydrated = true;
      }
    })();
  }
  await hydratePromise;
}
