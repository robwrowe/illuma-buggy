#pragma once

/**
 * PSRAM-backed ArduinoJson allocator for large, infrequent documents
 * (rules cache, set_mb_rules parse). Falls back to internal heap if
 * PSRAM is unavailable or exhausted.
 */

#include <ArduinoJson.h>
#include <esp_heap_caps.h>

#if ARDUINOJSON_VERSION_MAJOR >= 7

struct SpiRamAllocator : ArduinoJson::Allocator {
  void* allocate(size_t size) override {
    void* p = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!p) p = heap_caps_malloc(size, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    return p;
  }
  void deallocate(void* pointer) override {
    heap_caps_free(pointer);
  }
  void* reallocate(void* ptr, size_t new_size) override {
    void* p = heap_caps_realloc(ptr, new_size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!p && new_size) {
      p = heap_caps_realloc(ptr, new_size, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    }
    return p;
  }
};

inline SpiRamAllocator& jsonPsramAllocator() {
  static SpiRamAllocator alloc;
  return alloc;
}

#else  // ArduinoJson 6

struct SpiRamAllocator {
  void* allocate(size_t size) {
    void* p = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!p) p = heap_caps_malloc(size, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    return p;
  }
  void deallocate(void* pointer) {
    heap_caps_free(pointer);
  }
};

using PsramJsonDocument = BasicJsonDocument<SpiRamAllocator>;

#endif
