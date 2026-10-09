/**
 * When a show is active inside its scoped GPS zone, zone auto-triggers must not
 * preempt SHOW_MODE. Leaving the show zone resumes normal zone entry/exit.
 */

import type { DeviceStatus } from '../stores/store';
import { showBindingInScope, type ParkShowBinding } from './showBindings';

/** Firmware OverrideSource::SHOW_MODE */
const SHOW_OVERRIDE = 3;

export function shouldProtectShowFromZones(opts: {
  activeParkId?: string | null;
  activeZoneIds: string[];
  showBindings: ParkShowBinding[];
  deviceStatus: DeviceStatus | null;
  /** In-scope show instance in pre or live (from useParkShows schedule tick). */
  showScheduleProtects?: boolean;
  /** A cue occurrence is active, including park-level cues with no show. */
  cueActive?: boolean;
}): boolean {
  const {
    activeParkId,
    activeZoneIds,
    showBindings,
    deviceStatus,
    showScheduleProtects,
    cueActive,
  } = opts;
  if (!activeParkId) return false;
  if (cueActive) return true;

  const parkBindings = showBindings.filter((b) => b.parkId === activeParkId);
  const inScope = (binding: ParkShowBinding) =>
    showBindingInScope(binding, activeParkId, activeZoneIds);

  // Park-wide bindings (no scopeZoneId) are in scope for the entire park —
  // fireworks and similar shows should suppress every zone during pre/live.
  if (showScheduleProtects && parkBindings.some(inScope)) {
    return true;
  }

  if (deviceStatus?.override !== SHOW_OVERRIDE) return false;

  const showType = deviceStatus.showType;
  if (showType === 'cue') return true;
  return parkBindings.some((b) => {
    if (!inScope(b)) return false;
    if (!showType) return true;
    return b.kind === showType;
  });
}
