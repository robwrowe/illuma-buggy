#pragma once
#include <stdint.h>

// 0=normal, 1=dim(~30%), 2=off. Defined unconditionally so RuntimeFields.cpp
// always links, even on builds without the status pixel.
extern uint8_t statusLedMode;

void statusLedInit();
// Call every loop() iteration — cheap, does its own internal timing gate.
void statusLedTick();
