#pragma once

#include <Arduino.h>
#include <stdint.h>
#include <stddef.h>

/** MB+/effect envelope byte: real opcode sits at payload[2..3] after `00`. */
inline bool isMbEnvelopeByte(uint8_t b) {
  return b == 0xE0 || b == 0xE1 || b == 0xE2 || b == 0xE3;
}

void disneyPayload(const uint8_t* data, size_t len, const uint8_t*& payload, size_t& plen);
bool isDisneyMfr(const uint8_t* data, size_t len);
bool isWandCast(const uint8_t* payload, size_t plen);
bool isWandIdleBeacon(const uint8_t* payload, size_t plen);
bool isLegacyCf9bCast(const uint8_t* payload, size_t plen);
const char* classifyScanPacket(const uint8_t* data, size_t len);
bool scanDedupIsNew(const uint8_t* data, size_t len);
String mfrToHex(const uint8_t* data, size_t len);
String mfrToHexFull(const uint8_t* data, size_t len, size_t maxLen = 64);
