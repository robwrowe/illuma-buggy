# Runbook — Getting rules onto the board (PSRAM cache)

Rules are **not** flashed into PSRAM. PSRAM holds the live rules document (`gRulesDoc`) at runtime. This runbook covers the two ways to load that cache, plus how to verify it worked.

```
┌─────────────────────┐     boot / BLE push      ┌──────────────────┐
│ SPIFFS /mb_rules.json│ ──────────────────────► │ PSRAM gRulesDoc  │
│ (persists across     │                         │ (runtime match)  │
│  power cycles)       │ ◄── save on BLE push ── │                  │
└─────────────────────┘                         └──────────────────┘
          ▲
          │ seed once (or every boot if forceOverride)
┌─────────┴───────────┐
│ Firmware flash image│  ← EmbeddedRules.h from embed_rules.py
│ (optional seed)     │
└─────────────────────┘
```

| Store | Role |
|-------|------|
| **PSRAM** (`gRulesDoc`) | Runtime rules engine cache — what matching uses |
| **SPIFFS** (`/mb_rules.json`) | Durable copy loaded on every boot |
| **Firmware image** (`EmbeddedRules.h`) | Optional compile-time seed when SPIFFS is empty (or `forceOverride`) |

---

## Path A — Day to day: push over BLE (preferred)

Use this when iterating in the web tool. No firmware rebuild.

### Steps

1. Serve the web tool (`cd web && ./serve.sh`) and open it in **Chrome** (Web Bluetooth).
2. Edit rules under the Rules / Wand Lab UI as usual.
3. Open **📡 Send to Board**.
4. Connect to **IllumaBuggy** if not already connected.
5. Ensure **MB rules + mapping** is checked.
6. Sync.

That sends `set_mb_rules` with a compact mapping payload. Firmware:

1. Saves JSON to SPIFFS `/mb_rules.json`
2. Deserializes into the PSRAM rules cache
3. ACKs with `cacheApplied: true|false`

### Verify (serial @ 115200)

Look for:

```text
[FS] saved /mb_rules.json (N bytes)
[Rules] updated (rulesOrMaps=1, N bytes, fs=ok, cache=ok)
```

Web/app ACK should include `"cacheApplied":true`. If `cache=FAIL` / `cacheApplied:false`, the blob may be too large or malformed for the JSON document budget — trim rules/maps or see [mb-rules-wire-format.md](./ble-packets-details/mb-rules-wire-format.md).

### After reboot

SPIFFS reload should print:

```text
[FS] loaded /mb_rules.json (N bytes)
[Rules] loadMbRulesFromJson …
```

No need to re-push unless you changed rules on the phone/web again.

---

## Path B — Factory / bench: embed in firmware flash

Use this to ship a known-good ruleset in the binary (new boards, wiped SPIFFS, or forcing a baseline).

### 1. Prepare `embedded_rules.json`

Create:

```text
firmware/StrollerController/embedded_rules.json
```

**Shape:** the MB mapping document (what `set_mb_rules` stores).

Required:

- A non-empty `"rules"` array — either at the **root**, or under `"mbMapping"` (full web **Export JSON** profiles)
- Typically also `segmentMaps`, `timingModels`, `colors`, etc.

`embed_rules.py` accepts either form. If you drop in a full profile export, it unwraps `mbMapping` and only that object is baked into flash (not presets/zones/etc.).

Optional top-level flag:

```json
{
  "forceOverride": false,
  "version": 1,
  "rules": [ ... ],
  "segmentMaps": [ ... ]
}
```

| `forceOverride` | Behavior on boot |
|-----------------|------------------|
| omitted / `false` | Seed **only if** SPIFFS has no usable rules |
| `true` | Always overwrite SPIFFS + RAM from the embedded blob |

Leave `forceOverride` false for production so BLE-pushed edits survive reboot and reflash. Use `true` only when you intentionally want the binary to reset the board’s rules every boot.

### 2. Generate the header

“Generate the header” means: run the embed script so JSON becomes a C++ include the sketch compiles in.

```bash
# from repo root
python3 scripts/embed_rules.py
```

What it does:

| Input | Output |
|-------|--------|
| `firmware/StrollerController/embedded_rules.json` | `firmware/StrollerController/EmbeddedRules.h` |

`EmbeddedRules.h` defines:

- `kHasEmbeddedRules` — `true` when embed succeeded
- `kEmbeddedRulesJson` — escaped JSON string baked into flash

Success looks like:

```text
[embed_rules] embedded N bytes from embedded_rules.json (R rules)
```

Failures:

- Missing file → empty placeholder (`kHasEmbeddedRules = false`); flash still builds, no seed
- Invalid JSON or empty `rules` → script exits non-zero; fix the JSON

**Do not edit `EmbeddedRules.h` by hand** — re-run the script whenever `embedded_rules.json` changes, then rebuild/flash.

### 3. Flash firmware

Arduino IDE (or your usual upload):

- Board: **ESP32S3 Dev Module**
- **PSRAM: OPI PSRAM**
- Flash size / partition: match the chip (see `firmware/StrollerController/LIBRARIES.txt`)
- Sketch: `firmware/StrollerController/`

Upload over USB.

### 4. Verify seed on first boot

Serial @ 115200:

```text
[Rules] Seeding from embedded_rules.json (force=0)
[Rules] Embedded rules persisted to SPIFFS
[FS] saved /mb_rules.json (N bytes)
```

Then the normal load path fills PSRAM. Later boots (with `forceOverride` false and SPIFFS already populated) skip the seed and only load from SPIFFS.

---

## Quick decision guide

| Goal | Use |
|------|-----|
| Edit rules while developing | **Path A** (BLE push) |
| New board / wiped FS / known factory baseline | **Path B** (embed + flash) |
| Force binary to always win over SPIFFS | Path B + `"forceOverride": true` (use sparingly) |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| No seed after flash | Forgot `embed_rules.py`, or placeholder header | Run script; confirm `kHasEmbeddedRules` is true in `EmbeddedRules.h`; reflash |
| Seed skipped on boot | SPIFFS already has rules and `forceOverride` is false | Expected — use BLE push, or set `forceOverride`, or clear SPIFFS |
| `cache=FAIL` after BLE | Parse/alloc failed (size / nesting) | Check capacity gauge in web UI; compact payload; serial `[Rules]` heap lines |
| `fs=FAIL` / `reason: fs_persist` | SPIFFS write failed | Free space / remount; serial `[FS]` lines |
| `psramSize=0` at boot | PSRAM disabled in board options | Enable **OPI PSRAM**; rules still try internal heap fallback but large sets may fail |
| Edited `embedded_rules.json` but board unchanged | Header / binary not regenerated | Re-run `embed_rules.py`, rebuild, flash |

---

## Related

- [mb-rules-wire-format.md](./ble-packets-details/mb-rules-wire-format.md) — compact vs verbose JSON
- [pcb-final-build-spec.md](./pcb-final-build-spec.md) — Part 9 embedded rules
- `scripts/embed_rules.py` — generator
- `firmware/StrollerController/EmbeddedRules.h` — generated (do not hand-edit)
- `firmware/StrollerController/MbRuleEngine.cpp` — PSRAM cache
- `firmware/StrollerController/MbRulesStore.cpp` — SPIFFS `/mb_rules.json`
