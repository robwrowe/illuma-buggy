---
name: Logic SSD1309 OLED
overview: "Deferred plan: migrate the logic-board status OLED from the current SSD1306 module to the new 2.42″ 128×64 SSD1309 I2C panel (same SDA 21 / SCL 47), with init/compat tweaks, docs, and a compact SD status on the status screen. Do not implement until the panel is in hand and validated."
todos:
  - id: ssd1309-bench
    content: "Bench new panel: address, SWITCHCAP vs EXTERNALVCC, contrast"
    status: pending
  - id: ssd1309-init-config
    content: Config + StatusDisplay init strings/VCC mode; keep 128x64 layout
    status: pending
  - id: ssd1309-sd-line
    content: Add compact SD:OK/-- on WLED status row via sdRuleLoggerReady()
    status: pending
  - id: ssd1309-docs
    content: Update claude-memory + pcb-final-build-spec (+ AGENTS if needed)
    status: pending
isProject: false
---

# Logic board — new 2.42″ SSD1309 OLED (deferred)

**Status: do not implement yet.** Execute only after the panel arrives and a smoke test confirms I2C address / Adafruit `begin` behavior.

## Hardware

| Item               | Detail                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Panel              | 2.42″ 128×64, **SSD1309**, 4-pin I2C (Arduino-style)                                                                           |
| Board              | ESP32-S3 logic (`ILLUMA_LOGIC_BOARD`)                                                                                          |
| Wiring (unchanged) | SDA **21**, SCL **47**, VCC **3.3V**, GND                                                                                      |
| Address            | Try **0x3C**, then **0x3D** (existing scan + fallback in [`StatusDisplay.cpp`](firmware/StrollerController/StatusDisplay.cpp)) |

Same logical resolution as today → **keep the current 8×21 layout** from the recent StatusDisplay rewrite (WLED/Up, Role, Link, Heap/PSRAM, Show/Ov, Preset name wrap, Rules wrap). Physically larger pixels only.

Confirm the module is **3.3V-tolerant** on VCC/logic; do not feed 5V into S3 I2C pins.

## Software approach

Stay on **Adafruit SSD1306 + GFX** first (already in [`LIBRARIES.txt`](firmware/StrollerController/LIBRARIES.txt)). SSD1309 is usually command-compatible; many panels work with `display.begin(SSD1306_SWITCHCAPVCC, addr)`.

If init fails or the image is blank/garbled/shifted:

1. Retry `EXTERNALVCC` instead of `SWITCHCAPVCC`.
2. Soften/remove the hard contrast `0xFF` if the panel washes out.
3. Only if still broken: switch controller path to **U8g2** `SSD1309` (larger change — avoid unless needed).

Add a small Config knob so we can flip init without rewriting call sites, e.g. in [`Config.h`](firmware/StrollerController/Config.h):

```cpp
// Logic OLED controller: 0 = Adafruit SSD1306 API (works for many SSD1309)
// Set OLED_VCC_MODE after bench test if SWITCHCAP fails.
#define OLED_USE_EXTERNAL_VCC 0
```

Update boot banner strings from “SSD1306” → “OLED” / “SSD1309” so serial logs match the hardware.

## Status line addition (with the panel work)

While touching [`StatusDisplay.cpp`](firmware/StrollerController/StatusDisplay.cpp), fold **SD** into the first status row so park ops can see mount without serial:

```
WLED:OK SD:OK Up:123s
```

(or `SD:--` when `!sdRuleLoggerReady()`). Truncate `Up:` if the line exceeds 21 cols. Use [`SdRuleLogger`](firmware/StrollerController/SdRuleLogger.h) `sdRuleLoggerReady()` only — no path on OLED.

## Docs

When implementing:

- [`docs/claude-memory-uart-dual-board.md`](docs/claude-memory-uart-dual-board.md) OLED section — SSD1309 2.42″, same pins, VCC note.
- [`docs/pcb-final-build-spec.md`](docs/pcb-final-build-spec.md) — note SSD1309 as current logic panel.
- Light mention in [`AGENTS.md`](AGENTS.md) Hardware table if OLED is listed.

## Bench verify (before merging)

1. I2C scan prints `0x3C` or `0x3D`.
2. Splash + live status readable (no column shift).
3. UART Link / Role / Preset name / Rules lines still wrap correctly on the larger glass.
4. `SD:OK` / `SD:--` tracks card insert/remove across reboot (soft-fail unchanged).
5. No I2C hangs under BLE+WiFi load (keep 100 kHz Wire unless proven safe to raise).

## Out of scope

- Scanner OLED (separate plan: Scanner OLED status).
- Changing logic I2C pins.
- Full U8g2 rewrite unless Adafruit path fails on the real panel.
