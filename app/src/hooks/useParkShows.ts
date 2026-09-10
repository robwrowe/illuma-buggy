/**
 * Theme park live showtimes + per-binding auto pre/live/post triggers.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { ParkConfig } from '../utils/configMigration';
import { getEntityLiveData, extractShowtimes } from '../services/themeParksApi';
import { useAppStore } from '../stores/store';
import {
  bindingForEntity,
  showBindingInScope,
  isAutoPrePostDisabled,
  isAutoLiveDisabled,
  shouldScheduleProtectZones,
  type ParkShowBinding,
  type ShowSettings,
  type ShowInstanceOverride,
} from '../utils/showBindings';
import { runShowPhase, stopShowMode } from '../services/showControl';
import { bleService } from '../services/BLEService';
import { setParkShowtimesCache } from '../services/parkShowtimesCache';

const POLL_MS = 15 * 60 * 1000;
const STATUS_TICK_MS = 30_000;

export type ShowStatus = 'upcoming' | 'pre' | 'live' | 'ended';

export interface UpcomingShow {
  id: string;
  entityId: string;
  name: string;
  startMs: number;
  endMs: number;
  status: ShowStatus;
  minutesUntil: number;
  kind: 'parade' | 'fireworks';
  binding: ParkShowBinding;
  autoPrePostDisabled: boolean;
  autoLiveDisabled: boolean;
  inScope: boolean;
  durationSec: number;
}

function parseShowStart(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

export function buildUpcomingShows(
  raw: { id: string; name: string; showtimes: string[] }[],
  bindings: ParkShowBinding[],
  parkId: string,
  settings: ShowSettings,
  overrides: Record<string, ShowInstanceOverride>,
  now: number,
  activeZoneIds: string[],
): UpcomingShow[] {
  const out: UpcomingShow[] = [];
  for (const entity of raw) {
    const binding = bindingForEntity(bindings, parkId, entity.id);
    if (!binding) continue;

    const visibleBeforeMs = binding.homeVisibleBeforeMin * 60_000;
    const visibleAfterMs = binding.homeVisibleAfterMin * 60_000;
    const preLeadMs = binding.preLeadSec * 1000;
    const liveAtMs = (startMs: number) => startMs + binding.liveOffsetSec * 1000;

    for (const iso of entity.showtimes) {
      const startMs = parseShowStart(iso);
      if (!Number.isFinite(startMs)) continue;
      const endMs = startMs + binding.durationSec * 1000;
      const liveMs = liveAtMs(startMs);
      const windowStart = startMs - visibleBeforeMs;
      const windowEnd = endMs + visibleAfterMs;
      if (now < windowStart || now > windowEnd) continue;

      let status: ShowStatus = 'upcoming';
      if (now >= endMs) status = 'ended';
      else if (now >= liveMs) status = 'live';
      else if (now >= startMs - preLeadMs) status = 'pre';

      const instanceId = `${entity.id}-${startMs}`;
      const instanceOverride = overrides[instanceId];
      const inScope = showBindingInScope(binding, parkId, activeZoneIds);

      out.push({
        id: instanceId,
        entityId: entity.id,
        name: binding.name || entity.name,
        startMs,
        endMs,
        status,
        minutesUntil: Math.round((startMs - now) / 60000),
        kind: binding.kind,
        binding,
        autoPrePostDisabled: isAutoPrePostDisabled(binding, instanceOverride),
        autoLiveDisabled: isAutoLiveDisabled(binding, instanceOverride),
        inScope,
        durationSec: binding.durationSec,
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
  const lastRawRef = useRef<{ id: string; name: string; showtimes: string[] }[]>([]);

  const bindingsRef = useRef(useAppStore.getState().showBindings);
  const settingsRef = useRef(useAppStore.getState().showSettings);
  const overridesRef = useRef(useAppStore.getState().showInstanceOverrides);
  const presetsRef = useRef(useAppStore.getState().presets);
  const recallRef = useRef(useAppStore.getState().recallState);
  const layoutsRef = useRef(useAppStore.getState().customSegmentLayouts);
  const fadeMsRef = useRef(useAppStore.getState().bleEffectTransitionMs);
  const activeZoneIdsRef = useRef(useAppStore.getState().activeZoneIds);

  useEffect(() => {
    return useAppStore.subscribe((state) => {
      bindingsRef.current = state.showBindings;
      settingsRef.current = state.showSettings;
      overridesRef.current = state.showInstanceOverrides;
      presetsRef.current = state.presets;
      recallRef.current = state.recallState;
      layoutsRef.current = state.customSegmentLayouts;
      fadeMsRef.current = state.bleEffectTransitionMs;
      activeZoneIdsRef.current = state.activeZoneIds;
    });
  }, []);

  const recomputeFromCache = useCallback(() => {
    const parkId = activePark?.id;
    if (!parkId || lastRawRef.current.length === 0) {
      useAppStore.getState().setShowProtectsZones(false);
      return [];
    }
    const now = Date.now();
    const upcoming = buildUpcomingShows(
      lastRawRef.current,
      bindingsRef.current,
      parkId,
      settingsRef.current,
      overridesRef.current,
      now,
      activeZoneIdsRef.current,
    );
    const protect = upcoming.some(shouldScheduleProtectZones);
    useAppStore.getState().setShowProtectsZones(protect);
    setShows(upcoming);
    return upcoming;
  }, [activePark?.id]);

  const runShowAutomation = useCallback(async (upcoming: UpcomingShow[]) => {
    if (!isConnected || !bleService.isSessionReady()) return;
    const now = Date.now();
    for (const show of upcoming) {
      if (!show.inScope) continue;
      const preKey = `${show.id}:pre`;
      const liveKey = `${show.id}:live`;
      const postKey = `${show.id}:post`;
      const exitKey = `${show.id}:exit`;
      const postAt = show.endMs + show.binding.postDelaySec * 1000;

      if (!show.autoPrePostDisabled && show.status === 'pre' && !autoFiredRef.current.has(preKey)) {
        autoFiredRef.current.add(preKey);
        void runShowPhase(
          show.binding, 'pre',
          presetsRef.current, recallRef.current, layoutsRef.current, fadeMsRef.current,
        );
      }
      const runLive = !show.autoLiveDisabled;
      if (runLive && show.status === 'live' && !autoFiredRef.current.has(liveKey)) {
        autoFiredRef.current.add(liveKey);
        void runShowPhase(
          show.binding, 'live',
          presetsRef.current, recallRef.current, layoutsRef.current, fadeMsRef.current,
        );
      }
      if (!show.autoPrePostDisabled && now >= postAt && show.status === 'ended' && !autoFiredRef.current.has(postKey)) {
        autoFiredRef.current.add(postKey);
        const ran = await runShowPhase(
          show.binding, 'post',
          presetsRef.current, recallRef.current, layoutsRef.current, fadeMsRef.current,
        );
        if (ran && !autoFiredRef.current.has(exitKey)) {
          autoFiredRef.current.add(exitKey);
          void stopShowMode();
        }
      }
    }
  }, [isConnected]);

  const refresh = useCallback(async () => {
    const entityId = activePark?.themeParksApiEntityId;
    const parkId = activePark?.id;
    if (!entityId || !parkId) {
      setShows([]);
      setFetchError(null);
      lastRawRef.current = [];
      setParkShowtimesCache([], null);
      useAppStore.getState().setShowProtectsZones(false);
      return;
    }
    try {
      const data = await getEntityLiveData(entityId);
      const raw = extractShowtimes(data.liveData || []);
      lastRawRef.current = raw;
      setParkShowtimesCache(raw, entityId);
      const now = Date.now();
      const upcoming = buildUpcomingShows(
        raw,
        bindingsRef.current,
        parkId,
        settingsRef.current,
        overridesRef.current,
        now,
        activeZoneIdsRef.current,
      );
      const protect = upcoming.some(shouldScheduleProtectZones);
      useAppStore.getState().setShowProtectsZones(protect);
      setShows(upcoming);
      setLastFetchAt(now);
      setFetchError(null);

      void runShowAutomation(upcoming);
    } catch {
      setFetchError('Showtimes unavailable');
    }
  }, [activePark?.themeParksApiEntityId, activePark?.id, runShowAutomation]);

  useEffect(() => {
    autoFiredRef.current.clear();
    refresh();
    const poll = setInterval(refresh, POLL_MS);
    const statusTick = setInterval(() => {
      const upcoming = recomputeFromCache();
      if (upcoming.length) void runShowAutomation(upcoming);
    }, STATUS_TICK_MS);
    const unsubReady = bleService.onSessionReady(() => refresh());
  const unsubStore = useAppStore.subscribe((state, prev) => {
      if (state.showInstanceOverrides !== prev.showInstanceOverrides
        || state.showBindings !== prev.showBindings
        || state.activeZoneIds !== prev.activeZoneIds) {
        recomputeFromCache();
      }
    });
    return () => {
      clearInterval(poll);
      clearInterval(statusTick);
      unsubReady();
      unsubStore();
    };
  }, [refresh, recomputeFromCache, runShowAutomation]);

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
