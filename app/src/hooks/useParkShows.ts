/**
 * Theme park live showtimes + per-binding auto pre/live/post triggers.
 */

import { useEffect, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import type { ParkConfig } from '../utils/configMigration';
import { useAppStore } from '../stores/store';
import { bleService } from '../services/BLEService';
import {
  computeUpcomingFromStore,
  getShowFetchAt,
  getShowFetchError,
  showAutomationTick,
} from '../services/showAutomation';

import type { ShowStatus, UpcomingShow } from '../services/showSchedule';

export type { ShowStatus, UpcomingShow } from '../services/showSchedule';
export { buildUpcomingShows } from '../services/showSchedule';

const POLL_MS = 15 * 60 * 1000;
const STATUS_TICK_MS = 30_000;

function publishUi(
  setShows: (shows: UpcomingShow[]) => void,
  setFetchError: (err: string | null) => void,
  setLastFetchAt: (at: number | null) => void,
  upcoming: UpcomingShow[],
) {
  setShows(upcoming);
  setFetchError(getShowFetchError());
  setLastFetchAt(getShowFetchAt());
}

export function useParkShows(activePark: ParkConfig | null, _isConnected: boolean) {
  const [shows, setShows] = useState<UpcomingShow[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const upcoming = await showAutomationTick({
      background: AppState.currentState !== 'active',
      forceRefresh: true,
    });
    publishUi(setShows, setFetchError, setLastFetchAt, upcoming);
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => { void refresh(); }, POLL_MS);
    const statusTick = setInterval(() => {
      void showAutomationTick({ background: AppState.currentState !== 'active' }).then((upcoming) => {
        publishUi(setShows, setFetchError, setLastFetchAt, upcoming);
      });
    }, STATUS_TICK_MS);
    const unsubReady = bleService.onSessionReady(() => { void refresh(); });
    const unsubStore = useAppStore.subscribe((state, prev) => {
      if (state.showInstanceOverrides !== prev.showInstanceOverrides
        || state.showBindings !== prev.showBindings
        || state.activeZoneIds !== prev.activeZoneIds
        || state.activePark !== prev.activePark) {
        publishUi(setShows, setFetchError, setLastFetchAt, computeUpcomingFromStore());
      }
    });
    return () => {
      clearInterval(poll);
      clearInterval(statusTick);
      unsubReady();
      unsubStore();
    };
  }, [refresh, activePark?.id, activePark?.themeParksApiEntityId]);

  return { shows, fetchError, lastFetchAt, refresh };
}

const FIVE_MIN_MS = 5 * 60 * 1000;

function formatShowTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Wall-clock time with seconds, e.g. "8:55:00 PM". */
export function formatClockHms(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Remaining-time label. Minutes when ≥ 5 min left; M:SS (or H:MM:SS) below that.
 */
export function formatCountdown(remainingMs: number): string {
  const ms = Math.max(0, remainingMs);
  if (ms >= FIVE_MIN_MS) return `${Math.round(ms / 60000)}m`;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

export function showPreStartMs(show: UpcomingShow): number {
  return show.startMs - show.binding.preLeadSec * 1000;
}

/** When post is applied and show mode exits. */
export function showPostEndMs(show: UpcomingShow): number {
  return show.endMs + show.binding.postDelaySec * 1000;
}

function liveAtMs(show: UpcomingShow): number {
  return show.startMs + show.binding.liveOffsetSec * 1000;
}

function statusAt(show: UpcomingShow, now: number): ShowStatus {
  if (now >= show.endMs) return 'ended';
  if (now >= liveAtMs(show)) return 'live';
  if (now >= showPreStartMs(show)) return 'pre';
  return 'upcoming';
}

function formatDurationLabel(durationSec: number): string {
  if (durationSec >= 60 && durationSec % 60 === 0) return `${durationSec / 60}m`;
  if (durationSec >= 60) return `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;
  return `${durationSec}s`;
}

export function formatShowStatus(show: UpcomingShow, now = Date.now()): string {
  if (!show.inScope) return 'Outside show area';
  const status = statusAt(show, now);
  if (status === 'ended') {
    const ago = Math.abs(Math.round((now - show.endMs) / 60000));
    return ago < 60 ? `Ended ${ago}m ago` : 'Ended';
  }
  if (status === 'live') {
    const left = Math.max(0, show.endMs - now);
    return `In progress · ${formatCountdown(left)} left · ends ${formatShowTime(show.endMs)}`;
  }
  const dur = formatDurationLabel(show.durationSec);
  const untilStart = show.startMs - now;
  if (status === 'pre') {
    return `Pre-show · starts in ${formatCountdown(Math.max(0, untilStart))} · ${dur} show`;
  }
  if (untilStart <= 0) return `Starting soon · ${dur} show`;
  return `In ${formatCountdown(untilStart)} · ${formatShowTime(show.startMs)} · ${dur}`;
}

/** Countdown until pre-show (lights enter SHOW_MODE), or "In show mode" once it has. */
export function formatShowModeCountdown(show: UpcomingShow, now = Date.now()): string | null {
  const remaining = showPreStartMs(show) - now;
  if (remaining > 0) return `Show mode in ${formatCountdown(remaining)}`;
  if (now < showPostEndMs(show)) return 'In show mode';
  return null;
}
