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
    useZoneManager.ts   — GPS polling, zone evaluation, brightness
  stores/
    store.ts            — Zustand global state (presets, zones, config)
  screens/
    HomeScreen.tsx      — Connection status, brightness, event feed
    PresetsScreen.tsx   — Preset list, apply, create, delete
    ZonesScreen.tsx     — Map drawing, preset zones, indoor zones
    SettingsScreen.tsx  — Override mode, brightness config, solar params
  utils/
    utils.ts            — Solar math, point-in-polygon, zone evaluation
```

## BLE Protocol

See `../firmware/StrollerController/PROTOCOL.md` for the full message spec.

Device name: `IllumaBuggy`
Service UUID: `12345678-1234-1234-1234-123456789abc`
