#include "RuntimeFields.h"
#include "Globals.h"
#include "BlePeripheral.h"
#include "PayloadTransport.h"
#include <ArduinoJson.h>
#include <Preferences.h>
#include <string.h>

static String gBoardRoleFieldStaging;

static void onBoardRoleApply() {
  BoardRole next = (gBoardRoleFieldStaging == "logic_board" ||
                    gBoardRoleFieldStaging == "dual" ||
                    gBoardRoleFieldStaging == "dual_board")
                       ? BoardRole::LOGIC_BOARD
                       : BoardRole::STANDALONE;
  boardRole = next;
  prefs.begin("config", false);
  prefs.putUChar("boardRole", (uint8_t)boardRole);
  prefs.end();
  applyBoardRoleRuntime();
}

// NVS keys match existing StrollerController.ino / BleCommandHandler keys.
const RuntimeField kRuntimeFields[] = {
  { "overrideKillOnZone",    FieldType::BOOL,   nullptr,           &overrideKillOnZone, nullptr,                nullptr,                 0,    0,      0,  true,  "killOnZone", false, nullptr },
  { "starlightEnabled",      FieldType::BOOL,   nullptr,           &starlightEnabled,   nullptr,                nullptr,                 0,    0,      0,  true,  "swEn",       false, nullptr },
  { "starlightTimeoutMs",    FieldType::ULONG,  nullptr,           nullptr,             &starlightTimeoutMs,    nullptr,                 1000, 120000, 0,  true,  "swTimeout",  false, nullptr },
  { "magicBandEnabled",      FieldType::BOOL,   nullptr,           &magicBandEnabled,   nullptr,                nullptr,                 0,    0,      0,  true,  "mbEn",       false, nullptr },
  { "magicBandTimeoutMs",    FieldType::ULONG,  nullptr,           nullptr,             &magicBandTimeoutMs,    nullptr,                 1000, 120000, 0,  true,  "mbTimeout",  false, nullptr },
  { "bleEffectTransitionMs", FieldType::ULONG,  nullptr,           nullptr,             &bleEffectTransitionMs, nullptr,                 0,    5000,   0,  true,  "bleTransMs", false, nullptr },
  { "bleScanLogEnabled",     FieldType::BOOL,   nullptr,           &bleScanLogEnabled,  nullptr,                nullptr,                 0,    0,      0,  true,  "scanLog",    false, nullptr },
  { "rulesPaused",           FieldType::BOOL,   nullptr,           &rulesPaused,        nullptr,                nullptr,                 0,    0,      0,  true,  "rulesPaused", false, nullptr },
  { "boardRole",             FieldType::STRING_SHORT, nullptr,     nullptr,             nullptr,                &gBoardRoleFieldStaging, 0,    0,      16, false, nullptr,     false, onBoardRoleApply },
};
const size_t kRuntimeFieldCount = sizeof(kRuntimeFields) / sizeof(kRuntimeFields[0]);

static const RuntimeField* findField(const char* name) {
  if (!name) return nullptr;
  for (size_t i = 0; i < kRuntimeFieldCount; i++) {
    if (strcmp(kRuntimeFields[i].name, name) == 0) return &kRuntimeFields[i];
  }
  return nullptr;
}

static void persistField(const RuntimeField& f) {
  if (!f.persistToNvs || !f.nvsKey) return;
  prefs.begin("config", false);
  switch (f.type) {
    case FieldType::U8:
      if (f.u8Ptr) prefs.putUChar(f.nvsKey, *f.u8Ptr);
      break;
    case FieldType::BOOL:
      if (f.boolPtr) prefs.putBool(f.nvsKey, *f.boolPtr);
      break;
    case FieldType::ULONG:
      if (f.ulongPtr) prefs.putULong(f.nvsKey, *f.ulongPtr);
      break;
    case FieldType::STRING_SHORT:
      break;
  }
  prefs.end();
}

void handleSetFieldCommand(const String& field, const JsonVariant& value) {
  const RuntimeField* f = findField(field.c_str());
  if (!f) {
    bleNotify("{\"type\":\"ack\",\"action\":\"set_field\",\"field\":\"" + field +
              "\",\"ok\":false,\"reason\":\"not_whitelisted\"}");
    return;
  }

  bool ok = true;
  String reason;

  switch (f->type) {
    case FieldType::U8: {
      if (!value.is<int>() && !value.is<unsigned int>()) {
        ok = false; reason = "wrong_type"; break;
      }
      long v = value.as<long>();
      if (v < f->minVal || v > f->maxVal) { ok = false; reason = "out_of_range"; break; }
      if (f->u8Ptr) *f->u8Ptr = (uint8_t)v;
      break;
    }
    case FieldType::BOOL: {
      if (!value.is<bool>()) { ok = false; reason = "wrong_type"; break; }
      if (f->boolPtr) *f->boolPtr = value.as<bool>();
      break;
    }
    case FieldType::ULONG: {
      if (!value.is<int>() && !value.is<unsigned long>() && !value.is<long>()) {
        ok = false; reason = "wrong_type"; break;
      }
      long v = value.as<long>();
      if (v < f->minVal || v > f->maxVal) { ok = false; reason = "out_of_range"; break; }
      if (f->ulongPtr) *f->ulongPtr = (unsigned long)v;
      break;
    }
    case FieldType::STRING_SHORT: {
      if (!value.is<const char*>() && !value.is<String>()) {
        ok = false; reason = "wrong_type"; break;
      }
      String s = value.as<String>();
      if (s.length() > f->stringMaxLen) { ok = false; reason = "too_long"; break; }
      if (f->stringPtr) *f->stringPtr = s;
      break;
    }
  }

  if (!ok) {
    bleNotify("{\"type\":\"ack\",\"action\":\"set_field\",\"field\":\"" + field +
              "\",\"ok\":false,\"reason\":\"" + reason + "\"}");
    return;
  }

  persistField(*f);
  if (f->onApply) f->onApply();

  bleNotify("{\"type\":\"ack\",\"action\":\"set_field\",\"field\":\"" + field +
            "\",\"ok\":true,\"appliedLive\":true,\"rebootRequired\":" +
            String(f->requiresReboot ? "true" : "false") + "}");
}

void handleListFieldsCommand() {
  String out = "{\"type\":\"fields_list\",\"fields\":[";
  for (size_t i = 0; i < kRuntimeFieldCount; i++) {
    const RuntimeField& f = kRuntimeFields[i];
    if (i) out += ",";
    out += "{\"name\":\"";
    out += f.name;
    out += "\",\"type\":\"";
    switch (f.type) {
      case FieldType::U8: out += "u8"; break;
      case FieldType::BOOL: out += "bool"; break;
      case FieldType::ULONG: out += "ulong"; break;
      case FieldType::STRING_SHORT: out += "string"; break;
    }
    out += "\"";
    if (f.type == FieldType::U8 || f.type == FieldType::ULONG) {
      out += ",\"min\":" + String(f.minVal) + ",\"max\":" + String(f.maxVal);
    }
    out += ",\"value\":";
    switch (f.type) {
      case FieldType::U8:
        out += String(f.u8Ptr ? *f.u8Ptr : 0);
        break;
      case FieldType::BOOL:
        out += (f.boolPtr && *f.boolPtr) ? "true" : "false";
        break;
      case FieldType::ULONG:
        out += String(f.ulongPtr ? *f.ulongPtr : 0UL);
        break;
      case FieldType::STRING_SHORT: {
        String cur = (boardRole == BoardRole::LOGIC_BOARD) ? "logic_board" : "standalone";
        out += "\"" + cur + "\"";
        break;
      }
    }
    out += "}";
  }
  out += "]}";
  bleNotify(out);
}
