#pragma once
#include <Arduino.h>

void httpCommandServerInit();
void httpCommandServerPoll();  // call from loop()

// Set only during HTTP-triggered handleBLECommand(); bleNotify() writes here
// instead of the GATT notify characteristic.
extern String* httpCaptureTarget;
