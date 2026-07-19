#pragma once

#include "Types.h"
#include <stdint.h>
#include <stddef.h>

void applyParsedDisneyPacket(const ParsedDisneyPacket& pkt);
void handleDisneyPayload(const uint8_t* payload, size_t plen);
void handleWandCast(const uint8_t* payload, size_t plen);
void handleLegacyCf9bCast(const uint8_t* payload, size_t plen);
void handleE1E2Payload(const uint8_t* payload, size_t plen);
void handleShowPayload(const uint8_t* payload, size_t plen);
void notifyWandPalette(uint8_t paletteIdx, OverrideSource src);
bool mbEffectIsRepeatAdvert(const uint8_t* payload, size_t plen);
void rememberMbEffect(const uint8_t* payload, size_t plen);
void notifyMbE9ToApp(const uint8_t* payload, size_t plen);
void notifyUnknownAnimation(const uint8_t* payload, size_t plen, SwMatchQuality quality, uint16_t func);
