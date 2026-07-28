#pragma once

void statusLedInit();
/** Call every loop() iteration — cheap, does its own blink timing. */
void statusLedTick();
