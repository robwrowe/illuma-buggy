/**
 * Shared fetch wrapper. Logs AppState + network so a locked-phone repro can
 * distinguish "the call never started" from "it started and never finished".
 * Timeouts use AbortController. A location-task tick can abort anything past
 * its deadline even when React Native has suspended JS timers.
 */

import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

type InFlight = {
  controller: AbortController;
  deadline: number;
  tag: string;
};

const inFlight = new Set<InFlight>();
const extraSweeps: Array<(now: number) => void> = [];

export function registerDeadlineSweep(fn: (now: number) => void): void {
  extraSweeps.push(fn);
}

/** Abort in-flight restFetch calls (and any registered deadline hooks) past `now`. */
export function sweepStaleRequests(now = Date.now()): void {
  for (const entry of inFlight) {
    if (now >= entry.deadline && !entry.controller.signal.aborted) {
      console.log('[REST] sweep abort', entry.tag);
      entry.controller.abort();
    }
  }
  for (const fn of extraSweeps) {
    try {
      fn(now);
    } catch (e) {
      console.warn('[REST] sweep hook failed', e);
    }
  }
}

export async function restFetch(
  tag: string,
  url: string,
  init: RequestInit = {},
  opts?: { timeoutMs?: number },
): Promise<Response> {
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const entry: InFlight = { controller, deadline: Date.now() + timeoutMs, tag };
  inFlight.add(entry);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (init.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const started = Date.now();
  let netType = 'unknown';
  let reachable: boolean | null = null;
  try {
    const net = await NetInfo.fetch();
    netType = net.type;
    reachable = net.isInternetReachable;
  } catch {
    // NetInfo itself failing is useful only as "unknown".
  }
  console.log('[REST] start', tag, {
    appState: AppState.currentState,
    net: netType,
    reachable,
    url,
    timeoutMs,
  });

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    console.log('[REST] ok', tag, {
      status: res.status,
      ms: Date.now() - started,
      appState: AppState.currentState,
      net: netType,
      reachable,
    });
    return res;
  } catch (e) {
    const name = e instanceof Error ? e.name : 'Error';
    const message = e instanceof Error ? e.message : String(e);
    console.log('[REST] fail', tag, {
      name,
      message,
      ms: Date.now() - started,
      appState: AppState.currentState,
      net: netType,
      reachable,
    });
    throw e;
  } finally {
    clearTimeout(timer);
    inFlight.delete(entry);
  }
}
