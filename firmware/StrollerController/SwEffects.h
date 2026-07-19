#pragma once

#include "Types.h"
#include <stdint.h>
#include <stddef.h>
bool applySwAnimationKey(const char* key, const uint8_t* pals, int palCount, OverrideSource src);
void applySwAnimOpcode(const char* swKey, const char* label);
void applySwAnimFallbackSolid(OverrideSource src);
bool tryApplySwE9Payload(const uint8_t* payload, size_t plen, const char* mbFallbackKey, const char* label);
bool swPayloadMatchesRef(const uint8_t* payload, size_t plen, const uint8_t* ref, size_t refLen);
const char* identifySwFxPreset(const uint8_t* payload, size_t plen);
SwMatchQuality identifySwFxPresetQuality(const uint8_t* payload, size_t plen, const char** outKey);
uint16_t swPayloadFuncCode(const uint8_t* payload, size_t plen);
bool wandCastIsDuplicateAdvert(const uint8_t* payload, size_t plen);
void rememberWandCast(const uint8_t* payload, size_t plen);
