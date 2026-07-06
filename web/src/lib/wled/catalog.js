export const WLED_EFFECTS_CACHE_KEY = 'wled-effects-cache';

export const WLED_PALETTES_CACHE_KEY = 'wled-palettes-cache';

export function loadCachedWledCatalog() {
  try {
    return {
      effects: JSON.parse(localStorage.getItem(WLED_EFFECTS_CACHE_KEY) || '[]'),
      palettes: JSON.parse(localStorage.getItem(WLED_PALETTES_CACHE_KEY) || '[]'),
    };
  } catch {
    return { effects: [], palettes: [] };
  }
}

export async function fetchWledCatalog(ip) {
  const host = ip.trim();
  const [effRes, palRes] = await Promise.all([
    fetch(`http://${host}/json/eff`),
    fetch(`http://${host}/json/pal`),
  ]);
  if (!effRes.ok || !palRes.ok) throw new Error('Bad response');
  const effs = await effRes.json();
  const pals = await palRes.json();
  const effects = effs.map((name, id) => ({ id, name })).filter(e => e.name !== 'RSVD' && e.name !== '-');
  const palettes = pals.map((name, id) => ({ id, name }));
  localStorage.setItem(WLED_EFFECTS_CACHE_KEY, JSON.stringify(effects));
  localStorage.setItem(WLED_PALETTES_CACHE_KEY, JSON.stringify(palettes));
  return { effects, palettes };
}
