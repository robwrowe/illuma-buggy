#pragma once
#include <ArduinoJson.h>
#include <stdint.h>

/** Parse #RRGGBB into r/g/b. No-op (zeros) on invalid input. */
void parseHexColor(const char* hex, uint8_t& r, uint8_t& g, uint8_t& b);

/** WLED v16 seg.bm from Illuma blend id (legacy "normal" → Top). */
uint8_t blendModeToBm(const char* blend);

/** Ensure a WLED seg object exists for the map segment's wledSegId. */
JsonObject ensureWledSegByLocalId(JsonObject wled, JsonObject segDef);

void setSegColorSlot(JsonObject segObj, int colorSlot, uint8_t r, uint8_t g, uint8_t b);
void setSegNumericField(JsonObject segObj, const char* field, float value);
void applyPresetVariables(JsonObject segObj, JsonObject presetVariables);

/** Seed `wled["seg"]` from a segment map, filling gaps with `globalLook`.
 *  globalLook is either a rule's `effect` object or a preset's `global` object —
 *  both share field names (fx, pal, sx, ix, c1-c3, o1-o3, col). */
void seedWledFromSegmentMap(JsonObject wled, JsonObject segMap,
                            JsonObject globalLook, bool hasGlobalLook);

/** Apply per-segment overrides (rule.segmentOverrides or preset.segmentOverrides —
 *  identical shape) onto WLED segs already seeded by seedWledFromSegmentMap(). */
void applySegmentOverridesOntoWled(JsonObject wled, JsonObject segMap,
                                   JsonObject globalLook, bool hasGlobalLook,
                                   JsonObject segmentOverrides);

/** Resolve a stored preset JSON document into a WLED apply payload.
 *  Handles map-linked presets (global + segmentMapId + segmentOverrides)
 *  and map-less presets (global.seg / legacy wled blob — see preset override spec §3.3).
 *  Accepts legacy top-level "wled" as a fallback for "global". */
bool buildWledFromPresetDoc(JsonDocument& presetDoc, JsonDocument& outWledDoc);
