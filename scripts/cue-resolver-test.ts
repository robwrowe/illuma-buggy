/**
 * Shared cue vectors. Both the app and web copies of the engine must agree.
 *   node web/node_modules/tsx/dist/cli.mjs scripts/cue-resolver-test.ts
 */
import { readFileSync } from 'node:fs';
import * as appEngine from '../app/src/utils/showCues';
import * as webEngine from '../web/src/lib/cues';

type Engine = typeof appEngine;

function ms(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) throw new Error(`bad iso ${iso}`);
  return t;
}

function buildCtx(vec: any, engine: Engine) {
  const now = ms(vec.now);
  const instances = (vec.instances ?? []).map((inst: any) => ({
    id: inst.id,
    bindingId: inst.bindingId,
    startMs: ms(inst.start),
    endMs: ms(inst.start) + inst.durationSec * 1000,
    liveOffsetSec: inst.liveOffsetSec ?? 0,
  }));
  const overrides: Record<string, { cuesDisabled?: boolean; endAtMs?: number }> = {};
  for (const [id, ov] of Object.entries(vec.overrides ?? {})) {
    const raw = ov as { cuesDisabled?: boolean; endAtMs?: string };
    overrides[id] = {
      ...(raw.cuesDisabled != null ? { cuesDisabled: raw.cuesDisabled } : {}),
      ...(raw.endAtMs ? { endAtMs: ms(raw.endAtMs) } : {}),
    };
  }
  let schedule = null;
  if (vec.schedule) {
    schedule = {
      date: vec.schedule.date,
      operating: vec.schedule.operating.map((w: any) => ({ openMs: ms(w.open), closeMs: ms(w.close) })),
      ticketed: vec.schedule.ticketed.map((w: any) => ({
        kind: w.kind,
        openMs: ms(w.open),
        closeMs: ms(w.close),
      })),
    };
  }
  return {
    now,
    parkTz: vec.tz,
    showInstances: instances,
    schedule,
    instanceOverrides: overrides,
    cueMaxHoldSec: vec.maxHoldSec ?? engine.DEFAULT_CUE_MAX_HOLD_SEC,
    showsWithShowtimes: instances.map((i: { bindingId: string }) => i.bindingId),
    activeZoneIds: vec.zones ?? [],
  };
}

function run(engine: Engine, vectors: any[]) {
  const results: string[] = [];
  for (const vec of vectors) {
    if (vec.normalize) {
      const cue = engine.normalizeShowCue(vec.normalize);
      if (!cue) throw new Error(`${vec.name}: normalize returned null`);
      if (cue.onEnd !== vec.expectOnEnd) throw new Error(`${vec.name}: onEnd ${cue.onEnd}`);
      if (cue.toSec !== vec.expectToSec) throw new Error(`${vec.name}: toSec ${cue.toSec}`);
      if (cue.priority !== vec.expectPriority) throw new Error(`${vec.name}: priority ${cue.priority}`);
      results.push(`${vec.name}:ok`);
      continue;
    }
    const rawCues = vec.cues ?? [vec.cue];
    const cues = rawCues.map((c: unknown) => {
      const cue = engine.normalizeShowCue(c);
      if (!cue) throw new Error(`${vec.name}: bad cue`);
      return cue;
    });
    const ctx = buildCtx(vec, engine);
    const occurrences = cues.flatMap((cue, index) => engine.expandCueOccurrences(cue, ctx, index));
    if (vec.expectCount != null && occurrences.length !== vec.expectCount) {
      throw new Error(`${vec.name}: count ${occurrences.length} != ${vec.expectCount}`);
    }
    const winner = engine.resolveActiveCue(occurrences, cues, ctx.now, ctx);
    const got = winner?.cue.id ?? null;
    if (vec.expectActive !== undefined && got !== vec.expectActive) {
      throw new Error(`${vec.name}: active ${got} != ${vec.expectActive}`);
    }
    if (vec.expectStart && winner) {
      if (winner.occurrence.startMs !== ms(vec.expectStart)) {
        throw new Error(`${vec.name}: start ${new Date(winner.occurrence.startMs).toISOString()}`);
      }
    }
    if (vec.expectEnd && winner && winner.occurrence.endMs !== ms(vec.expectEnd)) {
      throw new Error(`${vec.name}: end ${new Date(winner.occurrence.endMs).toISOString()}`);
    }
    if (vec.expectAnchor && winner && winner.occurrence.anchorMs !== ms(vec.expectAnchor)) {
      throw new Error(`${vec.name}: anchor ${new Date(winner.occurrence.anchorMs).toISOString()}`);
    }
    results.push(`${vec.name}:${got ?? 'none'}:${occurrences.map((o) => o.key).join(',')}`);
  }
  return results;
}

const vectors = JSON.parse(readFileSync(new URL('./cue-vectors.json', import.meta.url), 'utf8'));
const a = run(appEngine, vectors);
const b = run(webEngine, vectors);
if (a.join('\n') !== b.join('\n')) {
  console.error('app/web cue engines diverged');
  console.error(a);
  console.error(b);
  process.exit(1);
}
console.log(`cue-resolver-test: ok (${a.length} vectors, app === web)`);
