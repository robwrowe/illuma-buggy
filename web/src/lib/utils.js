import { activeSegmentsFromPreset, buildRecalledSegment, isActiveSegment } from './wled/capture';

export function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

export function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = h / 360;
  return {
    r: Math.round(hue2rgb(p, q, hk + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hk) * 255),
    b: Math.round(hue2rgb(p, q, hk - 1 / 3) * 255),
  };
}

export function normalizeHex(hex) {
  if (!hex) return null;
  const h = hex.startsWith('#') ? hex : `#${hex}`;
  return /^#[0-9a-fA-F]{6}$/.test(h) ? h.toLowerCase() : null;
}

export function hexToRgbTriplet(hex) {
  const rgb = hexToRgb(normalizeHex(hex) || '#000000');
  return [rgb.r, rgb.g, rgb.b];
}

export function rgbTripletToHex(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return '#000000';
  return rgbToHex(rgb[0], rgb[1], rgb[2]);
}

export function wledColToHexList(col) {
  if (!col || !col.length) return [];
  if (typeof col[0] === 'number') return [rgbTripletToHex(col)];
  return col.map(rgbTripletToHex);
}

export function hexListToWledCol(hexes) {
  const valid = (hexes || []).map(h => normalizeHex(h)).filter(Boolean);
  if (!valid.length) return undefined;
  return valid.map(h => hexToRgbTriplet(h));
}

export function saveColorToLibrary(data, update, hex) {
  const h = normalizeHex(hex);
  if (!h) return;
  if ((data.savedColors || []).some(c => c.hex.toLowerCase() === h)) {
    alert('That color is already in your library.');
    return;
  }
  const name = prompt('Name for this color:', h);
  if (name === null) return;
  update({
    savedColors: [...(data.savedColors || []), { id: generateId(), name: (name.trim() || h), hex: h }],
  });
}

export const MAX_EFFECT_COLORS = 3;

export const ZONE_COLORS = ['#a78bfa', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#f97316', '#ec4899', '#14b8a6'];

export const PRESET_COLORS = [
  '#ff0000', '#ff4400', '#ff8800', '#ffcc00', '#ffff00', '#aaff00', '#00ff00', '#00ff88',
  '#00ffff', '#0099ff', '#0044ff', '#6600ff', '#aa00ff', '#ff00ff', '#ff0088', '#ffffff',
  '#888888', '#444444', '#000000', '#ff6666', '#66ff66', '#6666ff', '#ffaa44', '#44aaff',
];

export const DEFAULT_DATA = {
  version: '3.0', presets: [], zones: [], indoorZones: [], parks: [],
  brightnessConfig: { daytime: 200, nighttime: 80, indoor: 120, transitionMinutes: 30, solarThresholdDeg: 6 },
  recallState: { effect: 'always', palette: 'always', parameters: 'memory', color: 'memory', segments: 'never' },
  overrideKillOnZone: false, magicBandFivePoint: true, bleEffectTransitionMs: 700,
  starlightEnabled: true, starlightTimeoutSec: 15,
  magicBandEnabled: true, magicBandTimeoutSec: 15,
  customPalettes: [], paletteSets: [], customSegmentLayouts: [], savedColors: [],
  mbSegmentLayouts: [], mbActiveSegmentLayoutId: null,
  showModeConfig: {
    parade: { pre: '', live: '', post: '' },
    fireworks: { pre: '', live: '__BLACK__', post: '' },
  },
  showBindings: [],
  showSettings: {
    defaultPreLeadSec: 300,
    defaultPostDelaySec: 60,
    defaultHomeVisibleBeforeMin: 60,
    defaultHomeVisibleAfterMin: 15,
    defaultParadeDurationMin: 30,
    defaultFireworksDurationMin: 20,
    showNightBrightness: 5,
    showAutoBrightness: true,
  },
  showInstanceOverrides: {},
  wandLab: { simIp: '', log: [] },
  ftbPresetId: '',
  mbMapping: null, // filled by normalizeMbMapping on load
};

export function normalizePolygonPoint(p) {
  if (!p || typeof p !== 'object') return null;
  if (typeof p.lat === 'number' && typeof p.lng === 'number') return { lat: p.lat, lng: p.lng };
  if (typeof p.latitude === 'number' && typeof p.longitude === 'number') {
    return { lat: p.latitude, lng: p.longitude };
  }
  return null;
}

export function normalizePolygon(polygon) {
  return (polygon || []).map(normalizePolygonPoint).filter(Boolean);
}

export function normalizeZoneRecord(zone) {
  if (!zone) return zone;
  return { ...zone, polygon: normalizePolygon(zone.polygon) };
}

export function focusMapOnPolygon(mapRef, polygon, padding = 56) {
  if (!mapRef?.current || !window.google?.maps) return;
  const pts = normalizePolygon(polygon);
  if (pts.length < 1) return;
  const bounds = new google.maps.LatLngBounds();
  pts.forEach(p => bounds.extend(p));
  if (pts.length === 1) {
    mapRef.current.setCenter(pts[0]);
    mapRef.current.setZoom(17);
    return;
  }
  mapRef.current.fitBounds(bounds, padding);
}

export function presetSelectOptions(presets) {
  return (presets || []).map(p => ({
    value: p.id,
    label: p.wledSlot != null ? `${p.name} (WLED #${p.wledSlot})` : p.name,
    searchText: `${p.name} ${p.wledSlot ?? ''} ${p.wled?.fxName || ''} ${p.wled?.palName || ''}`,
  }));
}

export function showModePresetOptions(presets, includeBlack = false) {
  const base = [{ value: '', label: '(none)', searchText: 'none empty' }];
  if (includeBlack) base.push({ value: '__BLACK__', label: 'Black (lights off)', searchText: 'black off' });
  return [...base, ...presetSelectOptions(presets)];
}

export function paletteSelectValue(wled) {
  if (wled.pal === undefined || wled.pal === null || wled.pal === '') return '';
  return `wled:${wled.pal}`;
}

export const DEFAULT_PRESET_MEMORY = { effect: true, palette: true, parameters: true, color: false, segments: false };

export function buildRecallPayload(preset, recall, customSegmentLayouts) {
  const r = recall || DEFAULT_DATA.recallState;
  const w = preset.wled || { on: true };
  const m = preset.memory || DEFAULT_PRESET_MEMORY;
  const payload = { on: true };

  const should = (prop, memVal) => {
    if (r[prop] === 'always') return true;
    if (r[prop] === 'never') return false;
    return memVal;
  };

  const activeSegments = activeSegmentsFromPreset(preset, customSegmentLayouts);
  const recallLayout = should('segments', m.segments) && activeSegments.length > 0;

  if (recallLayout) {
    payload.seg = activeSegments.map((seg, i) => buildRecalledSegment(seg, w, should, m, i));
  } else {
    const base = activeSegments.find(isActiveSegment) || activeSegments[0] || { id: 0 };
    payload.seg = [buildRecalledSegment(base, w, should, m, 0)];
  }

  return payload;
}

export function buildPaletteSelectOptions(wledPalettes, wled, paletteKnown) {
  const options = [];
  if (wled?.pal != null && wled.pal !== '' && !paletteKnown) {
    options.push({
      value: `wled:${wled.pal}`,
      label: `${wled.palName || `Palette #${wled.pal}`} (saved)`,
      group: 'Saved',
      searchText: `${wled.palName || ''} ${wled.pal}`,
    });
  }
  [...(wledPalettes || [])]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .forEach(pal => {
      options.push({
        value: `wled:${pal.id}`,
        label: `#${pal.id} — ${pal.name}`,
        group: `WLED (${wledPalettes.length})`,
        searchText: `${pal.name} ${pal.id}`,
      });
    });
  return options;
}

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function showPresetLabel(presets, id, kind, phase) {
  if (!id) return '—';
  if (id === '__BLACK__') return 'Black (strip off)';
  const p = presets.find(x => x.id === id);
  return p?.name || id.slice(0, 8);
}
