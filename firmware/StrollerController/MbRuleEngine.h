#pragma once

#include <ArduinoJson.h>
#include <stdint.h>
#include <stddef.h>

enum class CurveType : uint8_t { LINEAR, EXPONENTIAL, RECIPROCAL };

// Shared bit extraction. bitStart/bitCount are LSB-first within the byte at byteOffset.
uint32_t extractBits(const uint8_t* payload, size_t plen, uint8_t byteOffset,
                     uint8_t bitStart, uint8_t bitCount);

// outScale used by RECIPROCAL only (default 50 = WLED Strobe: sx = outMax - 50/hz).
// rawValue/inMin/inMax are float so timingFlashRate can pass fractional Hz (e.g. 0.35).
float applyCurve(float rawValue, float inMin, float inMax,
                 float outMin, float outMax, CurveType type, float exponent,
                 float outScale = 50.0f);

bool evaluateConditionGroup(const uint8_t* payload, size_t plen, const JsonObject& groupNode);

// Returns index into rules array, or -1 if no match. Rules must already be sorted by priority
// (lower first) or this will sort by priority field during evaluation.
int findMatchingRule(const uint8_t* payload, size_t plen, const JsonArray& rules);

void applyMatchedRule(const JsonObject& rule, const uint8_t* payload, size_t plen);

/** Look up a rule object by id in the live rules cache. Null if missing. */
JsonObject findRuleById(const char* ruleId);
/**
 * True when the currently active timed rule (through COOLDOWN / black hold) has
 * ignoreAllOtherRules or ignoreLowerPriority set and should suppress applying
 * `candidate`. Exact re-match of the active rule id is never blocked.
 */
bool exclusiveActiveBlocksRule(const JsonObject& candidate);

/** Look up a segment map by id in the cached MB rules doc. Null object if missing. */
JsonObject findSegmentMapById(const char* mapId);
/** Look up a segment by id within a segment map. Null object if missing. */
JsonObject findSegmentInMap(JsonObject segMap, const char* segmentId);
/** Segment map for the currently active timed rule (`mbActiveRuleId`). Null if none. */
JsonObject mbSegMapForActiveRule();

// Load/parse the rules document (rules + segmentMaps + colors + paradeDetection + …).
// Returns false when a full-replace cache reparse fails (previous gRulesDoc kept).
bool applyMbRulesJson(JsonObject root);
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
/** Force BLACK_HOLD→restore immediately (e.g. rule disabled mid-lifecycle). */
void forceRuleLifecycleRestore();
// Called when the active timed rule matches again while a lifecycle is active.
// ON: extend slack. DIP/FADE: ignore trailing / abort FTB and apply immediately.
// COOLDOWN onMatch: re-apply after quiet gap.
// Returns true if the match was accepted (caller should touch the idle timer).
bool onTimedRuleRepeatMatch(const JsonObject& rule, const uint8_t* payload, size_t plen);

void notifyMbUnmatched(const uint8_t* payload, size_t plen, bool force = false);
JsonArray mbRulesJsonArray();
JsonArray mbSegmentMapsArray();
/** Serialize the live gRulesDoc cache into `out`. */
bool mbRulesCacheSerialize(String& out);
/** Serialize gRulesDoc → mbRulesJson/mbMappingJson → SPIFFS. */
bool persistMbRulesCache();

