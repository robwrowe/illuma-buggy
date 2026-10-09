/**
 * Edge-triggered cue look. Runs on the same tick as show automation.
 * A winning cue outranks legacy pre/live/post. Release hands the strip back
 * and forces a zone re-evaluation.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '../stores/store';
import { bleService } from './BLEService';
import { getParkShowtimesCache, getParkDaySchedule } from './parkShowtimesCache';
import { applyShowCue, stopShowMode } from './showControl';
import {
  expandCueOccurrences,
  parkDateString,
  resolveActiveCue,
  type CueOccurrence,
  type CueShowInstance,
  type ShowCue,
} from '../utils/showCues';
import { processLocationUpdate } from '../utils/zoneLocationCore';

const LAST_KEY = 'illuma-cue-last-key';
const DWELL_MS = 3000;

let lastKey: string | null = null;
let lastApplyAt = 0;
let candidateKey: string | null = null;
let candidateSince = 0;
let hydrated = false;
let wasReady = false;
let lastOnEnd: 'release' | 'hold' = 'release';

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(LAST_KEY);
    if (raw) lastKey = raw;
  } catch (e) {
    console.warn('[Cues] last-key hydrate failed', e);
  }
}

function persist(key: string | null): void {
  void AsyncStorage.setItem(LAST_KEY, key ?? '').catch((e) => console.warn('[Cues] last-key persist failed', e));
}

function buildInstances(parkId: string): CueShowInstance[] {
  const s = useAppStore.getState();
  const out: CueShowInstance[] = [];
  for (const entity of getParkShowtimesCache().raw) {
    const binding = s.showBindings.find((b) => b.parkId === parkId && b.entityId === entity.id);
    if (!binding) continue;
    for (const iso of entity.showtimes) {
      const startMs = Date.parse(iso);
      if (!Number.isFinite(startMs)) continue;
      out.push({
        id: `${entity.id}-${startMs}`,
        bindingId: binding.id,
        startMs,
        endMs: startMs + binding.durationSec * 1000,
        liveOffsetSec: binding.liveOffsetSec,
      });
    }
  }
  return out;
}

function chooseKey(
  winnerKey: string | null,
  winner: { occurrence: CueOccurrence } | null,
  occurrences: CueOccurrence[],
  now: number,
): string | null {
  let desired = winnerKey;
  const conditional = !!winner?.occurrence.conditional;
  if (conditional && desired && desired !== lastKey) {
    if (candidateKey !== desired) {
      candidateKey = desired;
      candidateSince = now;
    }
    if (now - candidateSince < DWELL_MS) desired = lastKey;
  } else {
    candidateKey = desired;
    candidateSince = now;
  }
  if (lastKey && desired !== lastKey && now - lastApplyAt < DWELL_MS) {
    const prev = occurrences.find((o) => o.key === lastKey);
    const ended = !prev || now >= prev.endMs;
    if (!ended) desired = lastKey;
  }
  return desired;
}

/** Returns true while a cue owns the look, so legacy phases stay quiet. */
export async function cueExecutorTick(now = Date.now()): Promise<boolean> {
  await hydrate();
  const s = useAppStore.getState();
  const park = s.activePark;
  if (!park) {
    s.setActiveCue(null);
    return false;
  }
  const tz = park.timezone || 'America/New_York';
  const cues = (s.cues ?? []).filter((c) => c.parkId === park.id && c.enabled);
  const instances = buildInstances(park.id);
  const ctx = {
    now,
    parkTz: tz,
    showInstances: instances,
    schedule: getParkDaySchedule(parkDateString(now, tz)),
    instanceOverrides: s.showInstanceOverrides,
    cueMaxHoldSec: s.showSettings.cueMaxHoldSec ?? 900,
    showsWithShowtimes: [...new Set(instances.map((i) => i.bindingId))],
    activeZoneIds: s.activeZoneIds,
  };
  const occurrences = cues.flatMap((cue, index) => expandCueOccurrences(cue, ctx, index));
  const winner = resolveActiveCue(occurrences, cues, now, ctx);
  const desired = chooseKey(winner?.occurrence.key ?? null, winner, occurrences, now);
  const holding = occurrences.find((o) => o.key === desired);
  const holdingCue = holding ? cues.find((c) => c.id === holding.cueId) ?? null : null;

  if (holding && holdingCue) {
    const remain = Math.max(0, Math.round((holding.endMs - now) / 1000));
    s.setActiveCue({ id: holdingCue.id, label: holdingCue.label, endsAt: holding.endMs, remainSec: remain });
  } else {
    s.setActiveCue(null);
  }

  const ready = bleService.isSessionReady();
  if (ready && !wasReady) lastKey = null;
  wasReady = ready;

  if (desired === lastKey) return !!holdingCue;

  if (!ready) return !!holdingCue;

  if (!holdingCue || !desired) {
    const release = lastOnEnd !== 'hold';
    lastKey = null;
    lastOnEnd = 'release';
    persist(null);
    if (release) {
      await stopShowMode();
      const loc = useAppStore.getState().userLocation;
      if (loc) processLocationUpdate(loc);
    }
    return false;
  }

  const ok = await applyShowCue(holdingCue);
  if (!ok) return !!holdingCue;
  lastKey = desired;
  lastApplyAt = now;
  lastOnEnd = holdingCue.onEnd;
  persist(desired);
  return true;
}

export async function testCueNow(cue: ShowCue): Promise<boolean> {
  return applyShowCue(cue);
}
