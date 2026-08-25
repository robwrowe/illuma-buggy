#include "WledSendQueue.h"
#include "Globals.h"
#include "WledClient.h"
#include <stdlib.h>
#include <string.h>

// Queue depth: generous relative to realistic rule-fire rate (DIP + apply per
// match, at most a few Hz even at MK show density). 16 gives headroom without
// growing unbounded heap use.
#define WLED_SEND_QUEUE_DEPTH 16

// Pointer-only slot — FreeRTOS queues memcpy structs, which would dangle an
// Arduino String's heap buffer after the local destructor runs. The producer
// mallocs a C string; the consumer frees it.
struct WledSendJob {
  char* json;
};

static QueueHandle_t wledSendQueue = nullptr;
static uint32_t droppedCount = 0;
static uint32_t sentCount = 0;
static uint32_t failedCount = 0;

static void wledSendTask(void* /*param*/) {
  WledSendJob job;
  for (;;) {
    if (xQueueReceive(wledSendQueue, &job, portMAX_DELAY) != pdTRUE) continue;
    if (!job.json) continue;

    String body(job.json);
    free(job.json);
    job.json = nullptr;

    // sendToWLED is mutexed against loop()-side GET/POST (WledClient).
    // Shorter timeout than the old default (2000ms) — this task can afford to
    // block, but a hung POST here should not back up the queue indefinitely
    // behind a single bad request during park WiFi congestion.
    if (sendToWLED(body, 500, 0)) {
      sentCount++;
    } else {
      failedCount++;
      Serial.printf("[WLED] async POST failed (%u bytes)\n", (unsigned)body.length());
    }
  }
}

void wledSendQueueInit() {
  wledHttpMutexInit();
  wledSendQueue = xQueueCreate(WLED_SEND_QUEUE_DEPTH, sizeof(WledSendJob));
  xTaskCreatePinnedToCore(
    wledSendTask,
    "WledSendTask",
    4096,
    nullptr,
    1,     // low priority — never contend with BLE/loop core work
    nullptr,
    0      // core 0 — loop()/BLE stay on core 1 (matches existing WiFiTask pattern)
  );
  Serial.println("[WLED] async send queue + task ready");
}

void wledSendQueueEnqueue(const String& jsonBody) {
  if (!wledSendQueue) return;
  size_t n = jsonBody.length();
  char* copy = (char*)malloc(n + 1);
  if (!copy) {
    droppedCount++;
    return;
  }
  memcpy(copy, jsonBody.c_str(), n + 1);

  WledSendJob job;
  job.json = copy;
  if (xQueueSend(wledSendQueue, &job, 0) != pdTRUE) {
    // Queue full — drop oldest, then push. Mirrors queueParsedPacket()'s
    // "stay closest to real-time" policy in PayloadTransport.cpp.
    WledSendJob discard;
    if (xQueueReceive(wledSendQueue, &discard, 0) == pdTRUE) {
      free(discard.json);
      droppedCount++;
    }
    if (xQueueSend(wledSendQueue, &job, 0) != pdTRUE) {
      free(copy);
      droppedCount++;
    }
  }
}

uint32_t wledSendQueueDroppedCount() { return droppedCount; }
uint32_t wledSendQueueSentCount() { return sentCount; }
uint32_t wledSendQueueFailedCount() { return failedCount; }
