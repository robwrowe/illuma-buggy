#pragma once

#include <stdint.h>
void paletteToRGB(uint8_t idx, uint8_t& r, uint8_t& g, uint8_t& b);
void paletteToRGBDirect(uint8_t idx, uint8_t& r, uint8_t& g, uint8_t& b);
void pickRandomMbColor(uint8_t& r, uint8_t& g, uint8_t& b);
void pickRandomMbColorFresh(uint8_t& r, uint8_t& g, uint8_t& b);
bool mbPaletteEligibleForRandom(uint8_t idx);
void loadMbRandomPoolDefaults();
