#include "Globals.h"

String wledSsid = "KyLan Ren";
String wledPass = "tigers2016";
String wledIp   = "wled.local";
int    wledPort = 80;
const char* BLE_NAME    = "IllumaBuggy";

uint8_t mbChaseSpeed     = 128;
uint8_t mbChaseThickness = 4;

const char* MB_SEG_KEYS[] = {
  "all", "inner", "outer", "topLeft", "topRight", "bottomLeft", "bottomRight", "center",
  "band0", "band1", "band2", "band3", "band4", "band5", "band6", "band7"
};
const char* MB_ANIM_KEYS[] = { "E90C", "E90E", "E90F", "E910", "E911", "E912", "E913", "wand" };
const char* MB_PAT_KEYS[]  = { "3", "4", "5", "8", "B" };
const char* SW_ANIM_KEYS[] = {
  "rainbow", "blink", "palette5", "flash", "sparkle", "pulse", "circle", "fade", "fade2", "wand"
};

const uint8_t MB_DEFAULT_COLORS[32][3] = {
  {0,255,255},{153,0,255},{0,0,255},{0,0,128},{0,102,255},{204,68,255},{204,153,255},{119,0,204},
  {255,102,178},{255,90,168},{255,80,158},{255,74,148},{255,110,150},{255,130,160},{255,160,170},{255,170,0},
  {204,204,0},{255,136,0},{170,255,0},{255,102,0},{255,51,0},{255,0,0},
  {60,255,255},{40,240,255},{20,200,255},{0,255,0},{102,255,40},{255,255,255},{240,240,240},
  {0,0,0},{255,153,51},{255,0,255}
};

const uint8_t WAND_IDLE_PAYLOAD[19] = {
  0x0F, 0x11, 0x01, 0x4B, 0x72, 0x99, 0x08, 0x83, 0x0A, 0x66,
  0xD4, 0x85, 0xCD, 0x9F, 0x95, 0x75, 0xA8, 0xA3, 0x21
};
const uint8_t WAND_CAST_SIG[6] = {0xCF, 0x0B, 0x00, 0xC4, 0x20, 0x22};

Preferences prefs;

NimBLEServer*         bleServer    = nullptr;
NimBLECharacteristic* notifyChar   = nullptr;
bool                  bleConnected = false;

String cmdChunkBuffer;
int    cmdChunkNextSeq = 0;

OverrideSource currentOverride    = NONE;
bool           overrideKillOnZone = false;
unsigned long  overrideTimestamp  = 0;

ShowType  showModeType  = SHOW_NONE;
ShowPhase showModePhase = PHASE_NONE;
OverrideSource overrideBeforeInterrupt = NONE;

String showLookParadePre     = "";
String showLookParadeLive    = "";
String showLookFireworksPre  = "";
String showLookFireworksLive = "__BLACK__";
String showLookFireworksPost = "";
String mbFadeToBlackPresetId = "";  // "" = fall back to {"on":false}

int    currentBrightness = 128;
String currentPresetId   = "";

bool          starlightEnabled    = true;
unsigned long starlightTimeoutMs  = 15000;
bool          magicBandEnabled    = true;
bool          mbDeferToApp        = false;
bool          magicBandFivePoint  = true;
unsigned long magicBandTimeoutMs  = 15000;
unsigned long bleEffectTransitionMs = 700;
bool          bleScanLogEnabled   = true;

unsigned long swEventTimestamp = 0;
unsigned long mbEventTimestamp = 0;
unsigned long swDebugLastNotify = 0;
uint8_t       lastLogBytes[48];
size_t        lastLogLen      = 0;
uint32_t      scanRepeatCount = 0;
unsigned long scanRepeatSummaryMs = 0;

uint8_t       lastWandCastPayload[16];
size_t        lastWandCastLen     = 0;
unsigned long lastWandCastMs      = 0;

uint8_t       lastMbEffectPayload[48];
size_t        lastMbEffectLen = 0;
uint8_t       lastEphemeralR = 0, lastEphemeralG = 0, lastEphemeralB = 0;
bool          lastEphemeralValid = false;
const uint8_t* pendingMbEffectPayload = nullptr;
size_t        pendingMbEffectPayloadLen = 0;

unsigned long bleSniffUntilMs = 0;

bool          bleCaptureToApp     = false;
unsigned long bleCaptureUntilMs   = 0;
unsigned long bleCaptureLastNotifyMs = 0;
uint16_t      bleCaptureNotifyCount  = 0;
char          captureLabel[24]    = "";

bool          wandTxBeacon    = false;
unsigned long wandTxCastUntil = 0;
uint8_t       wandTxCastPalette = 4;
unsigned long wandTxLastAdvMs = 0;

String savedWledState   = "";
String savedRestorePresetId = "";
OverrideSource savedRestoreOverride = NONE;
String liveWledState    = "";
unsigned long lastLiveStatePollMs = 0;
String baselineWledState  = "";
String mbMappingJson = "";
String mbRulesJson = "";
bool   mbMappingLoadedFromNvs = false;
String bleDefaultPresetId = "";
bool   wledWasConnected   = false;

bool          mbUnmatchedLogEnabled = false;

bool          paradeDetectEnabled = false;
char          paradeBeaconPrefix[16] = "cd07";
int           paradeRssiThreshold = -70;
unsigned long paradeCooldownMs = 30000;
unsigned long paradeLastBeaconMs = 0;

MbRulePhase        mbRulePhase = MB_RULE_IDLE;
unsigned long      mbRulePhaseDeadlineMs = 0;
unsigned long      mbRuleFadeMs = 0;
unsigned long      mbRuleCooldownMs = 10000;
MbCooldownResetMode mbActiveRuleCooldownMode = MB_COOLDOWN_ON_MATCH;
char               mbActiveRuleId[MB_RULE_ID_LEN] = "";


DisneyPayloadJob disneyJob = {};
portMUX_TYPE disneyJobMux = portMUX_INITIALIZER_UNLOCKED;

uint8_t mbWledColors[32][3];
uint8_t mbRandomPool[MB_MAX_RANDOM_POOL];
uint8_t mbRandomPoolCount = 0;
uint8_t mbRandomCustom[MB_MAX_RANDOM_CUSTOM][3];
uint8_t mbRandomCustomCount = 0;

MbSegmentLayout mbLayouts[MB_MAX_LAYOUTS];
uint8_t mbLayoutCount = 0;
uint8_t mbActiveLayoutIdx = 0;
String  mbLayoutsJson = "";
MbEffectMap mbAnimMap[8];
MbEffectMap swAnimMap[SW_ANIM_COUNT];
MbEffectMap mbPatMap[5];

unsigned long lastWifiRetry = 0;
volatile bool wifiConnectInProgress = false;

QueueHandle_t cmdQueue;
QueueHandle_t bleCmdQueue = nullptr;
