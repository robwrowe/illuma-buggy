#include "SwEffects.h"
#include "Globals.h"
#include <string.h>

bool wandCastIsDuplicateAdvert(const uint8_t* payload, size_t plen) {
  unsigned long now = millis();
  if (plen == 0 || plen > sizeof(lastWandCastPayload)) return false;
  if (plen != lastWandCastLen) return false;
  if (memcmp(payload, lastWandCastPayload, plen) != 0) return false;
  return (now - lastWandCastMs) < 250;
}

void rememberWandCast(const uint8_t* payload, size_t plen) {
  if (plen > sizeof(lastWandCastPayload)) plen = sizeof(lastWandCastPayload);
  memcpy(lastWandCastPayload, payload, plen);
  lastWandCastLen = plen;
  lastWandCastMs = millis();
}
