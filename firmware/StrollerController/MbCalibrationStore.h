#pragma once

#include <Arduino.h>

/** Persist color-calibration JSON on SPIFFS. */
bool mbCalibrationFsBegin();
bool mbCalibrationFsSave(const String& json);
String mbCalibrationFsLoad();
void mbCalibrationFsClear();

/** Expand JSON curves into 256-entry LUTs (identity if missing/invalid). */
void mbCalibrationApply(const String& json);
void mbCalibrationInitIdentity();
