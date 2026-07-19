#pragma once

#include "Types.h"
#include <stdint.h>
#include <stddef.h>

uint8_t decodeE905MaskByte(const uint8_t* payload);
uint8_t decodeE905Palette(const uint8_t* payload);
bool e90cIsPaletteSubMode(const uint8_t* payload, size_t plen);
bool e909UsesPatternSlots(const uint8_t* payload);
uint8_t scale6To8(uint8_t v);

// Classify + decode Disney manufacturer payload (after 0x8301 strip).
// Pure function of bytes → ParsedDisneyPacket. No WLED / NVS / override calls.
ParsedDisneyPacket decodeDisneyPayload(const uint8_t* payload, size_t plen, unsigned long capturedAtMs);
