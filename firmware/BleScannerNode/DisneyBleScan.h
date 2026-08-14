#pragma once

void startBLEScan();
/** Drain scan ring from loop() — UART forward + drop diagnostics (not on scan task). */
void drainScanRing();
