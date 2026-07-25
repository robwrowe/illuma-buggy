#pragma once

#include "Types.h"
#include <Arduino.h>
int overridePriority(OverrideSource src);
bool canTakeOverride(OverrideSource incoming);
void setOverride(OverrideSource src);
void clearOverride();
void servicePendingRestore();
void saveWledStateForOverride();
String buildWledRestorePayload(const String& savedJson);
String prepareWledRestorePayload(const String& json);
String preparePresetApplyPayload(const String& json);
bool restoreWledSnapshot(const String& json, unsigned long fadeMs, bool dipToBlackFirst = false);
bool restorePresetWithTransition(const String& id, unsigned long fadeMs);
bool restorePresetWithTransitionStyled(const String& id, unsigned long fadeMs, int blendingStyle);
void applyShowPhaseLook(ShowType type, ShowPhase phase, unsigned long fadeMs);
const char* showTypeStatusStr();
const char* showPhaseStatusStr();
void pollLiveWledState();
bool zoneWantsPreset(const String& presetId);
void touchOverrideIdleTimer(OverrideSource src);
