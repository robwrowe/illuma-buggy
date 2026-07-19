#include "ColorPalette.h"
#include "Globals.h"

void paletteToRGBDirect(uint8_t idx, uint8_t& r, uint8_t& g, uint8_t& b) {
  idx &= 0x1F;
  r = mbWledColors[idx][0];
  g = mbWledColors[idx][1];
  b = mbWledColors[idx][2];
}

void paletteToRGB(uint8_t idx, uint8_t& r, uint8_t& g, uint8_t& b) {
  idx &= 0x1F;
  if (idx == MB_PAL_RANDOM) {
    pickRandomMbColorFresh(r, g, b);
    return;
  }
  paletteToRGBDirect(idx, r, g, b);
}

void pickRandomMbColor(uint8_t& r, uint8_t& g, uint8_t& b) {
  uint16_t total = mbRandomPoolCount + mbRandomCustomCount;
  if (total == 0) {
    loadMbRandomPoolDefaults();
    total = mbRandomPoolCount;
  }
  if (total == 0) {
    r = g = b = 0;
    return;
  }
  uint16_t pick = (uint16_t)random(0, (long)total);
  if (pick < mbRandomPoolCount) {
    paletteToRGBDirect(mbRandomPool[pick], r, g, b);
    return;
  }
  uint8_t ci = (uint8_t)(pick - mbRandomPoolCount);
  r = mbRandomCustom[ci][0];
  g = mbRandomCustom[ci][1];
  b = mbRandomCustom[ci][2];
}

void pickRandomMbColorFresh(uint8_t& r, uint8_t& g, uint8_t& b) {
  for (int attempt = 0; attempt < 8; attempt++) {
    pickRandomMbColor(r, g, b);
    if (!lastEphemeralValid || r != lastEphemeralR || g != lastEphemeralG || b != lastEphemeralB) break;
  }
  lastEphemeralR = r;
  lastEphemeralG = g;
  lastEphemeralB = b;
  lastEphemeralValid = true;
}

bool mbPaletteEligibleForRandom(uint8_t idx) {
  idx &= 0x1F;
  return idx < MB_PAL_RANDOM && idx != MB_PAL_OFF && idx != MB_PAL_UNIQUE;
}

void loadMbRandomPoolDefaults() {
  mbRandomPoolCount = 0;
  for (uint8_t i = 0; i < MB_PAL_RANDOM; i++) {
    if (!mbPaletteEligibleForRandom(i)) continue;
    if (mbRandomPoolCount >= MB_MAX_RANDOM_POOL) break;
    mbRandomPool[mbRandomPoolCount++] = i;
  }
  mbRandomCustomCount = 0;
}

