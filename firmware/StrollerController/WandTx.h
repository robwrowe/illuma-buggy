#pragma once

#include <stdint.h>
#include <stddef.h>
void startWandTxCast(uint8_t palette, uint32_t durationMs);
void serviceWandTx();
void refreshBleAdvertising(const uint8_t* disneyPayload, size_t plen);
