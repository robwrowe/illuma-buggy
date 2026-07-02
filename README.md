# Illuma Buggy

A custom LED lighting system for a theme park stroller — phone-controlled effects, GPS-triggered zone presets, and MagicBand+ event reactions, built on an ESP32-S3 logic board paired with a WLED-powered LED controller.

This is a personal hobby project built for fun and to make theme park trips with young kids a little more magical.

## Overview

Illuma Buggy is a three-part system:

1. **Firmware** — a custom [ESP32-S3 board](https://a.co/d/0ixg0t3k) running NimBLE 2.x that acts simultaneously as a BLE peripheral (for app communication) and a passive BLE scanner (for detecting MagicBand+ event packets).
2. **LED Controller** — a [GLEDOPTO ESP32](https://a.co/d/0g5vyauO) controller running [WLED](https://kno.wled.ge/) v16+, driving the physical LED strings.
3. **Companion Apps** — a React Native + Expo mobile app (in progress) and a single-file React web configuration tool, both used to configure effects, palettes, GPS zones, and MagicBand+ behavior.

## Architecture

```
┌─────────────────┐      BLE      ┌──────────────────┐
│   Mobile App     │◄─────────────►│  Logic Board      │
│ (React Native +  │   (custom     │  (ESP32-S3,       │
│  Expo)           │   protocol)   │  NimBLE 2.x)      │
└─────────────────┘                └─────────┬─────────┘
                                              │ WiFi (station)
                                              │ HTTP JSON API
                                    ┌─────────▼─────────┐
                                    │  GLEDOPTO ESP32    │
                                    │  (WLED v16+,       │
                                    │  WLED_IP=4.3.2.1)  │
                                    └─────────┬─────────┘
                                              │
                                    ┌─────────▼─────────┐
                                    │  LED Strings        │
                                    │  ALITOVE WS2811     │
                                    │  IP68 (production)  │
                                    │  BTF WS2812B (test) │
                                    └────────────────────┘
```

The logic board also passively scans for BLE advertising packets from MagicBand+ devices (Disney's "E9" packet format) to trigger lighting events without any pairing required.

### Key components

| Component                 | Details                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| Logic board               | Custom ESP32-S3, NimBLE 2.x, BLE peripheral + passive scanner           |
| LED controller            | GLEDOPTO ESP32, WLED v16+, `WLED_IP=4.3.2.1`                            |
| LEDs (production)         | ALITOVE WS2811 IP68, 50-node, 5V, 12mm diffused                         |
| LEDs (test/dev)           | BTF-LIGHTING WS2812B strip                                              |
| Enclosure                 | ABS project box, neutral-cure silicone + cable glands for waterproofing |
| BLE device name           | `IllumaBuggy`                                                           |
| BLE service UUID          | `12345678-1234-1234-1234-123456789abc`                                  |
| BLE CMD characteristic    | `...abd` (WRITE)                                                        |
| BLE NOTIFY characteristic | `...abe` (NOTIFY)                                                       |

See [`PROTOCOL.md`](./PROTOCOL.md) for the full BLE protocol specification.

## Features

- **Phone-controlled LED effects** with theme-park-inspired presets
- **GPS-triggered zone automation** — different lighting presets activate automatically based on location within the park
- **MagicBand+ event response** — passive detection of MagicBand+ BLE advertising packets (E9) to trigger lighting reactions
- **Brightness control** and a **custom palette / palette set system**
- **"Find my stroller" mode** for locating the stroller in a crowd
- **WLED effect & palette browser** with live preview (mobile app)
- **Web configuration tool** with Google Maps integration for drawing and managing GPS zones

## Repository structure

```
illuma-buggy/
├── firmware/        # ESP32-S3 logic board firmware (Arduino/C++, NimBLE)
├── app/              # React Native + Expo companion app (Android)
├── web-tool/         # Single-file React web configuration tool
├── PROTOCOL.md        # BLE protocol specification
└── agent.md           # Project reference doc for use with Cursor IDE
```

_(Adjust the above to match actual folder names in the repo.)_

## Status

| Component                           | Status                                                  |
| ----------------------------------- | ------------------------------------------------------- |
| Firmware                            | v2.0 finalized — BLE protocol-based, WebSockets removed |
| LED controller (GLEDOPTO + WS2812B) | Fully functional                                        |
| ALITOVE WS2811 production string    | Built, pending full validation in stroller config       |
| Web configuration tool              | Functional — effects, palettes, zone drawing, profiles  |
| Mobile app (React Native + Expo)    | In active development (primary current focus)           |
| Real-world park testing             | Upcoming                                                |

## Hardware setup notes

- LED data is driven from **GPIO 16** on the GLEDOPTO board (not GPIO 2).
- The GLEDOPTO relay (GPIO 18) physically cuts LED output when master power is off — firmware must POST `{"on":true,"bri":255}` to the WLED JSON API at the start of every session.
- WS2811 splices must preserve data direction; keep extension runs short, use a 300–500Ω resistor on the data line for longer runs, and use ≥24 AWG wire.
- Enclosure waterproofing uses **neutral-cure (aquarium-safe) silicone only** — acetoxy-cure silicone will craze ABS plastic over time.

## BLE protocol

The logic board communicates with the mobile app over a custom BLE protocol (not WebSockets/WiFi) — see [`PROTOCOL.md`](./PROTOCOL.md) for the full message format. Each BLE notification from the firmware is a complete, self-contained JSON object; the app does not need to (and should not) reassemble fragments across notifications.

## MagicBand+ event detection

The logic board passively scans for MagicBand+ BLE advertising packets (no pairing required). Commands `E9 05`, `E9 06`, `E9 08`, and `E9 09` are well documented; `E9 08` uses 6-bit color values that must be scaled to 8-bit RGB. Animation commands (`E9 0b`, `E9 0c`, `E9 13`) include some undocumented byte fields that are still being reverse-engineered.

## WLED JSON API

The LED controller is configured and controlled via the standard [WLED JSON API](https://kno.wled.ge/interfaces/json-api/) over HTTP, including effect/palette browsing, segment control, and live preview. WLED v16+ supports 100+ custom palettes.

## License

This project is licensed under the [GNU General Public License v3.0](./LICENSE) (GPL-3.0). Copyleft — any derivative work must also be released under GPL-3.0.

## Disclaimer

This project is an independent, unofficial hobby creation and is not affiliated with, endorsed by, or sponsored by Disney. References to MagicBand+ and Starlight Wand are for interoperability purposes only, based on publicly available reverse-engineering documentation. MagicBand+ and Starlight Wand are trademarks of their respective owners.
