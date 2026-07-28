#include "SdRuleLogger.h"
#include "Config.h"
#include <SD.h>
#include <SPI.h>
#include <string.h>

static bool sdReady = false;
static File logFile;
static char currentLogPath[32];

// In-RAM ring so BLE pull does not need SD seek. Survives SD soft-fail after boot.
static constexpr size_t SD_RULE_LOG_RING_CAP = 96;
static constexpr size_t SD_RULE_LOG_LINE_MAX = 220;
static char ringLines[SD_RULE_LOG_RING_CAP][SD_RULE_LOG_LINE_MAX];
static uint16_t ringWrite = 0;
static uint16_t ringCount = 0;

static void ringPush(const char* line) {
  if (!line || !line[0]) return;
  strncpy(ringLines[ringWrite], line, SD_RULE_LOG_LINE_MAX - 1);
  ringLines[ringWrite][SD_RULE_LOG_LINE_MAX - 1] = '\0';
  ringWrite = (uint16_t)((ringWrite + 1) % SD_RULE_LOG_RING_CAP);
  if (ringCount < SD_RULE_LOG_RING_CAP) ringCount++;
}

static bool eventAllowed(const char* line, const char* eventFilter) {
  if (!eventFilter || !eventFilter[0]) return true;
  // line always contains "event":"<name>" from sdRuleLoggerWrite.
  const char* ev = strstr(line, "\"event\":\"");
  if (!ev) return false;
  ev += 9;
  const char* end = strchr(ev, '"');
  if (!end || end <= ev) return false;
  char name[32];
  size_t n = (size_t)(end - ev);
  if (n >= sizeof(name)) n = sizeof(name) - 1;
  memcpy(name, ev, n);
  name[n] = '\0';

  // Comma-separated allow-list.
  const char* p = eventFilter;
  while (*p) {
    while (*p == ' ' || *p == ',') p++;
    if (!*p) break;
    const char* start = p;
    while (*p && *p != ',') p++;
    size_t len = (size_t)(p - start);
    while (len > 0 && start[len - 1] == ' ') len--;
    if (len == n && strncmp(start, name, n) == 0) return true;
  }
  return false;
}

bool sdRuleLoggerInit() {
  SPI.begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);
  if (!SD.begin(SD_CS_PIN)) {
    Serial.println("[SD] mount failed (ring log still active in RAM)");
    sdReady = false;
    currentLogPath[0] = '\0';
    return false;
  }
  snprintf(currentLogPath, sizeof(currentLogPath), "/rules_%lu.jsonl", (unsigned long)millis());
  logFile = SD.open(currentLogPath, FILE_WRITE);
  sdReady = (bool)logFile;
  Serial.printf("[SD] %s, logging to %s\n", sdReady ? "ready" : "open failed", currentLogPath);
  return sdReady;
}

bool sdRuleLoggerReady() { return sdReady; }

const char* sdRuleLoggerPath() { return currentLogPath; }

size_t sdRuleLoggerRingCount() { return ringCount; }

void sdRuleLoggerWrite(const char* event, const char* detailJson) {
  if (!event) return;
  char line[SD_RULE_LOG_LINE_MAX];
  int n = snprintf(line, sizeof(line), "{\"ts\":%lu,\"event\":\"%s\"",
                   (unsigned long)millis(), event);
  if (n < 0) return;
  if (detailJson && detailJson[0] && (size_t)n < sizeof(line) - 2) {
    n += snprintf(line + n, sizeof(line) - (size_t)n, ",%s", detailJson);
  }
  if (n > 0 && (size_t)n < sizeof(line) - 2) {
    line[n++] = '}';
    line[n] = '\0';
  } else {
    // Truncate safely.
    line[sizeof(line) - 2] = '}';
    line[sizeof(line) - 1] = '\0';
  }

  ringPush(line);

  if (!sdReady) return;
  logFile.print(line);
  logFile.print('\n');
  logFile.flush();
}

size_t sdRuleLoggerBuildTailJson(String& out, size_t maxLines, const char* eventFilter) {
  out = "[";
  if (ringCount == 0 || maxLines == 0) {
    out += "]";
    return 0;
  }
  if (maxLines > ringCount) maxLines = ringCount;
  if (maxLines > SD_RULE_LOG_RING_CAP) maxLines = SD_RULE_LOG_RING_CAP;

  // Collect newest-first indices, then emit oldest→newest among the window.
  size_t matched = 0;
  // Scan from newest backwards until we have maxLines matches (or exhaust ring).
  size_t indices[SD_RULE_LOG_RING_CAP];
  for (size_t i = 0; i < ringCount && matched < maxLines; i++) {
    size_t idx = (size_t)((ringWrite + SD_RULE_LOG_RING_CAP - 1 - i) % SD_RULE_LOG_RING_CAP);
    if (!eventAllowed(ringLines[idx], eventFilter)) continue;
    indices[matched++] = idx;
  }

  // indices[0] is newest; reverse for chronological order.
  bool first = true;
  for (size_t i = matched; i > 0; i--) {
    if (!first) out += ",";
    first = false;
    out += ringLines[indices[i - 1]];
  }
  out += "]";
  return matched;
}
