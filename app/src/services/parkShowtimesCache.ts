/**
 * Shared Theme Parks API showtimes cache.
 * Written by useParkShows / useCaptureAutomation; read by BleCaptureScreen
 * so it can call buildUpcomingShows without re-running show-phase automation.
 */

let lastRaw: { id: string; name: string; showtimes: string[] }[] = [];
let lastEntityId: string | null = null;

export function setParkShowtimesCache(
  raw: { id: string; name: string; showtimes: string[] }[],
  entityId: string | null,
) {
  lastRaw = raw || [];
  lastEntityId = entityId;
}

export function getParkShowtimesCache(): {
  raw: { id: string; name: string; showtimes: string[] }[];
  entityId: string | null;
} {
  return { raw: lastRaw, entityId: lastEntityId };
}
