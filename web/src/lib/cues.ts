/**
 * Park-level cue timeline. Pure: no store, no BLE.
 * A cue is an anchor plus a T+/T- window, optional conditions, and an action.
 * Keep this file in sync with app/src/utils/showCues.ts.
 */

export const DEFAULT_CUE_MAX_HOLD_SEC = 900;
const FTB_FADE_SEC_MAX = 600;

export type CuePoint = 'start' | 'live' | 'end';

export type CueAnchor =
  | { type: 'show'; bindingId: string; point: CuePoint }
  | { type: 'clock'; time: string; days?: number[]; date?: string }
  | { type: 'parkClose'; which?: 'latest' | 'regular' | 'event' }
  | { type: 'parkOpen'; which?: 'earliest' | 'regular' | 'earlyEntry' | 'event' };

export type CueAction =
  | { type: 'preset'; presetId: string }
  | { type: 'black'; fadeSec?: number | null };

export type CueCondition =
  | { type: 'zone'; zoneIds: string[]; match: 'inside' | 'outside' }
  | { type: 'showPresent'; bindingId: string; present: boolean }
  | { type: 'ticketedEvent'; present: boolean };

export interface ShowCue {
  id: string;
  parkId: string;
  label: string;
  enabled: boolean;
  anchor: CueAnchor;
  fromSec: number;
  toSec: number | null;
  conditions: CueCondition[];
  priority: number;
  action: CueAction;
  onEnd: 'release' | 'hold';
}

export interface ScheduleWindow {
  openMs: number;
  closeMs: number;
}

export interface TicketedWindow extends ScheduleWindow {
  kind: 'earlyEntry' | 'event';
}

export interface ParkDaySchedule {
  date: string;
  operating: ScheduleWindow[];
  ticketed: TicketedWindow[];
}

export interface CueShowInstance {
  id: string;
  bindingId: string;
  startMs: number;
  endMs: number;
  liveOffsetSec: number;
}

export interface CueInstanceOverride {
  cuesDisabled?: boolean;
  endAtMs?: number;
}

export interface CueExpandContext {
  now: number;
  parkTz: string;
  showInstances: CueShowInstance[];
  schedule: ParkDaySchedule | null;
  instanceOverrides: Record<string, CueInstanceOverride>;
  cueMaxHoldSec: number;
  /** Binding ids that have at least one showtime today. */
  showsWithShowtimes: string[];
}

export interface CueOccurrence {
  key: string;
  cueId: string;
  startMs: number;
  endMs: number;
  anchorMs: number;
  priority: number;
  conditional: boolean;
  index: number;
  onEnd: 'release' | 'hold';
}

const WEEKDAY: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export function parkParts(ms: number, timeZone: string): {
  y: number; m: number; d: number; hh: number; mm: number; ss: number; weekday: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    y: Number(bag.year),
    m: Number(bag.month),
    d: Number(bag.day),
    hh: hour,
    mm: Number(bag.minute),
    ss: Number(bag.second),
    weekday: WEEKDAY[bag.weekday] ?? 0,
  };
}

export function parkDateString(ms: number, timeZone: string): string {
  const p = parkParts(ms, timeZone);
  const mm = String(p.m).padStart(2, '0');
  const dd = String(p.d).padStart(2, '0');
  return `${p.y}-${mm}-${dd}`;
}

/** Wall-clock time in `timeZone` → UTC epoch ms. */
export function zonedWallToUtc(
  y: number, m: number, d: number, hh: number, mm: number, timeZone: string,
): number {
  const want = Date.UTC(y, m - 1, d, hh, mm, 0);
  let utc = want;
  for (let i = 0; i < 3; i++) {
    const p = parkParts(utc, timeZone || 'UTC');
    const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
    const next = want - (asIfUtc - utc);
    if (next === utc) break;
    utc = next;
  }
  return utc;
}

function addDays(y: number, m: number, d: number, delta: number): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function isHhmm(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function clampFade(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(FTB_FADE_SEC_MAX, n);
}

function normalizeAnchor(raw: unknown): CueAnchor | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (a.type === 'show') {
    const point = a.point === 'live' || a.point === 'end' ? a.point : a.point === 'start' ? 'start' : null;
    if (!point || typeof a.bindingId !== 'string' || !a.bindingId) return null;
    return { type: 'show', bindingId: a.bindingId, point };
  }
  if (a.type === 'clock') {
    if (typeof a.time !== 'string' || !isHhmm(a.time)) return null;
    const days = Array.isArray(a.days)
      ? a.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
      : undefined;
    const date = typeof a.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : undefined;
    return { type: 'clock', time: a.time, ...(days && days.length ? { days } : {}), ...(date ? { date } : {}) };
  }
  if (a.type === 'parkClose') {
    const which = a.which === 'regular' || a.which === 'event' ? a.which : 'latest';
    return { type: 'parkClose', which };
  }
  if (a.type === 'parkOpen') {
    const which = a.which === 'regular' || a.which === 'earlyEntry' || a.which === 'event'
      ? a.which
      : 'earliest';
    return { type: 'parkOpen', which };
  }
  return null;
}

function normalizeConditions(raw: unknown): CueCondition[] {
  if (!Array.isArray(raw)) return [];
  const out: CueCondition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    if (c.type === 'zone' && (c.match === 'inside' || c.match === 'outside')) {
      const zoneIds = Array.isArray(c.zoneIds) ? c.zoneIds.filter((id): id is string => typeof id === 'string' && !!id) : [];
      out.push({ type: 'zone', zoneIds, match: c.match });
    } else if (c.type === 'showPresent' && typeof c.bindingId === 'string') {
      out.push({ type: 'showPresent', bindingId: c.bindingId, present: c.present !== false });
    } else if (c.type === 'ticketedEvent') {
      out.push({ type: 'ticketedEvent', present: c.present !== false });
    }
  }
  return out;
}

export function normalizeShowCue(raw: unknown): ShowCue | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.parkId !== 'string' || !c.parkId) return null;
  const anchor = normalizeAnchor(c.anchor);
  if (!anchor) return null;
  const fromSec = Number(c.fromSec);
  if (!Number.isFinite(fromSec)) return null;
  let toSec: number | null = null;
  if (c.toSec != null && c.toSec !== '') {
    const n = Number(c.toSec);
    if (!Number.isFinite(n) || n <= fromSec) return null;
    toSec = n;
  }
  const actionRaw = c.action as Record<string, unknown> | undefined;
  let action: CueAction;
  if (actionRaw?.type === 'black') {
    action = { type: 'black', fadeSec: clampFade(actionRaw.fadeSec) };
  } else if (actionRaw?.type === 'preset' && typeof actionRaw.presetId === 'string' && actionRaw.presetId) {
    action = { type: 'preset', presetId: actionRaw.presetId };
  } else {
    return null;
  }
  const priority = Number.isFinite(Number(c.priority)) ? Number(c.priority) : 0;
  return {
    id: typeof c.id === 'string' && c.id ? c.id : `cue-${c.parkId}-${fromSec}`,
    parkId: c.parkId,
    label: typeof c.label === 'string' && c.label.trim() ? c.label.trim() : 'Cue',
    enabled: c.enabled !== false,
    anchor,
    fromSec,
    toSec,
    conditions: normalizeConditions(c.conditions),
    priority,
    action,
    onEnd: c.onEnd === 'hold' ? 'hold' : 'release',
  };
}

export function cueWarnings(
  cue: ShowCue,
  known: { bindingIds: string[]; zoneIds: string[]; presetIds: string[] },
): string[] {
  const warnings: string[] = [];
  if (cue.anchor.type === 'show' && !known.bindingIds.includes(cue.anchor.bindingId)) {
    warnings.push('Show binding is missing');
  }
  if (cue.action.type === 'preset' && !known.presetIds.includes(cue.action.presetId)) {
    warnings.push('Preset is missing');
  }
  for (const cond of cue.conditions) {
    if (cond.type === 'zone' && cond.zoneIds.some((id) => !known.zoneIds.includes(id))) {
      warnings.push('Zone is missing');
    }
    if (cond.type === 'showPresent' && !known.bindingIds.includes(cond.bindingId)) {
      warnings.push('Condition show is missing');
    }
  }
  if (cue.toSec == null) warnings.push('Open-ended — capped by the max hold');
  return warnings;
}

function windowFor(anchorMs: number, cue: ShowCue, maxHoldSec: number): { startMs: number; endMs: number } | null {
  const hold = cue.toSec ?? maxHoldSec;
  const startMs = anchorMs + cue.fromSec * 1000;
  const endMs = anchorMs + hold * 1000;
  if (!(endMs > startMs)) return null;
  return { startMs, endMs };
}

function pushOccurrence(
  out: CueOccurrence[],
  cue: ShowCue,
  index: number,
  anchorMs: number,
  key: string,
  maxHoldSec: number,
): void {
  const span = windowFor(anchorMs, cue, maxHoldSec);
  if (!span) return;
  out.push({
    key,
    cueId: cue.id,
    startMs: span.startMs,
    endMs: span.endMs,
    anchorMs,
    priority: cue.priority,
    conditional: cue.conditions.length > 0,
    index,
    onEnd: cue.onEnd,
  });
}

function clockAnchorMs(cue: ShowCue, day: { y: number; m: number; d: number; weekday: number }, tz: string): number | null {
  if (cue.anchor.type !== 'clock') return null;
  if (cue.anchor.date && cue.anchor.date !== `${day.y}-${String(day.m).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`) {
    return null;
  }
  if (cue.anchor.days && cue.anchor.days.length && !cue.anchor.days.includes(day.weekday)) return null;
  const [hh, mm] = cue.anchor.time.split(':').map(Number);
  return zonedWallToUtc(day.y, day.m, day.d, hh, mm, tz);
}

function scheduleInstant(schedule: ParkDaySchedule | null, anchor: CueAnchor): number | null {
  if (!schedule) return null;
  const operating = schedule.operating;
  const events = schedule.ticketed.filter((t) => t.kind === 'event');
  const early = schedule.ticketed.filter((t) => t.kind === 'earlyEntry');
  if (anchor.type === 'parkClose') {
    const which = anchor.which ?? 'latest';
    const pool = which === 'regular' ? operating : which === 'event' ? events : [...operating, ...events];
    if (!pool.length) return null;
    return Math.max(...pool.map((w) => w.closeMs));
  }
  if (anchor.type === 'parkOpen') {
    const which = anchor.which ?? 'earliest';
    const pool = which === 'regular' ? operating
      : which === 'earlyEntry' ? early
        : which === 'event' ? events
          : [...operating, ...early];
    if (!pool.length) return null;
    return Math.min(...pool.map((w) => w.openMs));
  }
  return null;
}

export function expandCueOccurrences(
  cue: ShowCue,
  ctx: CueExpandContext,
  index = 0,
): CueOccurrence[] {
  if (!cue.enabled) return [];
  const maxHold = ctx.cueMaxHoldSec > 0 ? ctx.cueMaxHoldSec : DEFAULT_CUE_MAX_HOLD_SEC;
  const out: CueOccurrence[] = [];
  const anchor = cue.anchor;

  if (anchor.type === 'show') {
    for (const inst of ctx.showInstances) {
      if (inst.bindingId !== anchor.bindingId) continue;
      const override = ctx.instanceOverrides[inst.id];
      if (override?.cuesDisabled) continue;
      let anchorMs = inst.startMs;
      if (anchor.point === 'live') anchorMs = inst.startMs + inst.liveOffsetSec * 1000;
      if (anchor.point === 'end') anchorMs = override?.endAtMs ?? inst.endMs;
      pushOccurrence(out, cue, index, anchorMs, `${cue.id}:${inst.id}:${anchorMs}`, maxHold);
    }
    return out;
  }

  if (anchor.type === 'clock') {
    const today = parkParts(ctx.now, ctx.parkTz);
    const days = [today, (() => {
      const prev = addDays(today.y, today.m, today.d, -1);
      const sample = zonedWallToUtc(prev.y, prev.m, prev.d, 12, 0, ctx.parkTz);
      return parkParts(sample, ctx.parkTz);
    })()];
    for (const day of days) {
      const anchorMs = clockAnchorMs(cue, day, ctx.parkTz);
      if (anchorMs == null) continue;
      pushOccurrence(out, cue, index, anchorMs, `${cue.id}:clock:${anchorMs}`, maxHold);
    }
    return out;
  }

  const instant = scheduleInstant(ctx.schedule, anchor);
  if (instant == null) return [];
  pushOccurrence(out, cue, index, instant, `${cue.id}:park:${instant}`, maxHold);
  return out;
}

export function conditionPasses(
  cue: ShowCue,
  ctx: Pick<CueExpandContext, 'schedule' | 'showsWithShowtimes'>,
  activeZoneIds: string[],
): boolean {
  for (const cond of cue.conditions) {
    if (cond.type === 'zone') {
      if (cond.zoneIds.length === 0) return false;
      const hit = cond.zoneIds.some((id) => activeZoneIds.includes(id));
      if (cond.match === 'inside' && !hit) return false;
      if (cond.match === 'outside' && hit) return false;
    } else if (cond.type === 'showPresent') {
      const has = ctx.showsWithShowtimes.includes(cond.bindingId);
      if (has !== cond.present) return false;
    } else if (cond.type === 'ticketedEvent') {
      const has = (ctx.schedule?.ticketed ?? []).some((t) => t.kind === 'event');
      if (has !== cond.present) return false;
    }
  }
  return true;
}

export function resolveActiveCue(
  occurrences: CueOccurrence[],
  cues: ShowCue[],
  now: number,
  ctx: Pick<CueExpandContext, 'schedule' | 'showsWithShowtimes'> & { activeZoneIds: string[] },
): { occurrence: CueOccurrence; cue: ShowCue } | null {
  const byId = new Map(cues.map((c) => [c.id, c]));
  const hits: { occurrence: CueOccurrence; cue: ShowCue }[] = [];
  for (const occurrence of occurrences) {
    if (now < occurrence.startMs || now >= occurrence.endMs) continue;
    const cue = byId.get(occurrence.cueId);
    if (!cue || !cue.enabled) continue;
    if (!conditionPasses(cue, ctx, ctx.activeZoneIds)) continue;
    hits.push({ occurrence, cue });
  }
  hits.sort((a, b) =>
    b.occurrence.priority - a.occurrence.priority
    || Number(b.occurrence.conditional) - Number(a.occurrence.conditional)
    || b.occurrence.startMs - a.occurrence.startMs
    || b.occurrence.index - a.occurrence.index);
  return hits[0] ?? null;
}

function fmtSec(sec: number): string {
  const n = Math.round(sec);
  return n < 0 ? `${n}s` : `+${n}s`;
}

export function describeCue(
  cue: ShowCue,
  names: { binding?: string; preset?: string; zones?: string[] } = {},
): string {
  const showName = names.binding || 'show';
  let when = '';
  if (cue.anchor.type === 'parkClose') when = 'at park close';
  else if (cue.anchor.type === 'parkOpen') when = 'at park open';
  else if (cue.anchor.type === 'clock') when = `at ${cue.anchor.time}`;
  else if (cue.fromSec < 0 && (cue.toSec == null || cue.toSec <= 0)) {
    when = `${Math.abs(Math.round(cue.fromSec))}s before ${showName} ${cue.anchor.point}`;
  } else {
    const end = cue.toSec == null ? 'until next' : fmtSec(cue.toSec);
    when = `${showName} ${cue.anchor.point} ${fmtSec(cue.fromSec)} → ${end}`;
  }
  if (cue.anchor.type !== 'show' && cue.toSec != null && cue.fromSec === 0) {
    const dur = cue.toSec - cue.fromSec;
    when = `${when}, for ${Math.round(dur)}s`;
  } else if (cue.anchor.type === 'show' && cue.fromSec < 0 && cue.toSec != null && cue.toSec <= 0) {
    when = `${when}, for ${Math.round(cue.toSec - cue.fromSec)}s`;
  }
  const zone = cue.conditions.find((c) => c.type === 'zone');
  if (zone && zone.type === 'zone') {
    const label = (names.zones && names.zones.length ? names.zones.join(', ') : 'zone');
    when += zone.match === 'inside' ? `, inside ${label}` : `, outside ${label}`;
  }
  const action = cue.action.type === 'black'
    ? 'black'
    : `preset ${names.preset || cue.action.presetId}`;
  return `${cue.label} — ${when} → ${action}`;
}

/** Extra Home visibility after a show's scheduled end so an exit cue stays on the card. */
export function showCueTailMs(
  bindingId: string,
  durationSec: number,
  liveOffsetSec: number,
  cues: ShowCue[],
  cueMaxHoldSec: number,
): number {
  let extra = 0;
  for (const cue of cues) {
    if (!cue.enabled || cue.anchor.type !== 'show' || cue.anchor.bindingId !== bindingId) continue;
    const to = (cue.toSec ?? cueMaxHoldSec) * 1000;
    let anchorFromEnd = -durationSec * 1000;
    if (cue.anchor.point === 'live') anchorFromEnd = (liveOffsetSec - durationSec) * 1000;
    if (cue.anchor.point === 'end') anchorFromEnd = 0;
    const rel = anchorFromEnd + to;
    if (rel > extra) extra = rel;
  }
  return extra;
}

export function parseThemeParksSchedule(
  entries: {
    date?: string;
    type?: string;
    description?: string;
    openingTime?: string;
    closingTime?: string;
  }[],
  date: string,
): ParkDaySchedule {
  const operating: ScheduleWindow[] = [];
  const ticketed: TicketedWindow[] = [];
  for (const entry of entries) {
    if (entry.date && entry.date !== date) continue;
    const openMs = Date.parse(entry.openingTime ?? '');
    const closeMs = Date.parse(entry.closingTime ?? '');
    if (!Number.isFinite(openMs) || !Number.isFinite(closeMs)) continue;
    if (entry.type === 'OPERATING') {
      operating.push({ openMs, closeMs });
      continue;
    }
    if (entry.type !== 'TICKETED_EVENT') continue;
    const desc = (entry.description ?? '').toLowerCase();
    if (desc.includes('early entry')) ticketed.push({ kind: 'earlyEntry', openMs, closeMs });
    else if (desc.includes('special ticketed')) ticketed.push({ kind: 'event', openMs, closeMs });
    else console.log('[Cues] ignoring schedule description', entry.description);
  }
  return { date, operating, ticketed };
}
