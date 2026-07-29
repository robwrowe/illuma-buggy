#pragma once

#include <Arduino.h>
#include <stddef.h>
#include <stdint.h>

bool scannerStatusDisplayInit();
/** True after a successful SSD1306 begin. */
bool scannerStatusDisplayReady();
/** Re-apply SDA/SCL after SPI/SD init (same pins; cheap insurance). */
void scannerStatusDisplayReassertWire();
void scannerStatusDisplayUpdate();

/** Push a Disney mfr packet into the OLED ring (call from scan callback — keep light). */
void scannerStatusDisplayNotePacket(const uint8_t* mfrData, size_t len, int rssi);
