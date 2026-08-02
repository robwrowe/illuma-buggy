#pragma once
#include <Arduino.h>

bool sdRuleLoggerInit();
bool sdRuleLoggerReady();
/** Current SD file path (e.g. `/rules_123.jsonl`), or empty if not ready. */
const char* sdRuleLoggerPath();
/** Lines currently held in the in-RAM ring (capped). */
size_t sdRuleLoggerRingCount();

void sdRuleLoggerWrite(const char* event, const char* detailJson);

/**
 * Build a JSON array string of the newest `maxLines` ring entries.
 * Optional `eventFilter`: comma-separated event names (e.g. `marker,match,suppressed`).
 * Empty/null = all events. Returns number of lines included.
 */
size_t sdRuleLoggerBuildTailJson(String& out, size_t maxLines, const char* eventFilter);
