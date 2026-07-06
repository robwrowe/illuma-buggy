export function mbVibByte(vibration = 0) {
  return (0xB0 | (vibration & 0x0F)) & 0xFF;
}

export function mbFiveSlotByte(paletteIdx) {
  return (0xA0 | (paletteIdx & 0x1F)) & 0xFF;
}

export function mbColorByte(paletteIdx, patternNibble) {
  return ((patternNibble << 5) | (paletteIdx & 0x1F)) & 0xFF;
}

export function buildMbSingle(paletteIdx, mask = 0, timing = 0x09, vibration = 0) {
  const out = new Array(9);
  out[0] = 0xE1; out[1] = 0x00; out[2] = 0xE9; out[3] = 0x05; out[4] = 0x00; out[5] = timing;
  if (mask > 7 || (mask & 0xF8)) {
    out[6] = mask;
    out[7] = paletteIdx & 0x1F;
  } else {
    out[6] = 0x0E;
    out[7] = (((mask & 0x07) << 5) | (paletteIdx & 0x1F)) & 0xFF;
  }
  out[8] = mbVibByte(vibration);
  return out;
}

export function buildMbDual(innerIdx, outerIdx, timing = 0x22, vibration = 0) {
  return [
    0xE2, 0x00, 0xE9, 0x06, 0x00, timing, 0x0F,
    (0x40 | (innerIdx & 0x1F)) & 0xFF,
    (0x40 | (outerIdx & 0x1F)) & 0xFF,
    mbVibByte(vibration),
  ];
}

export function buildMbRgb(red, green, blue, timing = 0x0E, vibration = 0) {
  return [
    0xE1, 0x00, 0xE9, 0x08, 0x00, timing, 0xD2, 0x55,
    ((red & 0x3F) << 1) & 0xFF,
    ((green & 0x3F) << 1) & 0xFF,
    ((blue & 0x3F) << 1) & 0xFF,
    mbVibByte(vibration),
  ];
}

export function buildMbFive(tl, bl, br, tr, center, timing = 0x0E, vibration = 0, patternNibble = null) {
  const slot = (pal) => (patternNibble == null
    ? mbFiveSlotByte(pal)
    : mbColorByte(pal, patternNibble));
  return [
    0xE1, 0x00, 0xE9, 0x09, 0x00, timing, 0x0F,
    slot(tl),
    slot(bl),
    slot(br),
    slot(tr),
    slot(center),
    mbVibByte(vibration),
  ];
}

export function buildMbPing() {
  return [0xCC, 0x03, 0x00, 0x00, 0x00];
}
