#include "DisneyBleFilter.h"
#include "Globals.h"
#include "Config.h"

void disneyPayload(const uint8_t* data, size_t len, const uint8_t*& payload, size_t& plen) {
  if (len >= 2 && data[0] == 0x83 && data[1] == 0x01) {
    payload = data + 2;
    plen = len - 2;
  } else {
    payload = data;
    plen = len;
  }
}

bool isDisneyMfr(const uint8_t* data, size_t len) {
  if (len >= 2 && data[0] == 0x83 && data[1] == 0x01) return true;
  const uint8_t* p;
  size_t pl;
  disneyPayload(data, len, p, pl);
  return isWandCast(p, pl) || isLegacyCf9bCast(p, pl) || isWandIdleBeacon(p, pl)
      || (pl >= 1 && (p[0] == 0xCC || p[0] == 0xE1 || p[0] == 0xE2 || p[0] == 0xE9));
}

bool isWandCast(const uint8_t* payload, size_t plen) {
  return plen == WAND_CAST_LEN && memcmp(payload, WAND_CAST_SIG, 6) == 0;
}

bool isWandIdleBeacon(const uint8_t* payload, size_t plen) {
  return plen >= 4 && payload[0] == 0x0F && payload[1] == 0x11;
}

bool isLegacyCf9bCast(const uint8_t* payload, size_t plen) {
  return plen >= 8 && payload[0] == 0xCF && payload[1] == 0x9B;
}

const char* classifyScanPacket(const uint8_t* data, size_t len) {
  const uint8_t* p;
  size_t pl;
  disneyPayload(data, len, p, pl);
  if (isWandCast(p, pl)) return "WAND-CAST";
  if (isLegacyCf9bCast(p, pl)) return "WAND-CF9B";
  if (isWandIdleBeacon(p, pl)) return "WAND-IDLE";
  if (pl >= 2 && p[0] == 0xCC && p[1] == 0x03) return "PING";
  if (pl >= 5 && (p[0] == 0xE1 || p[0] == 0xE2) && p[2] == 0xE9) return "MB+";
  if (pl >= 2 && p[0] == 0xE9) return "SHOW";
  return "DISNEY";
}

bool scanDedupIsNew(const uint8_t* data, size_t len) {
  size_t cmpLen = len < 48 ? len : 48;
  bool same = (cmpLen == lastLogLen && memcmp(data, lastLogBytes, cmpLen) == 0);
  if (same) {
    scanRepeatCount++;
    return false;
  }
  if (scanRepeatCount > 0) scanRepeatCount = 0;
  memcpy(lastLogBytes, data, cmpLen);
  lastLogLen = cmpLen;
  return true;
}

String mfrToHex(const uint8_t* data, size_t len) {
  String hex = "";
  for (size_t i = 0; i < len && i < 32; i++) {
    if (data[i] < 0x10) hex += "0";
    hex += String(data[i], HEX);
  }
  return hex;
}

String mfrToHexFull(const uint8_t* data, size_t len, size_t maxLen) {
  String hex = "";
  size_t n = len < maxLen ? len : maxLen;
  for (size_t i = 0; i < n; i++) {
    if (data[i] < 0x10) hex += "0";
    hex += String(data[i], HEX);
  }
  if (len > maxLen) hex += "…";
  return hex;
}

