#pragma once

#include "Types.h"
#include <Arduino.h>
void applyMbSingle(uint8_t colorByte, OverrideSource src);
void applyMbDual(uint8_t innerByte, uint8_t outerByte, OverrideSource src);
void applyMbFive(uint8_t topLeft, uint8_t bottomLeft, uint8_t bottomRight, uint8_t topRight, uint8_t center, OverrideSource src);
void applyMbSegmentSolid(const char* segKey, uint8_t palIdx, OverrideSource src);
void applyMbMultiSegmentSolid(const char* segKeys[], const uint8_t pals[], int n, OverrideSource src);
void applyMagicBandChase(const uint8_t paletteIdxs[5], OverrideSource src);
void applyMagicBandChaseFromAnchor(uint8_t anchorPalette, OverrideSource src);
String buildMagicBandChaseJson(const uint8_t paletteIdxs[5]);
bool applyMbPresetWithColors(const MbEffectMap& map, const uint8_t* packetPals, int packetPalCount, OverrideSource src);
bool applyMbAnimationKey(const char* key, const uint8_t* pals, int palCount, OverrideSource src);
bool applyMbPatternKey(const char* patKey, const uint8_t* pals, int palCount, OverrideSource src);
void applyMbAnimOpcode(const char* animKey, const char* label);
void disableMbSplitSegments();
void disableAllSplitSegments();
void applyFullStripSolid(uint8_t r, uint8_t g, uint8_t b, OverrideSource src);
void applyMbFullStripOff(OverrideSource src);
bool isMbColorBlack(uint8_t r, uint8_t g, uint8_t b);
void appendDisableWledSegment(String& body, uint8_t segId, bool& first);
void appendDisableInactiveSegments(String& body, bool& first, const uint8_t* activeIds, uint8_t activeCount, bool disableSeg0);
void appendWledSolidSeg(String& body, const WledSegRef& ref, uint8_t r, uint8_t g, uint8_t b, bool& first);
void addActiveSegId(uint8_t id, uint8_t* out, uint8_t& count);
void collectActiveSegIds(const MbSegMap& map, uint8_t* out, uint8_t& count);
void applyMbSingleMask(uint8_t mask8, uint8_t pal, OverrideSource src);
void applyMbSingleE905(const uint8_t* payload, OverrideSource src);
