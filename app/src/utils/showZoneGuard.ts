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
}): boolean {
  const {
    activeParkId,
    activeZoneIds,
    showBindings,
    deviceStatus,
    showScheduleProtects,
  } = opts;
  if (!activeParkId) return false;

  const parkBindings = showBindings.filter((b) => b.parkId === activeParkId);
  const inScope = (binding: ParkShowBinding) =>
    showBindingInScope(binding, activeParkId, activeZoneIds);

  // Schedule-based protection only for bindings scoped to a GPS zone. A park-wide
  // binding (no scopeZoneId) used to suppress *every* zone in the park during
  // pre/live — walk into an unrelated zone and nothing fired. Park-wide still
  // protects when the board is actually in SHOW_MODE (override path below).
  if (
    showScheduleProtects &&
    parkBindings.some((b) => !!b.scopeZoneId && inScope(b))
  ) {
    return true;
  }

  if (deviceStatus?.override !== SHOW_OVERRIDE) return false;

  const showType = deviceStatus.showType;
  return parkBindings.some((b) => {
    if (!inScope(b)) return false;
    if (!showType) return true;
    return b.kind === showType;
  });
}
