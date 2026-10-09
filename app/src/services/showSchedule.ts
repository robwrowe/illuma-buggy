/**
 * Pure show-schedule projection. Shared by the Shows UI hook and the
 * location-task automation tick so both agree on status windows.
 */

import {
  bindingForEntity,
  showBindingInScope,
  isAutoPrePostDisabled,
  isAutoLiveDisabled,
  type ParkShowBinding,
  type ShowSettings,
  type ShowInstanceOverride,
} from '../utils/showBindings';

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
  _settings: ShowSettings,
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
