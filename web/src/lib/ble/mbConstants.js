export const SW_FX_PRESET_BYTES = {
  rainbow: [0xE1, 0x00, 0xE9, 0x0C, 0x00, 0x0F, 0x0F, 0x5D, 0x46, 0x5B, 0xF0, 0x05, 0x32, 0x37, 0x48, 0xB0],
  blink: [0xE1, 0x00, 0xE9, 0x0C, 0x00, 0x0F, 0x0F, 0x5D, 0x46, 0x5B, 0xF0, 0x05, 0x32, 0x37, 0x48, 0x95],
  palette5: [0xE1, 0x00, 0xE9, 0x0C, 0x00, 0x0F, 0x0F, 0xB1, 0xB9, 0xB5, 0xB1, 0xA2, 0x30, 0x7B, 0x7D, 0xB0],
  flash: [0xE1, 0x00, 0xE9, 0x0E, 0x00, 0x01, 0x0F, 0xBD, 0xA0, 0xA0, 0xBD, 0xA0, 0x59, 0x07, 0x00, 0x48, 0xAE, 0xB5],
  sparkle: [0xE1, 0x00, 0xE9, 0x10, 0x00, 0x13, 0x48, 0x97, 0xD0, 0x0E, 0xA0, 0xD1, 0x46, 0x06, 0x0F, 0x30, 0xD0, 0x4E, 0x07, 0xB0],
  pulse: [0xE1, 0x00, 0xE9, 0x13, 0x00, 0x02, 0xD0, 0x37, 0xF0, 0xD2, 0x3D, 0x05, 0x05, 0x00, 0x0E, 0xFA, 0x89, 0x83, 0x51, 0x0E, 0xE7, 0xA0, 0xB0],
  circle: [0xE2, 0x00, 0xE9, 0x12, 0x00, 0x03, 0x0F, 0xA2, 0xA2, 0xA4, 0xA4, 0xA2, 0x30, 0xD0, 0x37, 0xF4, 0xD2, 0x46, 0x00, 0x64, 0xFC, 0xB8],
  fade: [0xE1, 0x00, 0xE9, 0x11, 0x00, 0x6F, 0x0F, 0x56, 0x48, 0x58, 0xF4, 0x48, 0x82, 0xD1, 0x46, 0x02, 0x08, 0xD0, 0x65, 0x00, 0xB0],
  fade2: [0xE1, 0x00, 0xE9, 0x11, 0x00, 0x0F, 0x0F, 0x48, 0x59, 0x58, 0xF4, 0x48, 0x82, 0xD1, 0x46, 0x02, 0x0D, 0xD0, 0x65, 0x05, 0xB0],
};

export const WAND_LAB_TAGS = [
  'no_effect',
  'color_change',
  'animation_change',
  'ignored',
  'unknown',
  'e9_0c',
  'e9_10',
  'e9_11',
  'e9_12',
  'cd07',
  'c013',
  'c00f',
  'e409',
  'e501',
];

export const MB_PATTERN_MODES = [
  { id: 'solid', label: 'solid', nibble: 0x04 },
  { id: 'spin', label: 'spin', nibble: 0x03 },
  { id: 'all', label: 'all', nibble: 0x0B },
  { id: 'corners', label: 'corners', nibble: 0x08 },
  { id: 'middle', label: 'middle', nibble: 0x02 },
];

export const WAND_LAB_MB_CMDS = [
  { id: 'single', label: 'E905 — single color' },
  { id: 'dual', label: 'E906 — dual ring' },
  { id: 'rgb', label: 'E908 — raw RGB (6-bit)' },
  { id: 'five', label: 'E909 — five corners' },
  { id: 'pattern', label: 'E909 — color + pattern' },
  { id: 'ping', label: 'CC03 — ping' },
];

export const MB_COLOR_NAMES = [
  'cyan', 'purple', 'blue', 'midnight blue', 'blue 2', 'bright purple', 'lavender', 'purple',
  'pink', 'pink 2', 'pink 3', 'pink 4', 'pink 5', 'pink 6', 'pink 7', 'yellow orange',
  'off yellow', 'yellow orange 2', 'lime', 'orange', 'red orange', 'red',
  'cyan 2', 'cyan 3', 'cyan 4', 'green', 'lime green', 'white', 'white 2',
  'off', 'unique', 'random',
];

export function mbPaletteOptions() {
  return MB_COLOR_NAMES.map((name, i) => ({
    value: String(i),
    label: `${i} — ${name}`,
    searchText: `${i} ${name}`,
  }));
}

export const DEFAULT_MB_WLED_COLORS = [
  '#00ffff', '#9900ff', '#0000ff', '#000080', '#0066ff', '#cc44ff', '#cc99ff', '#7700cc',
  '#ff66b2', '#ff5aa8', '#ff509e', '#ff4a94', '#ff6e96', '#ff82a0', '#ffa0aa', '#ffaa00',
  '#cccc00', '#ff8800', '#aaff00', '#ff6600', '#ff3300', '#ff0000',
  '#3cffff', '#28f0ff', '#14c8ff', '#00ff00', '#66ff28', '#ffffff', '#f0f0f0',
  '#000000', '#ff9933', '#ff00ff',
];

export const MB_PAL_OFF = 29;

export const MB_PAL_UNIQUE = 30;

export const MB_PAL_RANDOM = 31;

export function mbPaletteEligibleForRandom(idx) {
  return Number.isInteger(idx) && idx >= 0 && idx <= 30 && idx !== MB_PAL_OFF && idx !== MB_PAL_UNIQUE;
}

export function defaultRandomPaletteIndices() {
  return Array.from({ length: MB_PAL_RANDOM }, (_, i) => i).filter(mbPaletteEligibleForRandom);
}

export function normalizeRandomPool(raw) {
  const defaultPalettes = defaultRandomPaletteIndices();
  const paletteIndices = Array.isArray(raw?.paletteIndices)
    ? [...new Set(raw.paletteIndices.filter(mbPaletteEligibleForRandom))].sort((a, b) => a - b)
    : defaultPalettes;
  const custom = [];
  if (Array.isArray(raw?.custom)) {
    for (const entry of raw.custom) {
      if (!entry || typeof entry !== 'object') continue;
      const hex = typeof entry.hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(entry.hex) ? entry.hex : '';
      if (!hex) continue;
      custom.push({
        id: typeof entry.id === 'string' && entry.id ? entry.id : `custom-${custom.length}`,
        name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'Custom',
        hex,
      });
      if (custom.length >= 16) break;
    }
  }
  return {
    paletteIndices: paletteIndices.length > 0 || custom.length > 0 ? paletteIndices : defaultPalettes,
    custom,
  };
}

export const MB_EFFECT_CLASS_META = [
  { key: 'singleColor', label: 'Single Color', description: 'E905 — one palette color on selected LEDs', badge: 'Fully Decoded', tier: 1 },
  { key: 'dualColor', label: 'Dual Color', description: 'E906 — inner + outer ring colors', badge: 'Fully Decoded', tier: 1 },
  { key: 'sixBitColor', label: '6-bit Color', description: 'E908 — raw RGB channels', badge: 'Fully Decoded', tier: 1 },
  { key: 'fivePositionPalette', label: '5-Position Palette', description: 'E909 / E90C palette mode — five corner slots', badge: 'Fully Decoded', tier: 1 },
  { key: 'fivePositionFlash', label: '5-Position Flash Pattern', description: 'E90E — subset flash/hold patterns', badge: 'Partially Decoded', tier: 1 },
  { key: 'unclassified', label: 'Unclassified / Unknown', description: 'E910, E913, E90C animation mode, etc.', badge: 'Preset Only', tier: 2 },
];

export const TIER2_OPCODE_OPTIONS = ['E90C', 'E90F', 'E910', 'E911', 'E912', 'E913', 'E914', 'E91B'];

export const MB_SEGMENT_META = [
  { id: 'all', label: 'All', hint: 'E905 mask 000 — full strip (WLED seg 0)' },
  { id: 'inner', label: 'Inner ring', hint: 'E906 inner — start/stop only; id assigned at runtime' },
  { id: 'outer', label: 'Outer ring', hint: 'E906 outer — start/stop only; id assigned at runtime' },
  { id: 'topLeft', label: 'Top left', hint: 'E909 TL — start/stop only' },
  { id: 'topRight', label: 'Top right', hint: 'E909 TR — start/stop only' },
  { id: 'bottomLeft', label: 'Bottom left', hint: 'E909 BL — start/stop only' },
  { id: 'bottomRight', label: 'Bottom right', hint: 'E909 BR — start/stop only' },
  { id: 'center', label: 'Center', hint: 'E909 center — start/stop only' },
  { id: 'band0', label: 'Band LED 0', hint: 'E905 mask bit 0 — start/stop only' },
  { id: 'band1', label: 'Band LED 1', hint: 'E905 mask bit 1' },
  { id: 'band2', label: 'Band LED 2', hint: 'E905 mask bit 2' },
  { id: 'band3', label: 'Band LED 3', hint: 'E905 mask bit 3' },
  { id: 'band4', label: 'Band LED 4', hint: 'E905 mask bit 4' },
  { id: 'band5', label: 'Band LED 5', hint: 'reserved — not yet wired to a trigger' },
  { id: 'band6', label: 'Band LED 6', hint: 'reserved — not yet wired to a trigger' },
  { id: 'band7', label: 'Band LED 7', hint: 'reserved — not yet wired to a trigger' },
];

export const MB_ANIMATION_META = [
  { key: 'E90C', label: 'Show FX (Taste the Rainbow)' },
  { key: 'E90E', label: 'Flash' },
  { key: 'E90F', label: 'Animation F' },
  { key: 'E910', label: 'Animation 10' },
  { key: 'E911', label: 'Cross-fade' },
  { key: 'E912', label: 'Circle' },
  { key: 'E913', label: 'Pulse' },
  { key: 'wand', label: 'Starlight Wand cast (legacy)' },
];

export const SW_ANIMATION_META = [
  { key: 'wand', label: 'Color cast', hint: 'CF0B / CF9B palette transfer' },
  { key: 'rainbow', label: 'rainbow', hint: 'E90C Taste the Rainbow' },
  { key: 'blink', label: 'blink', hint: 'E90C white blink' },
  { key: 'palette5', label: 'palette5', hint: 'E90C five-palette cycle' },
  { key: 'flash', label: 'flash', hint: 'E90E purple/white flash' },
  { key: 'sparkle', label: 'sparkle', hint: 'E910 blue sparkle' },
  { key: 'pulse', label: 'pulse', hint: 'E913 purple pulse' },
  { key: 'circle', label: 'circle', hint: 'E912 blue circle' },
  { key: 'fade', label: 'fade', hint: 'E911 cyan → pink' },
  { key: 'fade2', label: 'fade2', hint: 'E911 pink → green' },
];

export const MB_PATTERN_META = [
  { key: '3', label: 'Spin (palette B)' },
  { key: '4', label: 'Solid palette A' },
  { key: '5', label: 'All LEDs on' },
  { key: '8', label: 'Four / five corners' },
  { key: 'B', label: 'All on palette B' },
];

export const STRIP_LED_COUNT = 100;

export const MB_SEGMENT_SIM_COMMAND = {
  all: 'test all', inner: 'test inner', outer: 'test outer',
  topLeft: 'test topLeft', topRight: 'test topRight',
  bottomLeft: 'test bottomLeft', bottomRight: 'test bottomRight',
  center: 'test center',
  band0: 'test band0', band1: 'test band1', band2: 'test band2',
  band3: 'test band3', band4: 'test band4', band5: 'test band5',
  band6: 'test band6', band7: 'test band7',
};

export const SIM_FIVE_CORNERS = 'test five';

export const FIVE_CORNER_IDS = ['topLeft', 'bottomLeft', 'bottomRight', 'topRight', 'center'];

export const FIVE_CORNER_RGB = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255], [255, 255, 0]];
