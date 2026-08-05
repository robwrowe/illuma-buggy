# Illuma Buggy — Agent Reference

A Disney park stroller LED system. A classic ESP32 **scanner board** passively observes
MagicBand+ / Starlight Wand BLE advertising packets and forwards decoded events over a
wired UART link to an ESP32-S3 **logic board**, which runs the rule engine, bridges BLE
(app ↔ board) and WiFi (board ↔ WLED LED controller). A React Native/Expo app (Android-first)
controls everything in the field; a Vite/React/Mantine web tool is used for desk authoring.

**Protocol docs:** [docs/README.md](docs/README.md) · [docs/disney-ble-protocol.md](docs/disney-ble-protocol.md) · [docs/pcb-final-build-spec.md](docs/pcb-final-build-spec.md) (authoritative dual-board build spec)

> Opcode/BLE decoding docs under `docs/` are being updated separately — treat those as a work in progress independent of this file.

---

## Repository layout

```
illuma-buggy/
├── firmware/
│   ├── StrollerController/          ← ESP32-S3 logic board (Arduino/C++, modular .h split)
│   │   ├── StrollerController.ino   ← entry point; requires Board = "ESP32S3 Dev Module"
│   │   ├── UartLink.h                ← receives forwarded scanner events
│   │   ├── MbRuleEngine.h            ← rule matching/priority/exclusivity
│   │   ├── BlePeripheral.h / BleCommandHandler.h  ← app ↔ board BLE protocol
│   │   ├── RuntimeFields.h           ← set_field/list_fields runtime tuning
│   │   ├── StatusDisplay.h           ← OLED status (SSD1306, I2C)
│   │   ├── SdRuleLogger.h            ← SD logging of parsed events + rule decisions
│   │   ├── PROTOCOL.md               ← app ↔ board BLE message spec
│   │   └── build_opt.h               ← board-specific compile defines
│   ├── BleScannerNode/               ← classic ESP32 scanner board (Arduino/C++)
│   │   ├── BleScannerNode.ino        ← entry point; requires Board = "ESP32 Dev Module"
│   │   ├── DisneyBleScan.h / DisneyBleFilter.h / MbPacketDecode.h  ← passive scan + decode
│   │   ├── ScannerPayloadTransport.h ← UART forwarding to logic board
│   │   ├── ScannerStatusDisplay.h    ← OLED status
│   │   ├── SdRawLogger.h             ← SD logging of raw observed packets
│   │   └── build_opt.h
│   └── WandSimulator/                ← ESP32 bench broadcaster for Disney BLE packets (testing)
│       ├── WandSimulator.ino
│       └── API.md                    ← HTTP + Serial contract for bench/replay clients
├── app/                               ← React Native / Expo (Android target)
│   ├── App.tsx                        ← root: navigation, BLE message routing
│   ├── index.js                       ← registerRootComponent entry
│   ├── app.config.js                  ← dynamic Expo config (reads EAS secrets)
│   ├── build.sh / build-apk.sh        ← EAS cloud build scripts
│   └── src/
│       ├── services/
│       │   └── BLEService.ts          ← BLE singleton (connect/send/receive/chunk)
│       ├── hooks/
│       │   ├── useBLE.ts              ← React hook wrapping BLEService
│       │   ├── useBoardSync.ts        ← bootstrap/sync status for UI
│       │   └── useZoneManager.ts      ← GPS watcher → zone triggers → brightness
│       ├── stores/
│       │   └── store.ts               ← Zustand store + AsyncStorage persistence
│       ├── screens/
│       │   ├── HomeScreen.tsx         ← connection, brightness, zones, shows, BLE Data events
│       │   ├── RulesScreen.tsx        ← pause-all + per-rule enable/sort
│       │   ├── BleCaptureScreen.tsx   ← Disney BLE capture sessions
│       │   ├── PresetsScreen.tsx      ← preset list + apply
│       │   ├── PalettesScreen.tsx     ← custom palettes + palette sets
│       │   ├── LibraryScreen.tsx      ← WLED effect/palette browser
│       │   ├── ZonesScreen.tsx        ← map zone drawing (via More stack)
│       │   ├── ShowsScreen.tsx        ← park shows
│       │   ├── SettingsScreen.tsx     ← override mode, brightness config, solar params
│       │   ├── MbMappingSections.tsx  ← MagicBand+/Starlight segment mapping UI
│       │   └── more/                  ← General, Presets config, Brightness, BLE Data, Logic Board, Diagnostics
│       ├── navigation/
│       │   └── MoreNavigator.tsx
│       ├── tasks/                     ← background task definitions (e.g. location)
│       └── utils/
│           ├── theme.ts               ← dark/light/system theme, color tokens
│           ├── connectBootstrap.ts    ← staged BLE connect + quick reconnect
│           ├── boardSyncState.ts      ← sync fingerprint, status, AsyncStorage meta
│           └── utils.ts               ← solar elevation, pointInPolygon, zone eval
├── web/                                ← Vite + React + Mantine desk config tool
│   ├── index.html / src/               ← live app entry (see web/README.md)
│   ├── index.legacy.html               ← pre-migration single-file Babel app, kept for reference only
│   ├── serve.sh                        ← dev server helper
│   └── README.md
├── docs/                                ← protocol references, build specs, opcode documentation
├── scripts/
│   ├── embed_rules.py                  ← embeds rules JSON into firmware before flash
│   └── migrate-config-test.mjs
└── README.md
```

---

## Hardware

| Component | Details |
|-----------|---------|
| **Logic board** | ESP32-S3-DevKitC-1-N16R8 (16 MB flash / 8 MB PSRAM), Arduino board = `ESP32S3 Dev Module` |
| **Scanner board** | Classic ESP32 (ESP32-DevKitC-32 / ESP-32D / WROOM-32D), Arduino board = `ESP32 Dev Module` |
| **Inter-board link** | Wired UART only — no wireless pairing. Scanner TX(17)→Logic RX(18), Logic TX(17)→Scanner RX(16), shared GND required. ESP-NOW has been fully removed; do not reintroduce it. |
| **LED controller** | GLEDOPTO ESP32, stock WLED firmware |
| **LEDs (production)** | 50× ALITOVE WS2811 IP68 pixel nodes, GRB, 5V |
| **LEDs (test/alt)** | BTF-LIGHTING WS2812B strip, IP65 |
| **WLED GPIO** | 16, GRB, 50 LEDs |
| **GLEDOPTO relay** | GPIO 18 cuts LED output when WLED master power is `off` — always POST `{"on":true,"bri":255}` on session start |
| **OLED (both boards, optional)** | 128×64 SSD1306 (or SSD1309) I2C, addr `0x3C` (try `0x3D`) |
| **SD logging (both boards, optional)** | Scanner logs raw observed packets; logic board logs parsed events + rule-engine decisions |

Full pin maps and build order: [`docs/pcb-final-build-spec.md`](docs/pcb-final-build-spec.md).

---

## Architecture

```
MagicBand+ / Starlight Wand
        │  BLE advertising (passive observe, no pairing)
        ▼
Scanner ESP32 (classic) ──UART (cross-wired, shared GND)──► Logic ESP32-S3
                                                                  │
                                                    BLE peripheral │ WiFi STA
                                                    (app ↔ board)  ▼
                                                          GLEDOPTO AP (StrollerNet / 4.3.2.1)
                                                                  │
                                                                  ▼
                                                          WS2811 / WS2812B LEDs
```

- The scanner board runs NimBLE passive scan for Disney packets, decodes them, and forwards matched events to the logic board over UART only. There is no ESP-NOW fallback and no wireless link between the boards.
- The logic board does **not** run its own local Disney BLE scan while the scanner UART link is alive — it only falls back to a "link lost" state, never to local scanning, to protect the phone BLE connection's radio time.
- The logic board joins `StrollerNet` as a WiFi station. IP is always `4.3.2.1` (GLEDOPTO is the AP).
- The app communicates with the logic board over BLE only — the phone keeps mobile data free for maps.
- NimBLE 2.x on the logic board handles the BLE peripheral (app comms) role; the scanner board's NimBLE handles the passive scan role. These no longer run on the same chip.
- `firmware/WandSimulator/` is an optional third ESP32 for bench-broadcasting Disney BLE packets, used for testing without physical bands/wands in hand.

---

## BLE Protocol (app ↔ logic board)

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

The full command/message reference (including runtime field editing via `set_field`/`list_fields`
and rule toggling via `set_rule_enabled`/`list_rules`) lives in
[`firmware/StrollerController/PROTOCOL.md`](firmware/StrollerController/PROTOCOL.md) — treat that
file as the source of truth rather than duplicating the table here, since it changes independently
of this doc.

---

## App architecture

### State (store.ts — Zustand + AsyncStorage)

**Persisted keys** (AsyncStorage):
`presets`, `zones`, `indoorZones`, `brightnessConfig`, `overrideKillOnZone`,
`starlightEnabled`, `starlightTimeoutSec`, `magicBandEnabled`,
`magicBandTimeoutSec`, `rulesPaused`, `logMarkerSnippets`, `recallState`, `customPalettes`, `paletteSets`, `activePaletteSetId`,
`wledEffects`, `wledPalettes`, `wledFxData` (cached WLED library)

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

To check if an icon exists:
```bash
ls app/node_modules/@tabler/icons-react-native/dist/esm/icons/ | grep "^IconName\."
```

---

## Firmware architecture

Firmware is split across two boards, each a modular set of `.h` files sharing a symlinked
`Config.h`, with board-specific behavior selected via `build_opt.h` defines
(`ILLUMA_LOGIC_BOARD=1` / `ILLUMA_SCANNER_BOARD=1`).

### Logic board (StrollerController) — key globals

```cpp
// BLE (app link)
NimBLECharacteristic* notifyChar;
bool bleConnected;

// Override system — priority: BLE_EFFECT > SHOW_MODE > MANUAL > ZONE
enum OverrideSource { NONE, ZONE, MANUAL, SHOW_MODE, BLE_EFFECT };
OverrideSource currentOverride;
unsigned long overrideTimestamp;

// Starlight Wand
bool starlightEnabled;
unsigned long starlightTimeoutMs; // ms before auto-clear (0 = never)

// MagicBand / BLE Data (events arrive via UartLink, not local scan)
bool magicBandEnabled;
bool rulesPaused;                 // pause rule match/apply (NVS); does not clear override
unsigned long magicBandTimeoutMs;
unsigned long mbEventTimestamp;   // shared BLE_EFFECT idle timer
bool lastMatchedRuleWasWand;      // selects flat timeout (sw vs mb)

// WLED
#define STRIP_LED_COUNT 100
String savedWledState;            // saved before BLE override, restored after
```

Protocol reference: `docs/disney-ble-protocol.md`, `docs/starlight-wand-codes.md` (being updated separately).

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

### Scanner board (BleScannerNode)

Runs NimBLE passive scan for Disney manufacturer data (CID `8301`), filters and decodes
matched packets, and forwards them to the logic board over UART (`ScannerPayloadTransport.h`).
Also handles its own OLED status display and raw SD logging (`SdRawLogger.h`) — raw packets
are logged at `onResult()` before any stripping, independent of what the logic board later
does with the forwarded event.

Heartbeats keep the logic board's link-alive timer fresh when Disney BLE traffic is quiet;
the logic board replies to heartbeats so the scanner's OLED can show link status when enabled.

### UART link (both boards)

`UartLink.h` (logic) / `ScannerPayloadTransport.h` (scanner) implement the framing protocol
over the wired cross-wired serial connection. `Serial1.begin()` on the logic side is gated
appropriately for dual-board operation. See `docs/pcb-final-build-spec.md` for the current
framing details and pin assignments.

### Rule engine

Live Disney packets (arriving over UART from the scanner) are applied via the **MB rule
engine** — presets / rule `sx`/`grp` / fades, with per-rule enable/disable and first-match
priority. Global chase config was removed — do not reintroduce `mb_chase_config` or `five_point`.

`clearOverride()` restores saved WLED state + single segment `start:0 stop:100`.

Rule flag `reportAsUnmatched`: on successful apply, also SD-log + notify `mb_unmatched` for Capture/Sheets.

Runtime tuning without reflashing: `RuntimeFields.h` (`set_field`/`list_fields`) and per-rule
enable/disable (`set_rule_enabled`/`list_rules`) — see `firmware/StrollerController/PROTOCOL.md`.

### Serial debug (USB @ 115200, either board)

| Command | Purpose |
|---------|---------|
| `help` | Command list |
| `sniff [sec]` | Log all manufacturer data |
| `tx on` / `tx off` | Wand idle beacon TX (pairing tests, WandSimulator) |
| `tx cast <N>` | WAND-CAST palette N for 3s (WandSimulator) |

Bench broadcaster: `firmware/WandSimulator/` — see `docs/starlight-wand-codes.md` and `firmware/WandSimulator/API.md`.

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

## Web tool (web/)

Vite + React + Mantine app (migrated off the earlier single-file Babel monolith, which is
kept only as `web/index.legacy.html` for reference — the live entry is `index.html` + `src/`).

```bash
cd web
npm install
./serve.sh   # or: npm run dev
```

Open http://localhost:5173/illuma-buggy/ (Vite uses `/illuma-buggy/` base path to match GitHub Pages).

```bash
npm run build    # output in dist/
npm run preview  # preview production build locally
```

GitHub Actions (`.github/workflows/pages.yml`) builds and deploys `web/dist` on push to `main`
when `web/**` changes. In the repo's GitHub Pages settings, the source must be set to
**GitHub Actions** (not "Deploy from branch").

### Google Maps API key

On first launch you'll be prompted for a Google Maps API key (stored in browser `localStorage`
as `maps-api-key`). Enable **Maps JavaScript API** and **Geocoding API** in
[Google Cloud Console](https://console.cloud.google.com/google/maps-apis).

### Features

- **Map & Zones** — draw preset and indoor zones on satellite map
- **Presets** — effect, palette, speed, recall memory
- **Palettes** — custom color palettes
- **Shows** — parade / fireworks bindings
- **Brightness** — day/night/indoor solar settings
- **Wand Lab** — WandSimulator testing: byte editor, `/show` burst & sweep, capture paste, quick firmware commands
- **Settings** — BLE mapping, MB segments, recall state, export/import

### Wand Lab / WandSimulator

See `firmware/WandSimulator/API.md`. The web tool talks to `http://<sim-ip>/status`, `/send`, `/show`, and `/stop`.

- **/send hex** — payload only (no `8301`); byte editor uses this convention
- **/show** — full bytes including `8301`; burst, sweep, and capture replay use this

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
  "magicBandTimeoutSec": 30,
  "rulesPaused": false,
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
npm run build:apk      # standalone APK build
```

`app.config.js` reads `process.env.GOOGLE_MAPS_API_KEY` from EAS secret at build time.
Android package: `com.illumabuggy.app`

New native dependencies require a full `build:clean` — Metro hot reload is not enough.

### Firmware

Two separate Arduino sketches, flashed independently:

- **Logic board** (`firmware/StrollerController/`): Board = `ESP32S3 Dev Module`, OPI PSRAM, 240 MHz.
- **Scanner board** (`firmware/BleScannerNode/`): Board = `ESP32 Dev Module` (classic ESP32, not S3).

Flash each via USB. No OTA yet.

### Embedding rules

`scripts/embed_rules.py` generates `firmware/StrollerController/EmbeddedRules.h` from
`embedded_rules.json` — re-run before flashing the logic board if the rules payload changed.
See `docs/rules-psram-runbook.md`.

---

## Known constraints & gotchas

### BLE (app ↔ board)
- Each firmware notification is a **complete JSON object** — always try `JSON.parse(incoming)` before appending to MTU buffer
- Chunk `data` field is already JSON-unescaped by the outer `JSON.parse` — never unescape again
- `bleService` is a singleton — subscribe in `useEffect`, always return the unsubscribe function
- Firmware chunk size = 100 bytes data + ~55 byte JSON wrapper ≈ 155 bytes total (safely under 247 MTU)
- **Connect flood** — inbound `preset_list` (many chunks) + `wled_get_fxdata` (many chunks) during bootstrap can drop Android BLE; use quick reconnect + background sync (`connectBootstrap.ts`)
- Gate user commands on `bleService.isSessionReady()`, not just `isConnected`

### Scanner ↔ logic UART
- Wired connection only — cross-wire TX/RX and share GND; USB ground alone is not sufficient
- Logic board must not fall back to local BLE scanning when the UART link is silent — only a "link lost" status, to protect the phone BLE connection
- Classic ESP32 (scanner) reserves GPIO 6–11 for internal flash — never use them for SD/SPI; VSPI on GPIO 5/18/23/19 instead

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
- Requires HTTP server — `./serve.sh` or `npm run dev`
- Google Maps API key entered in-browser and stored in `localStorage`
- WLED direct connect (Presets tab) requires the dev machine to be on `StrollerNet` or same LAN as WLED

---

## Pending / roadmap

- [ ] Field-prove the UART transport across real park sessions before further architectural changes
- [ ] Combined single-PCB build (both boards) — deferred until UART is field-proven
- [ ] Per-park rule profiles (design decisions needed before implementation)
- [ ] Google Sheets research log integration for Wand Lab captures
- [ ] Park Mode BLE traffic minimization (further reduction beyond current implementation)
- [ ] Remaining BLE opcode coverage — see opcode docs under `docs/` (being updated separately)
- [ ] OTA firmware updates
- [ ] "Find my stroller" (BLE out-of-range detection)
- [ ] Park-specific zone profiles (import/export per-park JSON)
