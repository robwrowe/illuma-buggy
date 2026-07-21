#include "SwEffects.h"
#include "Globals.h"
#include "MbEffects.h"
#include "MbMapping.h"
#include "OverrideManager.h"
#include "ColorPalette.h"
#include "DisneyPayloadHandlers.h"
#include "DebugLog.h"
#include "BlePeripheral.h"
#include "WledClient.h"

static const uint8_t SW_PRESET_RAINBOW[] = {
  0xE1,0x00,0xE9,0x0C,0x00,0x0F,0x0F,0x5D,0x46,0x5B,0xF0,0x05,0x32,0x37,0x48,0xB0
};
static const uint8_t SW_PRESET_BLINK[] = {
  0xE1,0x00,0xE9,0x0C,0x00,0x0F,0x0F,0x5D,0x46,0x5B,0xF0,0x05,0x32,0x37,0x48,0x95
};
static const uint8_t SW_PRESET_PALETTE5[] = {
  0xE1,0x00,0xE9,0x0C,0x00,0x0F,0x0F,0xB1,0xB9,0xB5,0xB1,0xA2,0x30,0x7B,0x7D,0xB0
};
static const uint8_t SW_PRESET_FLASH[] = {
  0xE1,0x00,0xE9,0x0E,0x00,0x01,0x0F,0xBD,0xA0,0xA0,0xBD,0xA0,0x59,0x07,0x00,0x48,0xAE,0xB5
};
static const uint8_t SW_PRESET_SPARKLE[] = {
  0xE1,0x00,0xE9,0x10,0x00,0x13,0x48,0x97,0xD0,0x0E,0xA0,0xD1,0x46,0x06,0x0F,0x30,0xD0,0x4E,0x07,0xB0
};
static const uint8_t SW_PRESET_PULSE[] = {
  0xE1,0x00,0xE9,0x13,0x00,0x02,0xD0,0x37,0xF0,0xD2,0x3D,0x05,0x05,0x00,0x0E,0xFA,0x89,0x83,0x51,0x0E,0xE7,0xA0,0xB0
};
static const uint8_t SW_PRESET_CIRCLE[] = {
  0xE2,0x00,0xE9,0x12,0x00,0x03,0x0F,0xA2,0xA2,0xA4,0xA4,0xA2,0x30,0xD0,0x37,0xF4,0xD2,0x46,0x00,0x64,0xFC,0xB8
};
static const uint8_t SW_PRESET_FADE[] = {
  0xE1,0x00,0xE9,0x11,0x00,0x6F,0x0F,0x56,0x48,0x58,0xF4,0x48,0x82,0xD1,0x46,0x02,0x08,0xD0,0x65,0x00,0xB0
};
static const uint8_t SW_PRESET_FADE2[] = {
  0xE1,0x00,0xE9,0x11,0x00,0x0F,0x0F,0x48,0x59,0x58,0xF4,0x48,0x82,0xD1,0x46,0x02,0x0D,0xD0,0x65,0x05,0xB0
};

static const SwFxSignature SW_FX_SIGNATURES[] = {
  { "rainbow",  SW_PRESET_RAINBOW,  sizeof(SW_PRESET_RAINBOW) },
  { "blink",    SW_PRESET_BLINK,    sizeof(SW_PRESET_BLINK) },
  { "palette5", SW_PRESET_PALETTE5, sizeof(SW_PRESET_PALETTE5) },
  { "flash",    SW_PRESET_FLASH,    sizeof(SW_PRESET_FLASH) },
  { "sparkle",  SW_PRESET_SPARKLE,  sizeof(SW_PRESET_SPARKLE) },
  { "pulse",    SW_PRESET_PULSE,    sizeof(SW_PRESET_PULSE) },
  { "circle",   SW_PRESET_CIRCLE,   sizeof(SW_PRESET_CIRCLE) },
  { "fade",     SW_PRESET_FADE,     sizeof(SW_PRESET_FADE) },
  { "fade2",    SW_PRESET_FADE2,    sizeof(SW_PRESET_FADE2) },
};
static const size_t SW_FX_SIGNATURE_COUNT = sizeof(SW_FX_SIGNATURES) / sizeof(SW_FX_SIGNATURES[0]);


bool applySwAnimationKey(const char* key, const uint8_t* pals, int palCount, OverrideSource src) {
  for (int i = 0; i < SW_ANIM_COUNT; i++) {
    if (strcmp(key, SW_ANIM_KEYS[i]) != 0) continue;
    if (applyMbPresetWithColors(swAnimMap[i], pals, palCount, src)) return true;
    return false;
  }
  return false;
}

void applySwAnimOpcode(const char* swKey, const char* label) {
  if (!starlightEnabled || !swKey) return;
  if (!canTakeOverride(BLE_STARLIGHT)) {
    bleNotify("{\"type\":\"sw_event\",\"event\":\"blocked\"}");
    return;
  }
  if (applySwAnimationKey(swKey, nullptr, 0, BLE_STARLIGHT)) {
    bleNotify("{\"type\":\"sw_event\",\"event\":\"fx\",\"name\":\"" + String(swKey) + "\"}");
    return;
  }
  applySwAnimFallbackSolid(BLE_STARLIGHT);
  bleNotify("{\"type\":\"sw_event\",\"event\":\"" + String(label) + "\",\"name\":\"" + String(swKey) + "\"}");
}

void applySwAnimFallbackSolid(OverrideSource src) {
  saveWledStateForOverride();
  uint8_t activeIds[1] = { 0 };
  uint8_t activeCount = 1;
  String body = "{\"on\":true,\"seg\":[";
  bool first = true;
  appendDisableInactiveSegments(body, first, activeIds, activeCount, false);
  body += "{\"id\":0,\"start\":0,\"stop\":" + String(STRIP_LED_COUNT) + ",\"fx\":0}";
  body += "]}";
  sendToWLEDForBleEffect(body);
  setOverride(src);
  touchOverrideIdleTimer(src);
}

bool tryApplySwE9Payload(const uint8_t* payload, size_t plen, const char* mbFallbackKey, const char* label) {
  if (!starlightEnabled) return false;
  const char* swKey = nullptr;
  identifySwFxPresetQuality(payload, plen, &swKey);
  if (!swKey) return false;
  if (!canTakeOverride(BLE_STARLIGHT)) {
    bleNotify("{\"type\":\"sw_event\",\"event\":\"blocked\"}");
    return true;
  }
  if (applySwAnimationKey(swKey, nullptr, 0, BLE_STARLIGHT)) {
    bleNotify("{\"type\":\"sw_event\",\"event\":\"fx\",\"name\":\"" + String(swKey) + "\"}");
    return true;
  }
  applySwAnimFallbackSolid(BLE_STARLIGHT);
  bleNotify("{\"type\":\"sw_event\",\"event\":\"" + String(label) + "\",\"name\":\"" + String(swKey) + "\"}");
  return true;
}

bool swPayloadMatchesRef(const uint8_t* payload, size_t plen, const uint8_t* ref, size_t refLen) {
  if (plen == refLen && memcmp(payload, ref, refLen) == 0) return true;
  if (plen >= 2 && payload[0] == 0xE9 && refLen >= 4 && ref[2] == 0xE9) {
    size_t innerLen = refLen - 2;
    if (plen == innerLen && memcmp(payload, ref + 2, innerLen) == 0) return true;
  }
  return false;
}

const char* identifySwFxPreset(const uint8_t* payload, size_t plen) {
  const char* key = nullptr;
  SwMatchQuality q = identifySwFxPresetQuality(payload, plen, &key);
  if (q == SW_MATCH_EXACT || q == SW_MATCH_FUZZY) return key;
  return nullptr;
}

SwMatchQuality identifySwFxPresetQuality(const uint8_t* payload, size_t plen, const char** outKey) {
  for (size_t i = 0; i < SW_FX_SIGNATURE_COUNT; i++) {
    if (swPayloadMatchesRef(payload, plen, SW_FX_SIGNATURES[i].data, SW_FX_SIGNATURES[i].len)) {
      if (outKey) *outKey = SW_FX_SIGNATURES[i].key;
      return SW_MATCH_EXACT;
    }
  }
  uint16_t func = 0;
  if (plen >= 4 && (payload[0] == 0xE1 || payload[0] == 0xE2) && payload[2] == 0xE9) {
    func = ((uint16_t)payload[2] << 8) | payload[3];
  } else if (plen >= 2 && payload[0] == 0xE9) {
    func = ((uint16_t)payload[0] << 8) | payload[1];
  }
  const char* fuzzyKey = nullptr;
  switch (func) {
    case 0xE90E: fuzzyKey = "flash"; break;
    case 0xE910: fuzzyKey = "sparkle"; break;
    case 0xE912: fuzzyKey = "circle"; break;
    case 0xE913: fuzzyKey = "pulse"; break;
    case 0xE911: fuzzyKey = "fade"; break;
    default: fuzzyKey = nullptr;
  }
  if (outKey) *outKey = fuzzyKey;
  if (fuzzyKey) return SW_MATCH_FUZZY;
  return SW_MATCH_NONE;
}

uint16_t swPayloadFuncCode(const uint8_t* payload, size_t plen) {
  if (plen >= 4 && (payload[0] == 0xE1 || payload[0] == 0xE2) && payload[2] == 0xE9) {
    return ((uint16_t)payload[2] << 8) | payload[3];
  }
  if (plen >= 2 && payload[0] == 0xE9) {
    return ((uint16_t)payload[0] << 8) | payload[1];
  }
  return 0;
}

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

