/**
 * Theme park live showtimes + optional auto fireworks triggers.
 * Best-effort — API failures are silent; manual Show Mode always available.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { ParkConfig } from '../utils/configMigration';
import { getEntityLiveData, extractShowtimes } from '../services/themeParksApi';
import { bleService } from '../services/BLEService';

const POLL_MS = 15 * 60 * 1000;
const DISPLAY_WINDOW_MS = 60 * 60 * 1000;
const AUTO_PRE_MS = 15 * 60 * 1000;
const DEFAULT_SHOW_MS = 20 * 60 * 1000;

export type ShowStatus = 'upcoming' | 'pre' | 'live' | 'ended';

export interface UpcomingShow {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
  status: ShowStatus;
  minutesUntil: number;
  isFireworks: boolean;
}

function isFireworksShow(name: string): boolean {
  return /firework|happily ever after|enchantment|celebrat/i.test(name);
}

function parseShowStart(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

function buildUpcomingShows(
  raw: { id: string; name: string; showtimes: string[] }[],
  now: number,
): UpcomingShow[] {
  const out: UpcomingShow[] = [];
  for (const entity of raw) {
    const fireworks = isFireworksShow(entity.name);
    for (const iso of entity.showtimes) {
      const startMs = parseShowStart(iso);
      if (!Number.isFinite(startMs)) continue;
      const endMs = startMs + DEFAULT_SHOW_MS;
      const diff = startMs - now;
      if (Math.abs(diff) > DISPLAY_WINDOW_MS && now > endMs + DISPLAY_WINDOW_MS) continue;

      let status: ShowStatus = 'upcoming';
      if (now >= endMs) status = 'ended';
      else if (now >= startMs) status = 'live';
      else if (now >= startMs - AUTO_PRE_MS) status = 'pre';

      out.push({
        id: `${entity.id}-${startMs}`,
        name: entity.name,
        startMs,
        endMs,
        status,
        minutesUntil: Math.round(diff / 60000),
        isFireworks: fireworks,
      });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

export function useParkShows(activePark: ParkConfig | null, isConnected: boolean) {
  const [shows, setShows] = useState<UpcomingShow[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const autoFiredRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const entityId = activePark?.themeParksApiEntityId;
    if (!entityId) {
      setShows([]);
      setFetchError(null);
      return;
    }
    try {
      const data = await getEntityLiveData(entityId);
      const raw = extractShowtimes(data.liveData || []);
      const now = Date.now();
      const upcoming = buildUpcomingShows(raw, now);
      setShows(upcoming);
      setLastFetchAt(now);
      setFetchError(null);

      if (!isConnected) return;
      for (const show of upcoming) {
        if (!show.isFireworks) continue;
        const preKey = `${show.id}:pre`;
        const blackKey = `${show.id}:black`;
        const exitKey = `${show.id}:exit`;

        if (show.status === 'pre' && !autoFiredRef.current.has(preKey)) {
          autoFiredRef.current.add(preKey);
          bleService.sendShowModeEnter('fireworks', 'pre');
        }
        if (show.status === 'live' && !autoFiredRef.current.has(blackKey)) {
          autoFiredRef.current.add(blackKey);
          bleService.sendShowModeEnter('fireworks', 'black');
        }
        if (show.status === 'ended' && !autoFiredRef.current.has(exitKey)) {
          autoFiredRef.current.add(exitKey);
          bleService.sendShowModeExit();
        }
      }
    } catch {
      setFetchError('Showtimes unavailable');
    }
  }, [activePark?.themeParksApiEntityId, isConnected]);

  useEffect(() => {
    autoFiredRef.current.clear();
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return { shows, fetchError, lastFetchAt, refresh };
}

function formatShowTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatShowStatus(show: UpcomingShow): string {
  if (show.status === 'ended') {
    const ago = Math.abs(Math.round((Date.now() - show.endMs) / 60000));
    return ago < 60 ? `Ended ${ago}m ago` : 'Ended';
  }
  if (show.status === 'live') return 'In progress';
  if (show.status === 'pre') return `Starts in ${Math.max(0, show.minutesUntil)}m`;
  if (show.minutesUntil <= 0) return 'Starting soon';
  return `In ${show.minutesUntil}m · ${formatShowTime(show.startMs)}`;
}
