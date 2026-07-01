const BASE = 'https://api.themeparks.wiki/v1';

export interface ThemeParkDestination {
  id: string;
  name: string;
  parks?: { id: string; name: string }[];
}

export async function searchDestinations(query: string): Promise<ThemeParkDestination[]> {
  const res = await fetch(`${BASE}/destinations`);
  const data = await res.json();
  const q = query.toLowerCase();
  return (data.destinations || []).filter((d: ThemeParkDestination) =>
    d.name.toLowerCase().includes(q),
  );
}

export async function getEntityLiveData(entityId: string) {
  const res = await fetch(`${BASE}/entity/${entityId}/live`);
  if (!res.ok) throw new Error('themeparks.wiki live data unavailable');
  return res.json();
}

export async function getEntitySchedule(entityId: string, date?: string) {
  const url = `${BASE}/entity/${entityId}/schedule${date ? `?date=${date}` : ''}`;
  const res = await fetch(url);
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
