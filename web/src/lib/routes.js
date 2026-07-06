/** Vite base path without trailing slash (e.g. /illuma-buggy). */
export const ROUTER_BASENAME = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/';

export const APP_TABS = [
  { path: 'map', label: 'Map & Zones', icon: '🗺' },
  { path: 'presets', label: 'Presets', icon: '✨' },
  { path: 'palettes', label: 'Palettes', icon: '🎨' },
  { path: 'shows', label: 'Shows', icon: '🎆' },
  { path: 'brightness', label: 'Brightness', icon: '💡' },
  { path: 'wandlab', label: 'Wand Lab', icon: '🪄' },
  { path: 'settings', label: 'Settings', icon: '⚙️' },
];

export const WAND_LAB_SECTIONS = [
  { path: 'quick', label: 'Quick' },
  { path: 'mb', label: 'MagicBand+' },
  { path: 'bytes', label: 'Byte editor' },
  { path: 'sequence', label: 'Packet sequence' },
];

/** Top-level tab id from react-router location pathname. */
export function tabFromPathname(pathname) {
  const segment = (pathname || '/').replace(/^\//, '').split('/')[0];
  return APP_TABS.some((t) => t.path === segment) ? segment : 'map';
}
