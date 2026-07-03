/**
 * Per-park show bindings — assign pre/live/post presets to specific parade/fireworks shows.
 */

export type ShowKind = 'parade' | 'fireworks';

export interface ShowPhasePresets {
  pre: string;
  live: string;
  post: string;
}

export interface ParkShowBinding {
  id: string;
  parkId: string;
  /** themeParks.wiki entity id — matched against live showtimes */
  entityId: string;
  name: string;
  kind: ShowKind;
  presets: ShowPhasePresets;
  /** Seconds before show start to auto-run pre */
  preLeadSec: number;
  /** Seconds after scheduled end to auto-run post */
  postDelaySec: number;
  /** Minutes before start to appear on Home */
  homeVisibleBeforeMin: number;
  /** Minutes after end to remain on Home */
  homeVisibleAfterMin: number;
  /** Scheduled show length — used to compute end time and post trigger */
  durationMin: number;
  /** Skip auto pre/post for all instances of this binding */
  autoPrePostDisabled: boolean;
  /** Skip auto live at scheduled start (default off for parades — start live manually on route) */
  autoLiveDisabled: boolean;
  /** @deprecated use autoPrePostDisabled */
  autoStartDisabled?: boolean;
  /** When set, automation only runs inside this GPS zone; omit for anywhere in the park */
  scopeZoneId?: string | null;
}

export interface ShowSettings {
  defaultPreLeadSec: number;
  defaultPostDelaySec: number;
  defaultHomeVisibleBeforeMin: number;
  defaultHomeVisibleAfterMin: number;
  defaultParadeDurationMin: number;
  defaultFireworksDurationMin: number;
  /** WLED bri (0–255) when a show enters live phase at nighttime */
  showNightBrightness: number;
  /** When on, live start (manual or auto) sets showNightBrightness at night */
  showAutoBrightness: boolean;
}

export interface ShowInstanceOverride {
  /** When set, overrides binding default for this show instance */
  autoPrePostDisabled?: boolean;
  /** When set, overrides binding default for live auto (parades default off) */
  autoLiveDisabled?: boolean;
  /** @deprecated use autoPrePostDisabled */
  autoStartDisabled?: boolean;
}

export const DEFAULT_SHOW_SETTINGS: ShowSettings = {
  defaultPreLeadSec: 300,
  defaultPostDelaySec: 60,
  defaultHomeVisibleBeforeMin: 60,
  defaultHomeVisibleAfterMin: 15,
  defaultParadeDurationMin: 30,
  defaultFireworksDurationMin: 20,
  showNightBrightness: 5,
  showAutoBrightness: true,
};

export function inferShowKind(name: string): ShowKind {
  return /firework|happily ever after|enchantment|celebrat/i.test(name) ? 'fireworks' : 'parade';
}

export function normalizeShowBinding(raw: Partial<ParkShowBinding> | undefined, defaults: ShowSettings): ParkShowBinding | null {
  if (!raw?.parkId || !raw.entityId || !raw.name) return null;
  const presets = raw.presets ?? { pre: '', live: '', post: '' };
  const kind = raw.kind === 'fireworks' || raw.kind === 'parade' ? raw.kind : inferShowKind(raw.name ?? '');
  return {
    id: raw.id ?? `${raw.parkId}-${raw.entityId}`,
    parkId: raw.parkId,
    entityId: raw.entityId,
    name: raw.name,
    kind,
    presets: {
      pre: presets.pre ?? '',
      live: presets.live ?? '',
      post: presets.post ?? '',
    },
    preLeadSec: Number.isFinite(raw.preLeadSec) ? raw.preLeadSec! : defaults.defaultPreLeadSec,
    postDelaySec: Number.isFinite(raw.postDelaySec) ? raw.postDelaySec! : defaults.defaultPostDelaySec,
    homeVisibleBeforeMin: Number.isFinite(raw.homeVisibleBeforeMin)
      ? raw.homeVisibleBeforeMin!
      : defaults.defaultHomeVisibleBeforeMin,
    homeVisibleAfterMin: Number.isFinite(raw.homeVisibleAfterMin)
      ? raw.homeVisibleAfterMin!
      : defaults.defaultHomeVisibleAfterMin,
    durationMin: Number.isFinite(raw.durationMin)
      ? raw.durationMin!
      : (kind === 'fireworks' ? defaults.defaultFireworksDurationMin : defaults.defaultParadeDurationMin),
    autoPrePostDisabled: !!(raw.autoPrePostDisabled ?? raw.autoStartDisabled),
    autoLiveDisabled: raw.autoLiveDisabled ?? (kind === 'fireworks' ? false : true),
    autoStartDisabled: !!(raw.autoPrePostDisabled ?? raw.autoStartDisabled),
    scopeZoneId: raw.scopeZoneId || null,
  };
}

export function isAutoPrePostDisabled(
  binding: ParkShowBinding,
  instanceOverride?: ShowInstanceOverride | null,
): boolean {
  if (instanceOverride?.autoPrePostDisabled !== undefined) return instanceOverride.autoPrePostDisabled;
  if (instanceOverride?.autoStartDisabled !== undefined) return instanceOverride.autoStartDisabled;
  return binding.autoPrePostDisabled || !!binding.autoStartDisabled;
}

export function isAutoLiveDisabled(
  binding: ParkShowBinding,
  instanceOverride: ShowInstanceOverride | null | undefined,
): boolean {
  if (instanceOverride?.autoLiveDisabled !== undefined) return instanceOverride.autoLiveDisabled;
  return binding.autoLiveDisabled;
}

/** Schedule-based zone protection — parade live is manual-only (SHOW_MODE on device). */
export function shouldScheduleProtectZones(show: {
  inScope: boolean;
  status: 'upcoming' | 'pre' | 'live' | 'ended';
  kind: ShowKind;
  autoPrePostDisabled: boolean;
  autoLiveDisabled: boolean;
}): boolean {
  if (!show.inScope) return false;
  if (show.status === 'pre' && !show.autoPrePostDisabled) return true;
  if (show.status === 'live' && show.kind === 'fireworks' && !show.autoLiveDisabled) return true;
  return false;
}

/** Park-wide when scopeZoneId is null; otherwise user must be inside that zone polygon. */
export function showBindingInScope(
  binding: ParkShowBinding,
  activeParkId: string | undefined,
  activeZoneIds: string[],
): boolean {
  if (!activeParkId || binding.parkId !== activeParkId) return false;
  if (!binding.scopeZoneId) return true;
  return activeZoneIds.includes(binding.scopeZoneId);
}

export function bindingForEntity(
  bindings: ParkShowBinding[],
  parkId: string | undefined,
  entityId: string,
): ParkShowBinding | undefined {
  if (!parkId) return undefined;
  return bindings.find(b => b.parkId === parkId && b.entityId === entityId);
}

/** Legacy global showModeConfig from first binding per kind (firmware NVS compat). */
export function buildLegacyShowModeConfig(bindings: ParkShowBinding[], parkId: string | undefined) {
  const parkBindings = parkId ? bindings.filter(b => b.parkId === parkId) : bindings;
  const parade = parkBindings.find(b => b.kind === 'parade');
  const fireworks = parkBindings.find(b => b.kind === 'fireworks');
  return {
    parade: {
      pre: parade?.presets.pre ?? '',
      live: parade?.presets.live ?? '',
      post: parade?.presets.post ?? '',
    },
    fireworks: {
      pre: fireworks?.presets.pre ?? '',
      live: fireworks?.presets.live ?? '__BLACK__',
      post: fireworks?.presets.post ?? '',
    },
  };
}
