#pragma once

#include "Types.h"
#include <Arduino.h>

// Serial-console debug helpers (mb five / mb <pal> [mask]) — not on the packet path.
void applyMbFive(uint8_t topLeft, uint8_t bottomLeft, uint8_t bottomRight, uint8_t topRight, uint8_t center, OverrideSource src);
void applyMbSegmentSolid(const char* segKey, uint8_t palIdx, OverrideSource src);
void applyMbMultiSegmentSolid(const char* segKeys[], const uint8_t pals[], int n, OverrideSource src);
void applyMbSingleMask(uint8_t mask8, uint8_t pal, OverrideSource src);

void disableAllSplitSegments();
void applyMbFullStripOff(OverrideSource src);
bool isMbColorBlack(uint8_t r, uint8_t g, uint8_t b);
void appendDisableWledSegment(String& body, uint8_t segId, bool& first);
void appendDisableInactiveSegments(String& body, bool& first, const uint8_t* activeIds, uint8_t activeCount, bool disableSeg0);
void appendWledSolidSeg(String& body, const WledSegRef& ref, uint8_t r, uint8_t g, uint8_t b, bool& first);
void addActiveSegId(uint8_t id, uint8_t* out, uint8_t& count);
void collectActiveSegIds(const MbSegMap& map, uint8_t* out, uint8_t& count);
