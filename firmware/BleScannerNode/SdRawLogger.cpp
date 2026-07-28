#include "SdRawLogger.h"
#include "Config.h"

#if HAS_SD_LOGGER
#include <SD.h>
#include <SPI.h>
#endif

static bool sdReady = false;
#if HAS_SD_LOGGER
static File logFile;
static char currentLogPath[32];
#endif

bool sdRawLoggerInit() {
#if !HAS_SD_LOGGER
  Serial.println("[SD] skipped (not supported on this MCU / flash pin conflict)");
  sdReady = false;
  return false;
#else
  Serial.println("[SD] mounting…");
  SPI.begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);
  if (!SD.begin(SD_CS_PIN)) {
    Serial.println("[SD] mount failed");
    sdReady = false;
    return false;
  }
  snprintf(currentLogPath, sizeof(currentLogPath), "/scan_%lu.jsonl", (unsigned long)millis());
  logFile = SD.open(currentLogPath, FILE_WRITE);
  sdReady = (bool)logFile;
  Serial.printf("[SD] %s, logging to %s\n", sdReady ? "ready" : "open failed", currentLogPath);
  return sdReady;
#endif
}

bool sdRawLoggerReady() { return sdReady; }

void sdRawLoggerWrite(const uint8_t* mfrData, size_t len, int rssi, uint64_t tsMs) {
#if !HAS_SD_LOGGER
  (void)mfrData; (void)len; (void)rssi; (void)tsMs;
  return;
#else
  if (!sdReady || !mfrData || len == 0) return;
  String hex;
  hex.reserve(len * 2);
  for (size_t i = 0; i < len; i++) {
    char buf[3];
    snprintf(buf, sizeof(buf), "%02x", mfrData[i]);
    hex += buf;
  }
  logFile.printf("{\"ts\":%llu,\"rssi\":%d,\"hex\":\"%s\"}\n",
                 (unsigned long long)tsMs, rssi, hex.c_str());
  logFile.flush();
#endif
}
