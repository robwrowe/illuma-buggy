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
