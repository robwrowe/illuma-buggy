export const THEME_PARKS_API = 'https://api.themeparks.wiki/v1';

export let themeParkDestCache = null;

export async function fetchThemeParkDestinations() {
  if (themeParkDestCache) return themeParkDestCache;
  const res = await fetch(`${THEME_PARKS_API}/destinations`);
  if (!res.ok) throw new Error('Could not load destinations');
  const data = await res.json();
  themeParkDestCache = data.destinations || [];
  return themeParkDestCache;
}

export async function fetchParkShows(parkEntityId) {
  const res = await fetch(`${THEME_PARKS_API}/entity/${parkEntityId}/live`);
  if (!res.ok) throw new Error('Could not load park shows');
  const data = await res.json();
  return (data.liveData || [])
    .filter(e => e.entityType === 'SHOW' && e.showtimes?.length)
    .map(e => ({ id: e.id, name: e.name }));
}

export function inferShowKind(name) {
  return /firework|happily ever after|enchantment|celebrat/i.test(name) ? 'fireworks' : 'parade';
}

export function normalizeShowBinding(raw, defaults) {
  if (!raw?.parkId || !raw.entityId || !raw.name) return null;
  const presets = raw.presets || { pre: '', live: '', post: '' };
  const kind = raw.kind === 'fireworks' || raw.kind === 'parade' ? raw.kind : inferShowKind(raw.name);
  return {
    id: raw.id || `${raw.parkId}-${raw.entityId}`,
    parkId: raw.parkId,
    entityId: raw.entityId,
    name: raw.name,
    kind,
    presets: { pre: presets.pre || '', live: presets.live || '', post: presets.post || '' },
    preLeadSec: Number.isFinite(raw.preLeadSec) ? raw.preLeadSec : defaults.defaultPreLeadSec,
    postDelaySec: Number.isFinite(raw.postDelaySec) ? raw.postDelaySec : defaults.defaultPostDelaySec,
    homeVisibleBeforeMin: Number.isFinite(raw.homeVisibleBeforeMin)
      ? raw.homeVisibleBeforeMin : defaults.defaultHomeVisibleBeforeMin,
    homeVisibleAfterMin: Number.isFinite(raw.homeVisibleAfterMin)
      ? raw.homeVisibleAfterMin : defaults.defaultHomeVisibleAfterMin,
    durationMin: Number.isFinite(raw.durationMin)
      ? raw.durationMin
      : (kind === 'fireworks' ? defaults.defaultFireworksDurationMin : defaults.defaultParadeDurationMin),
    autoStartDisabled: !!raw.autoStartDisabled,
    scopeZoneId: raw.scopeZoneId || null,
  };
}

export function buildLegacyShowModeConfig(bindings, parkId) {
  const parkBindings = parkId ? (bindings || []).filter(b => b.parkId === parkId) : (bindings || []);
  const parade = parkBindings.find(b => b.kind === 'parade');
  const fireworks = parkBindings.find(b => b.kind === 'fireworks');
  return {
    parade: {
      pre: parade?.presets.pre || '',
      live: parade?.presets.live || '',
      post: parade?.presets.post || '',
    },
    fireworks: {
      pre: fireworks?.presets.pre || '',
      live: fireworks?.presets.live || '__BLACK__',
      post: fireworks?.presets.post || '',
    },
  };
}

export function parkSelectOptions(parks) {
  return [
    { value: '', label: 'Ungrouped', searchText: 'ungrouped none' },
    ...(parks || []).map(p => ({ value: p.id, label: p.name, searchText: p.name })),
  ];
}

export function groupZonesByPark(zones, parks) {
  const groups = (parks || []).map(p => ({
    key: p.id, label: p.name, zones: (zones || []).filter(z => z.parkId === p.id),
  }));
  const ungrouped = (zones || []).filter(z => !z.parkId);
  if (ungrouped.length) groups.push({ key: '_ungrouped', label: 'Ungrouped', zones: ungrouped });
  return groups;
}
