# Illuma Buggy — Companion App

React Native + Expo companion app for the Illuma Buggy stroller LED system.

## Setup

```bash
cd app
npm install
npx expo start
```

## Requirements

- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- For Android: Expo Go app OR a dev build (BLE requires a dev build — Expo Go does not support react-native-ble-plx)
- For iOS: Dev build required (same reason)

## Building a dev build (required for BLE)

```bash
# Install EAS CLI
npm install -g eas-cli

# Configure (first time only)
eas build:configure

# Build for Android
eas build --platform android --profile development

# Build for iOS
eas build --platform ios --profile development
```

## Project structure

```
src/
  services/
    BLEService.ts       — BLE connection, send/receive, auto-reconnect
  hooks/
    useBLE.ts           — React hook wrapping BLEService
    useBoardSync.ts     — bootstrap/sync status for UI
    useZoneManager.ts   — GPS polling, zone evaluation, brightness
  stores/
    store.ts            — Zustand global state (presets, zones, config)
  screens/
    HomeScreen.tsx        — Connection status, brightness, zones, shows, BLE Data events
    RulesScreen.tsx       — Pause-all + per-rule enable/sort
    BleCaptureScreen.tsx  — Disney BLE capture sessions
    PresetsScreen.tsx     — Preset list, apply, create, delete
    PalettesScreen.tsx    — Custom palettes + palette sets
    LibraryScreen.tsx     — WLED effect/palette browser
    ZonesScreen.tsx       — Map drawing, preset zones, indoor zones
    ShowsScreen.tsx       — Park shows (parade / fireworks bindings)
    SettingsScreen.tsx    — Override mode, brightness config, solar params
    MbMappingSections.tsx — MagicBand+/Starlight segment mapping UI
    more/                 — General, Presets config, Brightness, BLE Data, Logic Board, Diagnostics
  navigation/
    MoreNavigator.tsx    — "More" tab stack navigator
  tasks/                 — background task definitions (e.g. location)
  utils/
    theme.ts             — dark/light/system theme, color tokens
    connectBootstrap.ts  — staged BLE connect + quick reconnect
    boardSyncState.ts    — sync fingerprint, status, AsyncStorage meta
    utils.ts             — Solar math, point-in-polygon, zone evaluation
```

## BLE Protocol

See `../firmware/StrollerController/PROTOCOL.md` for the full message spec.

Device name: `IllumaBuggy`
Service UUID: `12345678-1234-1234-1234-123456789abc`
