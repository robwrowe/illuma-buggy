#pragma once

#include <Arduino.h>
#include <stdint.h>
#include <stddef.h>
void disneyPayload(const uint8_t* data, size_t len, const uint8_t*& payload, size_t& plen);
bool isDisneyMfr(const uint8_t* data, size_t len);
bool isWandCast(const uint8_t* payload, size_t plen);
bool isWandIdleBeacon(const uint8_t* payload, size_t plen);
bool isLegacyCf9bCast(const uint8_t* payload, size_t plen);
const char* classifyScanPacket(const uint8_t* data, size_t len);
bool scanDedupIsNew(const uint8_t* data, size_t len);
String mfrToHex(const uint8_t* data, size_t len);
String mfrToHexFull(const uint8_t* data, size_t len, size_t maxLen = 64);
