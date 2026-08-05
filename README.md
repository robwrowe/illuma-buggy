# Illuma Buggy

A custom LED lighting system for a theme park stroller — phone-controlled effects, GPS-triggered zone presets, and passive MagicBand+ / Starlight Wand event reactions, built on a two-board ESP32 system paired with a WLED-powered LED controller.

This is a personal hobby project built for fun and to make theme park trips with young kids a little more magical.

## Overview

Illuma Buggy is a four-part system:

1. **Scanner board** — a classic ESP32 running NimBLE that passively observes BLE advertising packets from MagicBand+ and Starlight Wand devices, decodes Disney's `E9`/`E4` packet format, and forwards matched events over a wired UART link.
2. **Logic board** — an ESP32-S3 that receives scanner events over UART, runs the rule engine that maps them (and GPS zones, presets, and manual commands) to LED behavior, talks to the phone app over BLE, and drives the LED controller over WiFi.
3. **LED Controller** — a GLEDOPTO ESP32 controller running [WLED](https://kno.wled.ge/), driving the physical LED strings over its own HTTP JSON API.
4. **Companion Apps** — a React Native + Expo mobile app (Android-first, used for field configuration and live control) and a React/Mantine web tool (desk authoring for effects, palettes, rules, and GPS zones).

## Architecture

```
┌────────────────┐   BLE (advertising)   ┌────────────────────┐
│ MagicBand+ /   │ ─────────────────────►│  Scanner Board     │
│ Starlight Wand │    passive observe    │  (classic ESP32,   │
└────────────────┘                       │  NimBLE scan)      │
                                         └──────────┬─────────┘
                                                    │ Wired UART
                                                    │ (cross-over + common GND)
┌────────────────┐    BLE peripheral     ┌──────────▼──────────┐
│  Mobile App /  │◄─────────────────────►│  Logic Board        │
│  Web Tool      │    (custom protocol)  │  (ESP32-S3,         │
└────────────────┘                       │  rule engine, OLED, │
                                         │  SD logging)        │
                                         └──────────┬──────────┘
                                                    │ WiFi (station)
                                                    │ HTTP JSON API
                                         ┌──────────▼──────────┐
                                         │  GLEDOPTO ESP32     │
                                         │  (WLED)             │
                                         └──────────┬──────────┘
                                                    │
                                         ┌──────────▼───────────┐
                                         │  LED Strings         │
                                         │  ALITOVE WS2811 IP68 │
                                         │  (or BTF WS2812B)    │
                                         └──────────────────────┘
```

The scanner and logic boards are separate physical boards connected only by a wired UART link (TX/RX crossed, shared ground) — there is no wireless link between them, and no local BLE scanning fallback runs on the logic board while the scanner link is alive.

### Key components

| Component                 | Details                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| Logic board                | ESP32-S3-DevKitC-1-N16R8, rule engine, BLE peripheral (to app), OLED status, SD logging |
| Scanner board              | Classic ESP32 (NodeMCU-style), passive NimBLE scan for Disney packets, OLED status, SD logging |
| Inter-board link           | Wired UART only (crossed TX/RX + common GND) — ESP-NOW has been fully removed |
| LED controller             | GLEDOPTO ESP32, running WLED, driven over WiFi HTTP JSON API             |
| LEDs (production)          | ALITOVE WS2811 IP68, 50-node, 5V                                        |
| LEDs (alternate/test)      | BTF-LIGHTING WS2812B, IP65                                              |
| Enclosure                  | ABS project box, neutral-cure silicone + cable glands for waterproofing |
| BLE device name (app link) | `IllumaBuggy`                                                           |
| BLE service UUID           | `12345678-1234-1234-1234-123456789abc`                                 |
| BLE CMD characteristic     | `...abd` (WRITE)                                                        |
| BLE NOTIFY characteristic  | `...abe` (NOTIFY)                                                       |

See [`firmware/StrollerController/PROTOCOL.md`](./firmware/StrollerController/PROTOCOL.md) for the app ↔ logic board BLE protocol, and [`docs/pcb-final-build-spec.md`](./docs/pcb-final-build-spec.md) for the authoritative dual-board build spec (pin maps, UART framing, implementation status).

## Features

- **Phone-controlled LED effects** with theme-park-inspired presets
- **GPS-triggered zone automation** — different lighting presets activate automatically based on location within the park
- **Passive MagicBand+ / Starlight Wand event response** — the scanner board observes BLE advertising packets (no pairing required) and forwards decoded events to the logic board's rule engine, which supports per-rule enable/disable, priority ordering, and exclusivity rules
- **Runtime rule and field editing** — `set_field`/`list_fields` and `set_rule_enabled`/`list_rules` for on-the-fly tuning from the app without reflashing
- **On-device SD logging** on both boards — the scanner logs raw observed packets, the logic board logs parsed events and rule-engine decisions, with phone-synced timestamps
- **OLED status displays** on both boards showing link/BLE/scan health at a glance
- **Brightness control** and a custom palette / palette set system
- **Web configuration tool** with GPS zone drawing, rule authoring, and preset management

## Repository structure

```
illuma-buggy/
├── firmware/
│   ├── StrollerController/   # ESP32-S3 logic board firmware (Arduino/C++, NimBLE, rule engine)
│   ├── BleScannerNode/       # Classic ESP32 scanner board firmware (NimBLE passive scan)
│   └── WandSimulator/        # ESP32 sketch for bench-broadcasting Disney BLE packets (testing)
├── app/                      # React Native + Expo companion app (Android-first)
├── web/                      # React + Mantine web configuration tool
├── docs/                     # Protocol references, build specs, opcode documentation
├── scripts/                  # Support scripts (e.g. embedding rules payloads)
└── AGENTS.md                 # Project reference doc for use with Cursor / coding agents
```

## Status

This project is under active development. The current build is a two-board (scanner + logic) system connected over wired UART; the earlier single-board, ESP-NOW-based design has been fully retired.

| Component                                    | Status                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| Scanner board firmware (BLE observe + UART)   | Implemented — passive NimBLE scan, UART forwarding, SD raw logging, OLED status |
| Logic board firmware (rule engine + UART)     | Implemented — UART receive, rule engine, SD rule logging, OLED status  |
| Inter-board UART link                         | Implemented, field-proving in progress                                  |
| ESP-NOW inter-board link                      | Removed — no longer used                                                |
| LED controller (GLEDOPTO + WLED)              | Fully functional                                                        |
| Runtime rule/field editing (`set_field`, `set_rule_enabled`) | Implemented                                                |
| BLE opcode coverage (MagicBand+ / Starlight Wand) | Substantial — several families fully decoded, a few sub-rules and edge cases still being reverse-engineered |
| Web configuration tool                        | Functional — effects, palettes, rule authoring, zone drawing            |
| Mobile app (React Native + Expo)              | In active development, Android-first                                    |
| Combined single-PCB build (both boards)       | Deferred until UART link is fully field-proven                          |
| Real-world park testing                       | Ongoing — real park visits used as field validation                     |

## Hardware

### Required

| Part | Description | Link |
| --- | --- | --- |
| Logic Board | ESP32-S3 Development Board, N16R8 | [Amazon](https://www.amazon.com/dp/B0F5QCK6X5?ref=ppx_yo2ov_dt_b_fed_asin_title&th=1) |
| Scanner Board | ESP32 Development Board | [Amazon](https://www.amazon.com/dp/B0CNYK7WT2?ref=ppx_yo2ov_dt_b_fed_asin_title) |
| WLED Controller | GLEDOPTO ESP32, 5V | [Amazon](https://www.amazon.com/dp/B0D4Z4YG4H?ref=ppx_yo2ov_dt_b_fed_asin_title) |
| LED Pixel Strand | ALITOVE WS2811, 50 pixels, 5V | [Amazon](https://www.amazon.com/dp/B06XD72LYM?ref=ppx_yo2ov_dt_b_fed_asin_title&th=1) |
| LED Pixel Strip (alternate) | BTF-LIGHTING WS2812B, IP65 | [Amazon](https://www.amazon.com/dp/B088B9QWHT?ref=ppx_yo2ov_dt_b_fed_asin_title&th=1) |

### Optional / recommended

| Part | Description | Link |
| --- | --- | --- |
| Battery Bank | Portable power for the buggy | [Amazon](https://www.amazon.com/dp/B0D63H6KKV?ref=ppx_yo2ov_dt_b_fed_asin_title&th=1) |
| USB-C Splitter | Recommended for powering the logic and scanner boards together with enough current draw | [Amazon](https://www.amazon.com/dp/B0GST9JRNX?ref=ppx_yo2ov_dt_b_fed_asin_title) |
| Waterproof Project Box | Enclosure for both boards | [Amazon](https://www.amazon.com/dp/B0CSJXL3PV?ref=ppx_yo2ov_dt_b_fed_asin_title) |
| OLED Display | Status information for each board | [Amazon](https://www.amazon.com/dp/B0G384SJ9V?ref=ppx_yo2ov_dt_b_fed_asin_title) |
| ESP32-S3 Terminal Breakout Board | Easier wiring, more durable for riding in the stroller | [Amazon](https://www.amazon.com/dp/B0GFP5Q122?ref=ppx_yo2ov_dt_b_fed_asin_title) |
| ESP32 Terminal Breakout Board | Same, for the scanner board | [Amazon](https://www.amazon.com/dp/B0BYS6THLF?ref=ppx_yo2ov_dt_b_fed_asin_title&th=1) |

## Hardware setup notes

- LED data is driven from **GPIO 16 & 2** on the GLEDOPTO board; the GLEDOPTO relay (GPIO 18) physically cuts LED output when master power is off, so firmware must POST `{"on":true,"bri":255}` to the WLED JSON API at the start of every session.
- The scanner and logic boards are connected only by wired UART: scanner TX → logic RX and logic TX → scanner RX, plus a shared ground — USB ground alone is not sufficient.
- On the classic ESP32 scanner board, GPIO 6–11 are reserved for internal flash and must never be used for SD/SPI; SD wiring uses VSPI on GPIO 5/18/23/19 instead.
- WS2811 splices must preserve data direction; keep extension runs short, use a 300–500Ω resistor on the data line for longer runs, and use ≥24 AWG wire.
- Enclosure waterproofing uses **neutral-cure (aquarium-safe) silicone only** — acetoxy-cure silicone will craze ABS plastic over time; seal cable entries with PG7/PG9 glands.

## BLE protocol (app ↔ board)

The logic board communicates with the mobile app and web tool over a custom BLE protocol — see [`firmware/StrollerController/PROTOCOL.md`](./firmware/StrollerController/PROTOCOL.md) for the full message format. Each BLE notification from the firmware is a complete, self-contained JSON object; larger responses are chunked with sequence/last markers rather than requiring app-side reassembly of arbitrary fragments.

## MagicBand+ / Starlight Wand event detection

The scanner board passively observes BLE advertising packets from MagicBand+ and Starlight Wand devices (no pairing required) and forwards decoded, matched events to the logic board over UART. The rule engine on the logic board maps these events — along with GPS zones, presets, and manual commands — to WLED effects.

Packet decoding covers Disney's `0x8301`-prefixed BLE format across multiple `E9` command families (timing, color/palette, animation zone layouts); some sub-rules and edge-case byte fields are still being reverse-engineered from field captures. See [`docs/README.md`](./docs/README.md) for the full set of protocol and opcode reference documents, and [`docs/pcb-final-build-spec.md`](./docs/pcb-final-build-spec.md) for current implementation status.

## WLED JSON API

The LED controller is configured and controlled via the standard [WLED JSON API](https://kno.wled.ge/interfaces/json-api/) over HTTP, including effect/palette browsing, segment control, and live preview.

## License

This project is licensed under the [GNU General Public License v3.0](./LICENSE.txt) (GPL-3.0). Copyleft — any derivative work must also be released under GPL-3.0.

## Disclaimer

This project is an independent, unofficial hobby creation and is not affiliated with, endorsed by, or sponsored by Disney. References to MagicBand+ and Starlight Wand are for interoperability purposes only, based on publicly available reverse-engineering documentation and original field observation. MagicBand+ and Starlight Wand are trademarks of their respective owners.

## Special Thanks

A big thank you to the folks over at [EMCOT](https://emcot.world/) - without their reverse-engineering of the [MagicBand+ Bluetooth codes](https://emcot.world/Disney_MagicBand%2B_Bluetooth_Codes), this project would not have been possible
