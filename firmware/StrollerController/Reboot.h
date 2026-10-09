#pragma once

#include <Arduino.h>

/** Record a reboot request and return immediately. Does not call ESP.restart(). */
void requestReboot(const char* source, uint32_t delayMs = 400);
/** Call from loop(). Restarts when the request deadline has passed. */
void serviceReboot();
