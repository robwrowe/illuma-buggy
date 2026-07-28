# Claude memory update — Illuma Buggy dual-board UART (Jul 2026)

Paste this into a new Claude/Cursor chat (or project memory) so the agent does not
assume the older ESP-NOW / S3-scanner architecture.

---

## What changed (authoritative)

Illuma Buggy is now a **UART dual-board** system. **ESP-NOW between logic and
scanner has been removed** (Part 3 done).

| Role | Hardware | Firmware sketch | Arduino board setting |
|------|----------|-----------------|------------------------|
| **Logic** | ESP32-S3-DevKitC-1-**N16R8 v1.3** | `firmware/StrollerController/` | **ESP32S3 Dev Module** (OPI PSRAM, 16MB flash) |
| **Scanner** | HiLetgo / NodeMCU **ESP-32D** DevKitC-32 (classic ESP32, 38-pin, CP2102 USB-C) | `firmware/BleScannerNode/` | **ESP32 Dev Module** (not S3) |
| **WLED** | GLEDOPTO (unchanged) | stock WLED | WiFi HTTP only |

Branch of record for this work: `feat/uart`. Spec index:
[`docs/pcb-final-build-spec.md`](pcb-final-build-spec.md).

`Config.h` is **shared** (symlink: `BleScannerNode/Config.h` → `StrollerController/Config.h`).
Board-specific defines come from sketch `build_opt.h`:

- Logic: `-DILLUMA_LOGIC_BOARD=1`
- Scanner: `-DILLUMA_SCANNER_BOARD=1`

---

## Architecture (current)

```
Phone ──BLE──► Logic ESP32-S3 ──WiFi STA──► GLEDOPTO / WLED
                 ▲
                 │ UART (framed packets + 2s heartbeats)
                 │
            Scanner classic ESP32
                 ▲
                 │ NimBLE active scan (Disney 0x8301)
            MagicBand+ / Starlight / WandSim
```

- App talks **only** to the logic board over BLE (GATT).
- Scanner does **not** use WiFi or ESP-NOW.
- Logic board role **LOGIC_BOARD**: Disney scan is **off** on the logic radio.
- Logic board role **STANDALONE**: logic runs local Disney scan (no second board).

### Park BLE / phone connection (important)

When UART is healthy, the logic board does **not** run a second NimBLE Disney
scanner. That keeps the phone GATT link free of scan contention.

If UART goes silent: OLED shows **Link: LOST** only — **no** local-scan fallback
on LOGIC_BOARD (removed with ESP-NOW). Do not reintroduce “scan on logic if
scanner quiet” without an explicit product decision; it can drop park phone BLE.

---

## UART wiring (bench-proven)

Cross TX/RX; **common GND required** (do not rely on shared USB ground alone).

| Scanner (classic ESP-32D silk) | Logic (S3 v1.3) |
|--------------------------------|-----------------|
| **P17** (TX) | **GPIO 18** (RX) |
| **P16** (RX) | **GPIO 17** (TX) |
| **GND** | **GND** |

Logic firmware **hard-forces** Serial1 to TX=17 / RX=18 in `uartScannerLinkInit()`
(GPIO 8 is Arduino’s default Wire SDA on S3 and was unreliable for UART RX).

Scanner UART: TX=17 / RX=16 (classic; GPIO 8 is flash — never use S3’s old RX=8 map
on the classic board).

Silkscreen traps on the HiLetgo board: use **P16/P17**, not SD2/SD3/SDD/SDI/CLK
(flash), and not USB **RX/TX** (GPIO 3/1).

Expected serial:

- Scanner: `[UART] heartbeat #N` every ~2s; `[UART] forwarding…` on Disney packets
- Logic: `[UART] Serial1 FORCED TX=17 RX=18…`; diag `hb` climbing; OLED **Link: OK**

---

## Status indicators

### Logic onboard RGB (DevKitC-1 **v1.3** → **GPIO 38**)

Driven via ESP32 `rgbLedWrite` (not Adafruit NeoPixel). Also pulses 48 as
fallback for v1.0 boards. Arduino core’s `PIN_RGB_LED` defaults to 48 — **wrong
for v1.3**; code must target 38.

### OLED (logic only)

- SDA **21**, SCL **47**, addr **0x3C** (try 0x3D), VCC **3V3**, GND
- Soft-fail if absent
- **Link: LOST** = no UART packet/heartbeat within `SCANNER_ALIVE_MS` (10s)

### Scanner StatusLed

No-op on classic ESP-32D (no onboard RGB). S3 scanner builds may still NeoPixel.

---

## SD cards

Both boards **can** use SD; soft-fail if no card.

| Board | SPI pins |
|-------|----------|
| Logic S3 | CS **10**, SCK **12**, MOSI **11**, MISO **13** |
| Scanner classic ESP32 | CS **5**, SCK **18**, MOSI **23**, MISO **19** (VSPI — **not** 6–11) |

Earlier `HAS_SD_LOGGER 0` on classic was only because the S3 pin map collided with
flash. Remapped pins restore SD on the ESP-32D scanner.

Use a **3.3V-tolerant** microSD module (or level shifter). Common “5V” Arduino SD
modules can brown out or corrupt SPI on ESP32.

---

## What was deleted / do not revive casually

- ESP-NOW pair beacon, peer MAC requirement for forwarding, channel sweep
- `ScannerAdvertise.*` (unpaired IllumaScan BLE advertise for ESP-NOW pairing)
- `USE_UART_SCANNER_LINK` flag (UART is always the inter-board path)
- Logic-board local Disney scan fallback when dual-board UART is silent

App Settings may still show dual-board / scanner MAC fields as **informational**;
UART needs no wireless pairing. Copy should say UART, not ESP-NOW.

---

## Firmware entry points

| Concern | Where |
|---------|--------|
| Logic UART init/poll + packet queue | `StrollerController/PayloadTransport.*`, `UartLink.h` |
| Scanner UART send + heartbeat | `BleScannerNode/ScannerPayloadTransport.*` |
| Shared pins / SD / OLED | `StrollerController/Config.h` (symlinked) |
| OLED UI | `StatusDisplay.*` |
| Logic status RGB | `StatusLed.cpp` (`rgbLedWrite` GPIO 38) |
| Rules in PSRAM | `MbRuleEngine.*`, `docs/rules-psram-runbook.md` |

---

## Spec parts checklist (PCB final build)

| Part | Status |
|------|--------|
| 1 Shared USB-C power / PCB | Hardware — open |
| 2 UART inter-board | Done |
| 3 Remove ESP-NOW | Done |
| 4 SD logging | Done (pins per board; wire cards still) |
| 5 OLED | Done |
| 6–13 fields, rules, Park Mode, BLE harden, etc. | Done |

Open product/roadmap (not this PCB slice): OTA, WLED usermod, find-my-stroller,
enclosure, more in-park MB+ opcodes — see root `AGENTS.md` roadmap.

---

## Agent do / don’t

**Do**

- Treat dual-board as UART + shared GND.
- Flash logic as ESP32S3; scanner as classic ESP32.
- Gate Disney scan on logic to STANDALONE only.
- Keep FreeRTOS rules: no HTTP/`String` in NimBLE callbacks; queue to loop.

**Don’t**

- Reintroduce ESP-NOW without an explicit request.
- Use GPIO 6–11 for peripherals on classic ESP32.
- Put logic UART RX back on GPIO 8 without a strong reason.
- Start continuous active scan on the logic board while the phone is expected to
  stay connected in dual-board mode.
- Assume scanner is an S3 or that both boards share one pin map.

---

## Quick verify after flash

1. Logic boot: `FORCED TX=17 RX=18`, OLED up, RGB cyan/blue then status colors on **38**.
2. Scanner boot: `target=ESP32`, UART forward/heartbeat lines, no WiFi/ESP-NOW init.
3. OLED **Link: OK** within a few seconds of heartbeats.
4. Optional: mount SD — logic `[SD] mounting SPI CS=10…`; scanner `CS=5 SCK=18…`.
