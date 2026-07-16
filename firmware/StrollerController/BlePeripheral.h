#pragma once

#include <Arduino.h>

void startBLEPeripheral();
void bleNotify(const String& json);
void bleNotifyChunked(const String& type, const String& payload);
void resetCmdChunkBuffer();
void processBleCmdChunk(int seq, bool last, const String& data);
void enqueueBleCommand(const String& msg);
void drainBleCmdQueue();
void processBleCmdQueue();
