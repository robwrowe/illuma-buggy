import { segmentMapSegmentToWledDef } from '../../lib/ble/mbMapping';
import { generateId } from '../../lib/utils';

export const PRESET_SUB_TABS = ['effect', 'palette', 'colors', 'segments', 'params', 'memory'];

/** Same 0–9 ledmap slots as SegmentMapEditor / WLED ledmap.json–ledmap9.json. */
export const PRESET_LEDMAP_OPTS = [
  { value: '0', label: 'Map 0 (ledmap.json)', searchText: '0 default ledmap.json' },
  { value: '1', label: 'Map 1 (ledmap1.json)', searchText: '1 ledmap1.json' },
  { value: '2', label: 'Map 2 (ledmap2.json)', searchText: '2 ledmap2.json' },
  { value: '3', label: 'Map 3 (ledmap3.json)', searchText: '3 ledmap3.json' },
  { value: '4', label: 'Map 4 (ledmap4.json)', searchText: '4 ledmap4.json' },
  { value: '5', label: 'Map 5 (ledmap5.json)', searchText: '5 ledmap5.json' },
  { value: '6', label: 'Map 6 (ledmap6.json)', searchText: '6 ledmap6.json' },
  { value: '7', label: 'Map 7 (ledmap7.json)', searchText: '7 ledmap7.json' },
  { value: '8', label: 'Map 8 (ledmap8.json)', searchText: '8 ledmap8.json' },
  { value: '9', label: 'Map 9 (ledmap9.json)', searchText: '9 ledmap9.json' },
];

export function blankPreset() {
  return {
    id: generateId(),
    name: '',
    createdAt: Date.now(),
    tags: [],
    global: {
      on: true,
      fx: undefined,
      fxName: '',
      pal: undefined,
      palName: '',
      sx: 128,
      ix: 128,
      c1: 128,
      c2: 128,
      c3: 16,
      o1: false,
      o2: false,
      o3: false,
    },
    segmentMapId: '',
    segmentOverrides: {},
    segmentSourceMode: 'global',
    ledmap: null,
    memory: {
      effect: true,
      palette: true,
      parameters: true,
      color: false,
      segments: false,
    },
  };
}

export function segmentMapPreview(map) {
  return {
    id: map.id,
    name: map.name,
    segments: (map.segments || []).map((s) => segmentMapSegmentToWledDef(s)).filter(Boolean),
  };
}

export function duplicatePresetRecord(p, name) {
  return {
    ...p,
    id: generateId(),
    name,
    tags: [...(p.tags || [])],
    createdAt: Date.now(),
    global: JSON.parse(JSON.stringify(p.global || {})),
    segmentOverrides: JSON.parse(JSON.stringify(p.segmentOverrides || {})),
    memory: { ...(p.memory || {}) },
  };
}
