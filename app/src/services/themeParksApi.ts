import { restFetch } from '../utils/restFetch';
import { parseThemeParksSchedule, type ParkDaySchedule } from '../utils/showCues';

const BASE = 'https://api.themeparks.wiki/v1';

export interface ThemeParkDestination {
  id: string;
  name: string;
  parks?: { id: string; name: string }[];
}

export async function searchDestinations(query: string): Promise<ThemeParkDestination[]> {
  const res = await restFetch('themeparks-destinations', `${BASE}/destinations`);
  const data = await res.json();
  const q = query.toLowerCase();
  return (data.destinations || []).filter((d: ThemeParkDestination) =>
    d.name.toLowerCase().includes(q),
  );
}

export async function getEntityLiveData(entityId: string) {
  const res = await restFetch('themeparks-live', `${BASE}/entity/${entityId}/live`);
  if (!res.ok) throw new Error('themeparks.wiki live data unavailable');
  return res.json();
}

export async function getEntitySchedule(entityId: string, date?: string) {
  const url = `${BASE}/entity/${entityId}/schedule${date ? `?date=${date}` : ''}`;
  const res = await restFetch('themeparks-schedule', url);
  if (!res.ok) throw new Error('themeparks.wiki schedule unavailable');
  return res.json();
}

export function extractShowtimes(liveData: { entityType?: string; showtimes?: { startTime: string }[]; name?: string; id?: string }[]) {
  return liveData
    .filter(e => e.entityType === 'SHOW' && e.showtimes?.length)
    .map(e => ({
      id: e.id!,
      name: e.name!,
      showtimes: e.showtimes!.map(s => s.startTime),
    }));
}

export async function getEntity(entityId: string): Promise<{ timezone?: string; name?: string }> {
  const res = await restFetch('themeparks-entity', `${BASE}/entity/${entityId}`);
  if (!res.ok) throw new Error('themeparks.wiki entity unavailable');
  return res.json();
}

export async function fetchParkSchedule(entityId: string, date: string): Promise<ParkDaySchedule> {
  const [y, m] = date.split('-');
  const res = await restFetch('themeparks-month', `${BASE}/entity/${entityId}/schedule/${y}/${m}`);
  if (!res.ok) throw new Error('themeparks.wiki schedule unavailable');
  const data = await res.json();
  const entries = data.schedule || data.scheduleData || [];
  return parseThemeParksSchedule(entries, date);
}

export async function listParkShows(parkEntityId: string) {
  const [live, children] = await Promise.all([
    getEntityLiveData(parkEntityId).catch(() => ({ liveData: [] as { id?: string; name?: string; entityType?: string; showtimes?: { startTime: string }[] }[] })),
    restFetch('themeparks-children', `${BASE}/entity/${parkEntityId}/children`)
      .then(async (res) => (res.ok ? res.json() : { children: [] }))
      .catch(() => ({ children: [] as { id?: string; name?: string; entityType?: string }[] })),
  ]);
  const byId = new Map<string, { id: string; name: string; showtimes: string[] }>();
  for (const child of children.children || []) {
    if (child.entityType !== 'SHOW' || !child.id || !child.name) continue;
    byId.set(child.id, { id: child.id, name: child.name, showtimes: [] });
  }
  for (const show of extractShowtimes(live.liveData || [])) {
    const existing = byId.get(show.id);
    if (existing) existing.showtimes = show.showtimes;
    else byId.set(show.id, show);
  }
  return [...byId.values()];
}
