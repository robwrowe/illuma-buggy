/**
 * Show-time phone-direct BLE capture automation — independent of board connection.
 */

import { useEffect, useRef, useCallback } from 'react';
import { getEntityLiveData, extractShowtimes } from '../services/themeParksApi';
import { useAppStore } from '../stores/store';
import { buildUpcomingShows, type UpcomingShow } from './useParkShows';
import { startPhoneBleScan } from '../utils/phoneBleScan';
import type { ParkConfig } from '../utils/configMigration';

const POLL_MS = 15 * 60 * 1000;
const STATUS_TICK_MS = 15_000;

export function useCaptureAutomation() {
  const autoShowIdRef = useRef<string | null>(null);
  const unsubScanRef = useRef<(() => void) | null>(null);
  const lastRawRef = useRef<{ id: string; name: string; showtimes: string[] }[]>([]);

  const activeParkRef = useRef(useAppStore.getState().activePark);
  const bindingsRef = useRef(useAppStore.getState().showBindings);
  const settingsRef = useRef(useAppStore.getState().showSettings);
  const overridesRef = useRef(useAppStore.getState().showInstanceOverrides);
  const activeZoneIdsRef = useRef(useAppStore.getState().activeZoneIds);

  useEffect(() => {
    return useAppStore.subscribe((state) => {
      activeParkRef.current = state.activePark;
      bindingsRef.current = state.showBindings;
      settingsRef.current = state.showSettings;
      overridesRef.current = state.showInstanceOverrides;
      activeZoneIdsRef.current = state.activeZoneIds;
    });
  }, []);

  const stopAutoCapture = useCallback((reason: string) => {
    if (unsubScanRef.current) {
      unsubScanRef.current();
      unsubScanRef.current = null;
    }
    autoShowIdRef.current = null;
    if (useAppStore.getState().bleCaptureActive) {
      useAppStore.getState().stopBleCapture(reason);
    }
  }, []);

  const startAutoCapture = useCallback((show: UpcomingShow) => {
    const store = useAppStore.getState();
    store.setBleCaptureDraftName(`${show.name} (auto)`);
    store.startBleCapture();
    autoShowIdRef.current = show.id;
    unsubScanRef.current = startPhoneBleScan((pkt) => {
      store.appendBleCapturePacket({
        boardTs: Date.now(),
        tag: pkt.tag,
        rssi: pkt.rssi,
        hex: pkt.hex,
        len: pkt.len,
        deviceId: pkt.deviceId,
      });
    });
  }, []);

  const evaluate = useCallback((upcoming: UpcomingShow[]) => {
    const settings = settingsRef.current;
    if (!settings.autoCaptureEnabled) {
      if (autoShowIdRef.current) stopAutoCapture('auto-capture-disabled');
      return;
    }

    const now = Date.now();
    const leadMs = settings.autoCaptureLeadSec * 1000;
    const tailMs = settings.autoCaptureTailSec * 1000;

    if (autoShowIdRef.current) {
      if (!useAppStore.getState().bleCaptureActive) {
        if (unsubScanRef.current) {
          unsubScanRef.current();
          unsubScanRef.current = null;
        }
        autoShowIdRef.current = null;
        return;
      }

      const show = upcoming.find(s => s.id === autoShowIdRef.current);
      if (!show || !show.inScope) {
        stopAutoCapture('show-window-closed');
        return;
      }
      const windowStart = show.startMs - leadMs;
      const windowEnd = show.endMs + tailMs;
      if (now < windowStart || now > windowEnd) {
        stopAutoCapture('show-window-closed');
      }
      return;
    }

    if (useAppStore.getState().bleCaptureActive) return;

    for (const show of upcoming) {
      if (!show.inScope) continue;
      const windowStart = show.startMs - leadMs;
      const windowEnd = show.endMs + tailMs;
      if (now >= windowStart && now <= windowEnd) {
        startAutoCapture(show);
        break;
      }
    }
  }, [startAutoCapture, stopAutoCapture]);

  const recomputeFromCache = useCallback(() => {
    const park = activeParkRef.current;
    const parkId = park?.id;
    if (!parkId || lastRawRef.current.length === 0) return;
    const upcoming = buildUpcomingShows(
      lastRawRef.current,
      bindingsRef.current,
      parkId,
      settingsRef.current,
      overridesRef.current,
      Date.now(),
      activeZoneIdsRef.current,
    );
    evaluate(upcoming);
  }, [evaluate]);

  const refresh = useCallback(async () => {
    const park: ParkConfig | null = activeParkRef.current;
    const entityId = park?.themeParksApiEntityId;
    const parkId = park?.id;
    if (!entityId || !parkId) {
      lastRawRef.current = [];
      return;
    }
    try {
      const data = await getEntityLiveData(entityId);
      const raw = extractShowtimes(data.liveData || []);
      lastRawRef.current = raw;
      const upcoming = buildUpcomingShows(
        raw,
        bindingsRef.current,
        parkId,
        settingsRef.current,
        overridesRef.current,
        Date.now(),
        activeZoneIdsRef.current,
      );
      evaluate(upcoming);
    } catch {
      // Leave in-progress auto-capture running on transient network failure
    }
  }, [evaluate]);

  useEffect(() => {
    return useAppStore.subscribe((state, prev) => {
      if (prev.bleCaptureActive && !state.bleCaptureActive && autoShowIdRef.current) {
        if (unsubScanRef.current) {
          unsubScanRef.current();
          unsubScanRef.current = null;
        }
        autoShowIdRef.current = null;
      }
    });
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, POLL_MS);
    const statusTick = setInterval(recomputeFromCache, STATUS_TICK_MS);
    const unsubStore = useAppStore.subscribe((state, prev) => {
      if (state.showInstanceOverrides !== prev.showInstanceOverrides
        || state.showBindings !== prev.showBindings
        || state.activeZoneIds !== prev.activeZoneIds
        || state.activePark !== prev.activePark
        || state.showSettings !== prev.showSettings) {
        recomputeFromCache();
      }
    });
    return () => {
      clearInterval(poll);
      clearInterval(statusTick);
      unsubStore();
      if (unsubScanRef.current) {
        unsubScanRef.current();
        unsubScanRef.current = null;
      }
    };
  }, [refresh, recomputeFromCache]);
}
