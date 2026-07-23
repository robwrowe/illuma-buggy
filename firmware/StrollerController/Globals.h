#pragma once

#include "Config.h"
#include "Types.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <NimBLEDevice.h>

extern String wledSsid;
extern String wledPass;
extern String wledIp;
extern int    wledPort;
extern const char* BLE_NAME;

extern uint8_t mbChaseSpeed;
extern uint8_t mbChaseThickness;

extern const char* MB_SEG_KEYS[];
extern const uint8_t MB_DEFAULT_COLORS[32][3];

extern Preferences prefs;
extern NimBLEServer*         bleServer;
extern NimBLECharacteristic* notifyChar;
extern bool                  bleConnected;

extern String cmdChunkBuffer;
extern int    cmdChunkNextSeq;

extern OverrideSource currentOverride;
extern bool           overrideKillOnZone;
extern unsigned long  overrideTimestamp;

extern ShowType  showModeType;
extern ShowPhase showModePhase;
extern OverrideSource overrideBeforeInterrupt;

extern String showLookParadePre;
extern String showLookParadeLive;
extern String showLookFireworksPre;
extern String showLookFireworksLive;
extern String showLookFireworksPost;
/** MB timed-rule ON→FADE look; empty = fall back to {"on":false} (cuts GLEDOPTO relay). */
extern String mbFadeToBlackPresetId;

extern int    currentBrightness;
extern String currentPresetId;

extern bool          starlightEnabled;
extern unsigned long starlightTimeoutMs;
extern bool          magicBandEnabled;
extern bool          mbDeferToApp;
extern bool          magicBandFivePoint;
extern unsigned long magicBandTimeoutMs;
extern unsigned long bleEffectTransitionMs;
extern bool          bleScanLogEnabled;

extern unsigned long swEventTimestamp;
extern unsigned long mbEventTimestamp;
extern unsigned long swDebugLastNotify;
extern uint8_t       lastLogBytes[48];
extern size_t        lastLogLen;
extern uint32_t      scanRepeatCount;
extern unsigned long scanRepeatSummaryMs;

extern uint8_t       lastWandCastPayload[16];
extern size_t        lastWandCastLen;
extern unsigned long lastWandCastMs;

extern uint8_t       lastMbEffectPayload[48];
extern size_t        lastMbEffectLen;
extern uint8_t       lastEphemeralR, lastEphemeralG, lastEphemeralB;
extern bool          lastEphemeralValid;
extern const uint8_t* pendingMbEffectPayload;
extern size_t        pendingMbEffectPayloadLen;

extern unsigned long bleSniffUntilMs;
extern bool          bleCaptureToApp;
extern unsigned long bleCaptureUntilMs;
extern unsigned long bleCaptureLastNotifyMs;
extern uint16_t      bleCaptureNotifyCount;
extern char          captureLabel[24];

extern bool          wandTxBeacon;
extern unsigned long wandTxCastUntil;
extern uint8_t       wandTxCastPalette;
extern unsigned long wandTxLastAdvMs;

extern String savedWledState;
extern String savedRestorePresetId;
extern OverrideSource savedRestoreOverride;
extern String liveWledState;
extern unsigned long lastLiveStatePollMs;
extern String baselineWledState;
extern String mbMappingJson;
extern String mbRulesJson;
extern bool   mbMappingLoadedFromNvs;
extern String bleDefaultPresetId;
extern bool   wledWasConnected;

extern bool          mbUnmatchedLogEnabled;

extern bool          paradeDetectEnabled;
extern char          paradeBeaconPrefix[16];
extern int           paradeRssiThreshold;
extern unsigned long paradeCooldownMs;
extern unsigned long paradeLastBeaconMs;

// Rule-engine timing lifecycle (Part 5)
extern MbRulePhase        mbRulePhase;
extern unsigned long      mbRulePhaseDeadlineMs;
extern unsigned long      mbRuleFadeMs;
extern unsigned long      mbRuleCooldownMs;
extern MbCooldownResetMode mbActiveRuleCooldownMode;
extern char               mbActiveRuleId[MB_RULE_ID_LEN];


extern DisneyPayloadJob disneyJob;
extern portMUX_TYPE disneyJobMux;

extern uint8_t mbWledColors[32][3];
extern uint8_t mbRandomPool[MB_MAX_RANDOM_POOL];
extern uint8_t mbRandomPoolCount;
extern uint8_t mbRandomCustom[MB_MAX_RANDOM_CUSTOM][3];
extern uint8_t mbRandomCustomCount;

/** Per-channel RGB correction LUTs for BLE channelGroup / kind:rgb extracts. */
extern bool mbCalibrationEnabled;
extern uint8_t mbCalCurveR[256];
extern uint8_t mbCalCurveG[256];
extern uint8_t mbCalCurveB[256];

extern MbSegmentLayout mbLayouts[MB_MAX_LAYOUTS];
extern uint8_t mbLayoutCount;
extern uint8_t mbActiveLayoutIdx;
extern String  mbLayoutsJson;
extern unsigned long lastWifiRetry;
extern volatile bool wifiConnectInProgress;

extern QueueHandle_t cmdQueue;
extern QueueHandle_t bleCmdQueue;
