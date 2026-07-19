#pragma once

#include <ArduinoJson.h>
#include <stdint.h>
#include <stddef.h>

enum class CurveType : uint8_t { LINEAR, EXPONENTIAL };

// Shared bit extraction. bitStart/bitCount are LSB-first within the byte at byteOffset.
uint32_t extractBits(const uint8_t* payload, size_t plen, uint8_t byteOffset,
                     uint8_t bitStart, uint8_t bitCount);

float applyCurve(uint32_t rawValue, uint32_t inMin, uint32_t inMax,
                 float outMin, float outMax, CurveType type, float exponent);

bool evaluateConditionGroup(const uint8_t* payload, size_t plen, const JsonObject& groupNode);

// Returns index into rules array, or -1 if no match. Rules must already be sorted by priority
// (lower first) or this will sort by priority field during evaluation.
int findMatchingRule(const uint8_t* payload, size_t plen, const JsonArray& rules);

void applyMatchedRule(const JsonObject& rule, const uint8_t* payload, size_t plen);

// Load/parse the rules document (rules + colors + segments + paradeDetection + defaultPresetId).
void applyMbRulesJson(JsonObject root);
void loadMbRulesFromJson();

// Parade beacon detection (separate from effect rules).
void checkParadeBeacon(const uint8_t* payload, size_t plen, int rssi);
void serviceParadeCooldown();
void manualParadeStart();
void manualParadeStop();

void notifyMbUnmatched(const uint8_t* payload, size_t plen);
JsonArray mbRulesJsonArray();

