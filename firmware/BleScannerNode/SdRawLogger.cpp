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
  Serial.println("[SD] skipped (disabled on this build)");
  sdReady = false;
  return false;
#else
  // Pass SPI + freq explicitly. Plain SD.begin(cs) can re-init SPI oddly;
  // slow clock helps breadboard / cheap modules.
  pinMode(SD_CS_PIN, OUTPUT);
  digitalWrite(SD_CS_PIN, HIGH);
  SPI.begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);

  const uint32_t freqs[] = {1000000u, 400000u, 4000000u};
  bool mounted = false;
  for (uint32_t freq : freqs) {
    Serial.printf("[SD] begin CS=%d SCK=%d MOSI=%d MISO=%d @ %lu Hz\n",
                  SD_CS_PIN, SD_SCK_PIN, SD_MOSI_PIN, SD_MISO_PIN,
                  (unsigned long)freq);
    if (SD.begin(SD_CS_PIN, SPI, freq)) {
      mounted = true;
      break;
    }
    SD.end();
    delay(50);
  }

  if (!mounted) {
    Serial.println("[SD] mount failed");
    Serial.println("[SD] check: FAT32 not exFAT (Win11 32GB+ often exFAT), 3.3V module VCC");
    sdReady = false;
    return false;
  }

  uint8_t type = SD.cardType();
  Serial.printf("[SD] cardType=%u size=%llu MB\n",
                (unsigned)type, (unsigned long long)(SD.cardSize() / (1024ULL * 1024ULL)));

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
