#include "SdRuleLogger.h"
#include "Config.h"
#include <SD.h>
#include <SPI.h>

static bool sdReady = false;
static File logFile;
static char currentLogPath[32];

bool sdRuleLoggerInit() {
  SPI.begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);
  if (!SD.begin(SD_CS_PIN)) {
    Serial.println("[SD] mount failed");
    sdReady = false;
    return false;
  }
  snprintf(currentLogPath, sizeof(currentLogPath), "/rules_%lu.jsonl", (unsigned long)millis());
  logFile = SD.open(currentLogPath, FILE_WRITE);
  sdReady = (bool)logFile;
  Serial.printf("[SD] %s, logging to %s\n", sdReady ? "ready" : "open failed", currentLogPath);
  return sdReady;
}

bool sdRuleLoggerReady() { return sdReady; }

void sdRuleLoggerWrite(const char* event, const char* detailJson) {
  if (!sdReady || !event) return;
  logFile.printf("{\"ts\":%lu,\"event\":\"%s\"", (unsigned long)millis(), event);
  if (detailJson && detailJson[0]) {
    logFile.print(",");
    // detailJson is expected to be a comma-separated set of JSON fields without braces,
    // e.g. "\"id\":\"abc\",\"name\":\"x\""
    logFile.print(detailJson);
  }
  logFile.print("}\n");
  logFile.flush();
}
