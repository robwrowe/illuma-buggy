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
  /** Skip auto pre/post for all instances of this binding */
  autoStartDisabled: boolean;
  /** When set, automation only runs inside this GPS zone; omit for anywhere in the park */
  scopeZoneId?: string | null;
}

export interface ShowSettings {
  defaultPreLeadSec: number;
  defaultPostDelaySec: number;
  defaultHomeVisibleBeforeMin: number;
  defaultHomeVisibleAfterMin: number;
}

export interface ShowInstanceOverride {
  autoStartDisabled: boolean;
}

export const DEFAULT_SHOW_SETTINGS: ShowSettings = {
  defaultPreLeadSec: 300,
  defaultPostDelaySec: 60,
  defaultHomeVisibleBeforeMin: 60,
  defaultHomeVisibleAfterMin: 15,
};

export function inferShowKind(name: string): ShowKind {
  return /firework|happily ever after|enchantment|celebrat/i.test(name) ? 'fireworks' : 'parade';
}

export function normalizeShowBinding(raw: Partial<ParkShowBinding> | undefined, defaults: ShowSettings): ParkShowBinding | null {
  if (!raw?.parkId || !raw.entityId || !raw.name) return null;
  const presets = raw.presets ?? { pre: '', live: '', post: '' };
  return {
    id: raw.id ?? `${raw.parkId}-${raw.entityId}`,
    parkId: raw.parkId,
    entityId: raw.entityId,
    name: raw.name,
    kind: raw.kind === 'fireworks' || raw.kind === 'parade' ? raw.kind : inferShowKind(raw.name),
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
    autoStartDisabled: !!raw.autoStartDisabled,
    scopeZoneId: raw.scopeZoneId || null,
  };
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
