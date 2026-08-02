#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <stddef.h>
#include <stdint.h>

enum class FieldType : uint8_t { U8, BOOL, ULONG, STRING_SHORT };

struct RuntimeField {
  const char* name;
  FieldType type;
  uint8_t* u8Ptr;
  bool* boolPtr;
  unsigned long* ulongPtr;
  String* stringPtr;
  long minVal;
  long maxVal;
  size_t stringMaxLen;
  bool persistToNvs;
  const char* nvsKey;
  bool requiresReboot;
  void (*onApply)();
};

extern const RuntimeField kRuntimeFields[];
extern const size_t kRuntimeFieldCount;

/** Apply a set_field BLE command. Emits ack via bleNotify. */
void handleSetFieldCommand(const String& field, const JsonVariant& value);
/** Emit list_fields summary via bleNotify. */
void handleListFieldsCommand();
