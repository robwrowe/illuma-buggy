# Illuma Buggy — Agent Reference

A Disney park stroller LED system. An ESP32-S3 logic board runs custom firmware that
bridges BLE (app ↔ board) and WiFi (board ↔ WLED LED controller). A React Native/Expo
app controls everything. A single-file web tool runs locally for park config.

**Protocol docs:** [docs/README.md](docs/README.md) · [docs/disney-ble-protocol.md](docs/disney-ble-protocol.md)

---

## Repository layout

```
illuma-buggy/
├── firmware/
│   └── StrollerController/
│       └── StrollerController.ino   ← single-file Arduino sketch (v2.1)
├── app/                             ← React Native / Expo (Android target)
│   ├── App.tsx                      ← root: navigation, BLE message routing
│   ├── index.js                     ← registerRootComponent entry
│   ├── app.config.js                ← dynamic Expo config (reads EAS secrets)
│   ├── build.sh                     ← EAS cloud build script
│   └── src/
│       ├── services/
│       │   └── BLEService.ts        ← BLE singleton (connect/send/receive/chunk)
│       ├── hooks/
│       │   ├── useBLE.ts            ← React hook wrapping BLEService
│       │   ├── useBoardSync.ts      ← bootstrap/sync status for UI
│       │   └── useZoneManager.ts    ← GPS watcher → zone triggers → brightness
│       ├── stores/
│       │   └── store.ts             ← Zustand store + AsyncStorage persistence
│       ├── screens/
│       │   ├── HomeScreen.tsx       ← connection, mode, zones, palette sets
│       │   ├── PresetsScreen.tsx    ← preset list, apply, edit (effect+palette+memory)
│       │   ├── LibraryScreen.tsx    ← WLED effects/palettes browser, save as preset
│       │   ├── PalettesScreen.tsx   ← custom palettes + park palette sets
│       │   ├── ZonesScreen.tsx      ← map zone drawing, active zone detection
│       │   └── SettingsScreen.tsx   ← recall state, MB config, export/import
│       └── utils/
│           ├── theme.ts             ← dark/light/system theme, color tokens
│           ├── connectBootstrap.ts  ← staged BLE connect + quick reconnect
│           ├── boardSyncState.ts    ← sync fingerprint, status, AsyncStorage meta
│           └── utils.ts             ← solar elevation, pointInPolygon, zone eval
└── web/
    ├── index.html                   ← single-file React web tool (Babel standalone)
    ├── serve.sh                     ← `python3 -m http.server 3000` + auto-open
    └── README.md
```

---

## Hardware

| Component | Details |
|-----------|---------|
| **Logic board** | ESP32-S3-DevKitC-1-N16R8 (16 MB flash / 8 MB PSRAM) |
| **LED controller** | GLEDOPTO ESP32, stock WLED v16 ("Niji") firmware |
| **LEDs** | 50× ALITOVE WS2811 IP68 pixel nodes, GRB, 5V |
| **WLED GPIO** | 16, GRB, 50 LEDs |
| **GLEDOPTO relay** | GPIO 18 cuts LED output when WLED master power is `off` — always POST `{"on":true,"bri":255}` on session start |

---

## Architecture

```
Phone ←──BLE──→ Logic ESP32-S3 ←──WiFi STA──→ GLEDOPTO AP (StrollerNet / 4.3.2.1)
                    ↑
              BLE passive scan
         (Starlight Wand + MagicBand+ 0x8301 packets)
              [optional WandSimulator ESP32 for bench TX]
```

- Logic board joins `StrollerNet` as a WiFi station. IP is always `4.3.2.1` (GLEDOPTO is the AP).
- App communicates with the logic board over BLE only — phone keeps mobile data for maps.
- NimBLE 2.x handles BLE peripheral (app comms) and passive scanner (MagicBand+) simultaneously.

---

## BLE Protocol

### Identifiers

```
Device name:   IllumaBuggy
Service UUID:  12345678-1234-1234-1234-123456789abc
CMD char:      12345678-1234-1234-1234-123456789abd  (WRITE + WRITE_NR)
NOTIFY char:   12345678-1234-1234-1234-123456789abe  (NOTIFY)
```

### Transport

All messages are JSON objects, base64-encoded into BLE characteristic values.
Each notification from the firmware is always a **complete, self-contained JSON object** —
they are never split mid-object across notifications. Large payloads are chunked:
each chunk is itself a valid JSON object with `type`, `seq`, `last`, and `data` fields.

```jsonc
// Chunk envelope (firmware → app)
{ "type": "wled_effects", "seq": 0, "last": false, "data": "[\"Solid\",\"Blink\"..." }
{ "type": "wled_effects", "seq": 1, "last": true,  "data": "...,\"Ripple\"]" }
```

`msg.data` is already unescaped by `JSON.parse` — do **not** unescape again.

### App → Firmware commands

| `type` | Payload fields | Description |
|--------|---------------|-------------|
| `status` | — | Request device status |
| `preset_save` | `id`, `name`, `wled` (object) | Save preset to NVS |
| `preset_apply` | `id` | Apply saved preset |
| `preset_delete` | `id` | Delete from NVS |
| `preset_list` | — | Request all presets (chunked response) |
| `wled_get_effects` | — | Proxy GET `/json/eff` → chunked `wled_effects` |
| `wled_get_palettes` | — | Proxy GET `/json/pal` → chunked `wled_palettes` |
| `wled_get_fxdata` | — | Proxy GET `/json/fxdata` → chunked `wled_fxdata` |
| `wled_get_state` | — | Proxy GET `/json/si` → chunked `wled_state` |
| `wled_raw` | `wled` (object) | POST arbitrary JSON to WLED `/json/state` |
| `brightness` | `value` (0–255) | Set WLED brightness |
| `zone_trigger` | `preset_id` | Apply preset (zone-sourced, respects override) |
| `override_clear` | — | Clear manual/BLE override, restore zone |
| `override_mode` | `kill_on_zone` (bool) | Configure override behavior |
| `sw_config` | `enabled` (bool), `timeout_ms` (int) | Starlight Wand config |
| `mb_config` | `enabled` (bool), `five_point` (bool), `timeout_ms` (int) | MagicBand+ config (five_point retained in NVS; strip uses full-width chase) |
| `mb_chase_config` | `speed` (0–255), `thickness` (1–50) | MB+ chase `sx` / `grp` on WLED |
| `scan_log_config` | `enabled` (bool) | Serial Disney scan hex logging |

### Firmware → App messages

| `type` | Fields | Description |
|--------|--------|-------------|
| `status` | `override`, `kill_on_zone`, `brightness`, `preset`, `wifi`, `sw_enabled`, `sw_timeout_ms`, `mb_enabled`, `mb_five_point`, `mb_timeout_ms`, `mb_chase_speed`, `mb_chase_thickness`, `mb_layout_active`, `mb_layout_count`, `preset_count`, `scan_log` | Device state |
| `ack` | `action`, `id?`, `ok?` | Command acknowledgement |
| `error` | `msg` | Firmware error |
| `preset_list_raw` | assembled from `preset_chunk` chunks | JSON array of all presets |
| `wled_effects_done` | assembled from `wled_effects` chunks | JSON array of effect names |
| `wled_palettes_done` | assembled from `wled_palettes` chunks | JSON array of palette names |
| `wled_fxdata_done` | assembled from `wled_fxdata` chunks | JSON array of metadata strings |
| `wled_state_done` | assembled from `wled_state` chunks | WLED state+info JSON |
| `ble_color` | `r`, `g`, `b` | MagicBand+ E9 color event (6-bit → 8-bit scaled) |
| `ble_event` | `event` | MagicBand+ non-color event (flash, fireworks, timeout) |
| `sw_color` | `palette`, `r`, `g`, `b` | Starlight Wand palette color event |
| `sw_event` | `event` | Starlight Wand event (timeout, disabled, blocked, wifi_down) |
| `sw_debug` | `reason`, `hex`, `len` | Rate-limited raw wand packet debug (shown on Home) |

### Chunked type routing (BLEService.ts)

```typescript
const CHUNKED_TYPES = {
  'preset_chunk':  'preset_list_raw',
  'wled_effects':  'wled_effects_done',
  'wled_palettes': 'wled_palettes_done',
  'wled_fxdata':   'wled_fxdata_done',
  'wled_state':    'wled_state_done',
};
```

---

## App architecture

### State (store.ts — Zustand + AsyncStorage)

**Persisted keys** (AsyncStorage):
`presets`, `zones`, `indoorZones`, `brightnessConfig`, `overrideKillOnZone`,
`starlightEnabled`, `starlightTimeoutSec`, `magicBandEnabled`, `magicBandFivePoint`,
`magicBandTimeoutSec`, `recallState`, `customPalettes`, `paletteSets`, `activePaletteSetId`,
`wledEffects`, `wledPalettes`, `wledFxData` (cached WLED library — refresh via Library ↻)

**Key types:**

```typescript
interface Preset {
  id: string; name: string; createdAt: number;
  wled: { on: boolean; fx?: number; fxName?: string; pal?: number; palName?: string;
          sx?: number; ix?: number; c1-c3?: number; o1-o3?: boolean; col?: number[][]; };
  memory: { effect: boolean; palette: boolean; parameters: boolean; color: boolean; segments: boolean; };
}

interface Zone { id: string; name: string; polygon: LatLng[]; presetId: string; enabled: boolean; }
interface IndoorZone { id: string; name: string; polygon: LatLng[]; enabled: boolean; }
interface CustomPalette { id: string; name: string; colors: string[]; }  // hex strings
interface PaletteSet { id: string; name: string; paletteIds: string[]; }

type RecallValue = 'always' | 'never' | 'memory';
interface RecallState { effect: RecallValue; palette: RecallValue; parameters: RecallValue;
                        color: RecallValue; segments: RecallValue; }
```

**Non-persisted (runtime only):**
`wledEffects`, `wledPalettes`, `wledFxData`, `activeZoneIds`, `deviceStatus`

### BLEService.ts patterns

- **Singleton** — import `bleService` directly, never construct multiple instances
- **Message subscription** — `bleService.onMessage(handler)` returns an unsubscribe function
- **State subscription** — `bleService.onStateChange(handler)` returns unsubscribe
- **Chunk assembly** — `handleNotification` tries `JSON.parse(incoming)` first (complete packet), falls back to `notifyBuffer` accumulation for MTU-fragmented messages
- **Chunk buffer** — separate `chunkBuffer[type]` dict for large multi-message payloads; cleared on disconnect
- **`isSessionReady()`** — `true` after `connectBootstrap` enables commands; gate preset apply / Fire on this, not just `isConnected`

### Connect bootstrap (`connectBootstrap.ts`)

Staged connect to avoid flooding BLE and dropping the link on Android.

1. **Essential config** (small): `sw_config`, `mb_config`, `ble_effect_config`
2. **`markSessionReady(true)`** — commands enabled before heavy work
3. **Background sync**: MB layouts, mapping, preset delta/full push, show config

**Quick reconnect** (within 6h + matching config fingerprint in `boardSyncMeta` AsyncStorage):
- Skips layout push if `status.mb_layout_*` matches saved meta
- Skips `preset_list` if `status.preset_count` ≥ phone preset count and cached sync IDs match
- Use **Sync board config** on Home to force full push

**Preset sync cache** (`blePresetCache.ts`): tracks which preset IDs are on board NVS; persisted in `boardSyncMeta` across disconnects.

**WLED catalog** (`wled_get_fxdata` etc.): deferred 8s after session ready, only if Library cache is empty — never blocks connect.

**Segment layouts**: `pushMbSegmentLayoutsToBoard` sends `buildDisableAllSplitSegmentsPayload()` before geometry; firmware `wled_raw` also calls `disableAllSplitSegments()` when seg geometry is posted.

### Stale closure pattern

GPS callbacks and BLE notification handlers run outside React's render cycle.
Always use **refs** to read live store values:

```typescript
// ✅ Correct — ref always current
const zonesRef = useRef(useAppStore.getState().zones);
useEffect(() => useAppStore.subscribe(s => { zonesRef.current = s.zones; }), []);

// ❌ Wrong — closure captures stale value
const { zones } = useAppStore();
watchPosition(loc => {
  zones.forEach(...); // stale! zones never updates inside this callback
});
```

### useZoneManager.ts

- Starts a single `watchPositionAsync` subscription on mount (empty deps `[]`)
- All store values read via refs (`zonesRef`, `indoorZonesRef`, `brightnessConfigRef`, `zonesEnabledRef`)
- Writes `setActiveZoneIds` on every GPS tick
- Fires `bleService.sendZoneTrigger(presetId)` on zone entry when `zonesEnabled` is true
- Calls `bleService.sendBrightness(...)` for solar/indoor brightness changes

### Recall state system

`buildRecallPayload(preset, recallState)` in `store.ts` builds a WLED JSON payload
applying the global recall state to each property:
- `always` → always include in payload
- `never` → never include
- `memory` → include only if `preset.memory[prop]` is `true` (set at capture time)

### Theme

```typescript
const { colors } = useTheme();
// colors.primary, colors.surface, colors.danger, etc.
// Full token list: darkColors / lightColors in theme.ts
```

Styles always defined as `StyleSheet.create(...)` keyed by color tokens, not hardcoded hex.

### Icon imports

**Always import individually** — barrel import hangs Metro bundler:

```typescript
// ✅
import IconHome from '@tabler/icons-react-native/dist/esm/icons/IconHome';
// ❌ Never do this:
import { IconHome } from '@tabler/icons-react-native';
```

Confirmed available icons: `IconHome`, `IconSparkles`, `IconMap`, `IconSettings`,
`IconBook`, `IconBluetooth`, `IconBluetoothOff`, `IconBulb`, `IconBolt`, `IconFlame`,
`IconX`, `IconRefresh`, `IconWifi`, `IconWifiOff`, `IconPlus`, `IconCheck`, `IconTrash`,
`IconPencil`, `IconSun`, `IconMoon`, `IconDeviceDesktop`, `IconDownload`, `IconUpload`,
`IconDroplet`, `IconMap`.

To check if an icon exists:
```bash
ls app/node_modules/@tabler/icons-react-native/dist/esm/icons/ | grep "^IconName\."
```

---

## Firmware architecture

### Key globals

```cpp
// BLE
NimBLECharacteristic* notifyChar;
bool bleConnected;

// Override system — priority: Starlight Wand > MagicBand+ > Manual > Zone
enum OverrideSource { NONE, ZONE, MANUAL, BLE_MAGIC, BLE_STARLIGHT };
OverrideSource currentOverride;
unsigned long overrideTimestamp;

// Starlight Wand
bool starlightEnabled;
unsigned long starlightTimeoutMs; // ms before auto-clear (0 = never)
unsigned long swEventTimestamp;

// MagicBand
bool magicBandEnabled;
bool magicBandFivePoint;          // NVS legacy; WLED uses full-strip chase not corners
uint8_t mbChaseSpeed;             // WLED Chase sx (0 = static)
uint8_t mbChaseThickness;         // WLED Chase grp (pixels per block)
unsigned long magicBandTimeoutMs;
unsigned long mbEventTimestamp;

// WLED
#define STRIP_LED_COUNT 100
String savedWledState;            // saved before BLE override, restored after
```

Protocol reference: `docs/disney-ble-protocol.md`, `docs/starlight-wand-codes.md`.

### FreeRTOS queue (critical)

HTTP calls **cannot run on the NimBLE `onWrite` callback** — insufficient stack.
All HTTP work is deferred through a FreeRTOS queue:

```cpp
struct PendingCmd { char type[32]; };  // char[] not String — FreeRTOS copies by value
QueueHandle_t cmdQueue;

// In onWrite callback:
PendingCmd cmd; strncpy(cmd.type, "wled_get_effects", 31);
xQueueSend(cmdQueue, &cmd, 0);

// In loop():
processPendingCommands();  // does actual HTTP work here
```

**Never** use `String` in a FreeRTOS queue struct — the internal pointer becomes dangling after the stack copy.

### Disney BLE packets (scanner)

Manufacturer data uses Disney CID **`8301`**. Payload parsing follows Adafruit `magicband_protocol.py` — see **`docs/disney-ble-protocol.md`**.

**MagicBand+ (E1/E2-wrapped E9):** function code at payload[2]<<8 | payload[3], e.g. `0xE905` single color, `0xE909` five-slot pattern, `0xE90C` show FX.

**Starlight Wand:**
- **WAND-IDLE** — `0F 11 …` (19 bytes), not an effect
- **WAND-CAST** — `CF 0B 00 C4 20 22` + 6 rolling + palette (13 bytes)
- **WAND-CF9B** — legacy `CF 9B …`, palette in last byte

**CC03 ping** — wake / prime receiver before some commands.

### WLED BLE override mapping (100-LED strip)

| BLE source | WLED effect |
|------------|-------------|
| MB+ palette / E905 / E906 | Full-strip Chase (`fx:28`), custom 5-color `pd`, `sx`/`grp` from `mb_chase_config` |
| MB+ E908 / E909 | Chase with packet colors / patterns |
| MB+ E90C / E90E / E912 / … | Full-strip animation (`fx` from opcode) |
| Starlight wand cast | Full-strip solid (`fx:0`) — custom wand usermod TBD |

`clearOverride()` restores saved WLED state + single segment `start:0 stop:100`.

### Serial debug (USB @ 115200)

| Command | Purpose |
|---------|---------|
| `help` | Command list |
| `sniff [sec]` | Log all manufacturer data |
| `tx on` / `tx off` | Wand idle beacon TX (pairing tests) |
| `tx cast <N>` | WAND-CAST palette N for 3s |
| `chase speed <N>` / `chase thick <N>` | MB chase tuning |

Bench broadcaster: `firmware/WandSimulator/` — see `docs/starlight-wand-codes.md`.

### WLED JSON API endpoints used

```
GET  /json/eff      → effect name array
GET  /json/pal      → palette name array
GET  /json/fxdata   → effect metadata strings
GET  /json/si       → state + info combined
POST /json/state    → set lights (effect, palette, brightness, segments, etc.)
```

Custom palettes: POST to `/json/state` with `{"pd": {"0": [[pos,r,g,b],...], "1": ...}}`
WLED v16+ supports 100+ custom palettes (no 8-palette limit).

---

## Web tool (web/index.html)

Single HTML file using React 18 UMD + Babel standalone (in-browser transpile).
**Must be served via HTTP** — not `file://` (Maps API and CORS block it).

```bash
cd web && ./serve.sh   # starts python3 -m http.server 3000 + opens browser
```

### Critical Babel standalone rules

1. Arrow functions returning JSX **must** wrap in parens: `.map(x => (<JSX/>))` not `.map(x => <JSX/>)`
2. No Unicode fullwidth chars (U+FF0B `＋`) in JSX — use ASCII `+`
3. No `import`/`export` statements anywhere in the script
4. All components defined as plain functions in one `<script type="text/babel">` block

### localStorage keys

```javascript
'illuma-buggy-config'    // current working data (auto-saved on every change)
'illuma-buggy-profiles'  // named profiles object: { "Magic Kingdom": {...data}, ... }
'maps-api-key'           // Google Maps API key
'wled-ip'                // last used WLED IP for direct connect
```

### Data format (shared between app and web tool)

```jsonc
{
  "version": "2.2",
  "exportedAt": "ISO string",
  "presets": [...],
  "zones": [...],
  "indoorZones": [...],
  "brightnessConfig": { "daytime": 200, "nighttime": 80, "indoor": 120,
                        "transitionMinutes": 30, "solarThresholdDeg": 6 },
  "recallState": { "effect": "always", "palette": "always",
                   "parameters": "memory", "color": "memory", "segments": "never" },
  "overrideKillOnZone": false,
  "starlightEnabled": true,
  "starlightTimeoutSec": 30,
  "magicBandEnabled": true,
  "magicBandFivePoint": true,
  "magicBandTimeoutSec": 30,
  "customPalettes": [{ "id": "...", "name": "...", "colors": ["#hex", ...] }],
  "paletteSets": [{ "id": "...", "name": "...", "paletteIds": ["pid1", ...] }]
}
```

---

## Build & deploy

### App

```bash
cd app
npm run build          # EAS cloud build (Android, development profile)
npm run build:clean    # clean prebuild + EAS build
```

`app.config.js` reads `process.env.GOOGLE_MAPS_API_KEY` from EAS secret at build time.
EAS project ID: `e7692aec-8fa3-4506-beb8-2885de76cbf8`
Android package: `com.illumabuggy.app`

New native dependencies require a full `build:clean` — Metro hot reload is not enough.

### Firmware

Arduino IDE: Board = `ESP32S3 Dev Module`, OPI PSRAM, 240 MHz, UART0 port.
Flash via USB. No OTA yet.

---

## Known constraints & gotchas

### BLE
- Each firmware notification is a **complete JSON object** — always try `JSON.parse(incoming)` before appending to MTU buffer
- Chunk `data` field is already JSON-unescaped by the outer `JSON.parse` — never unescape again
- `bleService` is a singleton — subscribe in `useEffect`, always return the unsubscribe function
- Firmware chunk size = 100 bytes data + ~55 byte JSON wrapper ≈ 155 bytes total (safely under 247 MTU)
- **Connect flood** — inbound `preset_list` (49+ chunks) + `wled_get_fxdata` (93 chunks) during bootstrap can drop Android BLE; use quick reconnect + background sync (`connectBootstrap.ts`)
- Gate user commands on `bleService.isSessionReady()`, not just `isConnected`

### React Native / Expo
- `react-native-maps` `draggable` marker prop is unreliable on Android — use tap-to-select + tap-map-to-move pattern instead
- GPS callbacks and BLE handlers use **refs** for all store values to avoid stale closures
- `useZoneManager` has empty deps array `[]` — the watcher starts once and reads all live data via refs
- Tabler icon barrel import hangs Metro — always use individual file paths

### Firmware / FreeRTOS
- `HTTPClient` and heap-allocating `String` cannot run in NimBLE `onWrite` callback — queue to main loop
- `String` in FreeRTOS queue struct = heap corruption — use `char[32]` + `strncpy`/`strcmp`
- `WiFi.begin()` while already connecting crashes driver — check `WiFi.status()` first and call `WiFi.disconnect()` before reconnecting
- GLEDOPTO relay on GPIO 18 cuts LED output when WLED `on: false` — always send `{"on":true,"bri":255}` on connect

### WLED
- v16+ ("Niji"): 100+ custom palettes, 800+ cpt-city palettes, built-in palette editor
- Custom palette format: `{"pd": {"0": [[pos,r,g,b], ...], "1": ...}}`
- `fxdata` metadata format: `"<params>;<colors>;<palette>;<flags>;<defaults>"`
  e.g. `"!,!;;!;1;sx=24,pal=50"` = speed+intensity sliders, palette enabled, 1D, defaults sx=24 pal=50

### Web tool
- Requires HTTP server — `./serve.sh` or `python3 -m http.server 3000`
- Google Maps API key entered in-browser and stored in `localStorage`
- WLED direct connect (Presets tab) requires Mac to be on `StrollerNet` or same LAN as WLED

---

## Pending / roadmap

- [ ] WLED usermod — custom Starlight / MB chase effects (replace built-in Chase)
- [ ] MagicBand+ in-park testing — additional E9 animation opcodes
- [ ] OTA firmware updates
- [ ] "Find my stroller" (BLE out-of-range detection)
- [ ] Park-specific zone profiles (import/export per-park JSON)
- [ ] Physical build: ABS enclosure, cable glands, neutral-cure silicone weatherproofing
