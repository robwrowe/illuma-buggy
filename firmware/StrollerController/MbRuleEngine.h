#pragma once

#include <ArduinoJson.h>
#include <stdint.h>
#include <stddef.h>

enum class CurveType : uint8_t { LINEAR, EXPONENTIAL, RECIPROCAL };

// Shared bit extraction. bitStart/bitCount are LSB-first within the byte at byteOffset.
uint32_t extractBits(const uint8_t* payload, size_t plen, uint8_t byteOffset,
                     uint8_t bitStart, uint8_t bitCount);

// outScale used by RECIPROCAL only (default 50 = WLED Strobe: sx = outMax - 50/hz).
float applyCurve(uint32_t rawValue, uint32_t inMin, uint32_t inMax,
                 float outMin, float outMax, CurveType type, float exponent,
                 float outScale = 50.0f);

bool evaluateConditionGroup(const uint8_t* payload, size_t plen, const JsonObject& groupNode);

// Returns index into rules array, or -1 if no match. Rules must already be sorted by priority
// (lower first) or this will sort by priority field during evaluation.
int findMatchingRule(const uint8_t* payload, size_t plen, const JsonArray& rules);

void applyMatchedRule(const JsonObject& rule, const uint8_t* payload, size_t plen);

// Load/parse the rules document (rules + segmentMaps + colors + paradeDetection + …).
void applyMbRulesJson(JsonObject root);
void loadMbRulesFromJson();
/** True when JSON parses and contains at least one entry in `rules[]`. */
bool mbRulesJsonUsable(const String& json);

// Parade beacon detection (separate from effect rules).
void checkParadeBeacon(const uint8_t* payload, size_t plen, int rssi);
void serviceParadeCooldown();
void manualParadeStart();
void manualParadeStop();

// Timing-byte lifecycle for rule-engine MB effects (Part 5).
void serviceMbRuleLifecycle();
void resetMbRuleLifecycle();
// Called when the same timed rule matches again while a lifecycle is active.
void onTimedRuleRepeatMatch(const JsonObject& rule, const uint8_t* payload, size_t plen);

void notifyMbUnmatched(const uint8_t* payload, size_t plen);
JsonArray mbRulesJsonArray();
JsonArray mbSegmentMapsArray();

