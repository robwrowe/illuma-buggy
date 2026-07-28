#pragma once

#include <Arduino.h>
#include <stddef.h>
#include <stdint.h>

bool scannerStatusDisplayInit();
void scannerStatusDisplayUpdate();

/** Push a Disney mfr packet into the OLED ring (call from scan callback — keep light). */
void scannerStatusDisplayNotePacket(const uint8_t* mfrData, size_t len, int rssi);
