#pragma once
#include <stdint.h>

void statusLedInit();
// Call every loop() iteration — cheap, does its own internal timing gate.
void statusLedTick();
