#pragma once
#include <Arduino.h>

// Fire-and-forget WLED state push, queued off the loop() task.
// Use for real-time rule-effect sends only (see WledSendQueue.cpp scope note).
// jsonBody is copied into a heap buffer — caller does not need to keep it alive.
void wledSendQueueInit();
void wledSendQueueEnqueue(const String& jsonBody);

// Diagnostics
uint32_t wledSendQueueDroppedCount();
uint32_t wledSendQueueSentCount();
uint32_t wledSendQueueFailedCount();
