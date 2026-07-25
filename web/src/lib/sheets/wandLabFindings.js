/** Structured Wand Lab finding vocabulary (Sheets `findings` tab). */

export const WAND_LAB_DEVICE_TYPES = [
  { value: 'magic_band', label: 'Magic Band' },
  { value: 'starlight_wand', label: 'Starlight Wand' },
  { value: 'unknown', label: 'Unknown' },
];

export const WAND_LAB_COLORS = [
  'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'white', 'black',
];

export const WAND_LAB_LAYOUTS = [
  { value: 'all_one', label: 'All one' },
  { value: 'inner_outer', label: 'Inner / outer' },
  { value: 'inner_only', label: 'Inner only' },
  { value: 'outer_only', label: 'Outer only' },
  { value: 'five_color', label: 'Five color' },
  { value: 'other', label: 'Other' },
];

export const WAND_LAB_SHOWS = [
  'Celebrate America',
  'Luminous',
  'Starlight',
  'Happily Ever After',
  'Fantasmic',
  'Club House Live',
  'Other / bench test',
];

const SHOWS_STORAGE = 'wandlab-shows';

/** User-editable show list (falls back to defaults). */
export function getWandLabShows() {
  try {
    const raw = localStorage.getItem(SHOWS_STORAGE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((s) => String(s).trim()).filter(Boolean);
      }
    }
  } catch { /* ignore */ }
  return [...WAND_LAB_SHOWS];
}

export function setWandLabShows(shows) {
  const next = (shows || []).map((s) => String(s).trim()).filter(Boolean);
  localStorage.setItem(SHOWS_STORAGE, JSON.stringify(next.length ? next : [...WAND_LAB_SHOWS]));
}

export const EMPTY_FINDING_FORM = {
  deviceType: 'unknown',
  totalTimeS: '',
  fadeTimeS: '',
  cycleTimeS: '',
  numCycles: '',
  colors: [],
  layout: 'all_one',
  show: 'Other / bench test',
  notes: '',
  opcodeOverride: '',
};

/** Per-section defaults for "Reset group" buttons. */
export const FINDING_FORM_SECTIONS = {
  device: { deviceType: 'unknown' },
  timing: {
    totalTimeS: '',
    fadeTimeS: '',
    cycleTimeS: '',
    numCycles: '',
  },
  colors: { colors: [] },
  layout: { layout: 'all_one' },
  show: { show: 'Other / bench test' },
  opcodeNotes: { opcodeOverride: '', notes: '' },
};

/** Keep sticky fields after log; only clear notes (and editing state). */
export function formAfterLog(form) {
  return { ...form, notes: '' };
}
