# StrollerController — BLE Protocol

Connect via BLE to **`IllumaBuggy`** (the logic board). This is the app ↔ logic board
protocol only — it does not cover the scanner-board ↔ logic-board UART link (see
[`docs/pcb-final-build-spec.md`](../../docs/pcb-final-build-spec.md)) or Disney BLE
packet decoding (see `docs/disney-ble-protocol.md`, being updated separately).

| Role | UUID |
|------|------|
| Service | `12345678-1234-1234-1234-123456789abc` |
| CMD (write) | `12345678-1234-1234-1234-123456789abd` |
| NOTIFY | `12345678-1234-1234-1234-123456789abe` |

App writes JSON to CMD. Board notifies JSON on NOTIFY. Large responses are chunked (`seq`, `last`, `data`).

Source of truth for the tables below: `firmware/StrollerController/BleCommandHandler.cpp`
(command dispatch) and `firmware/StrollerController/RuntimeFields.h` (runtime field
whitelist). Re-check that file if this doc and firmware ever disagree.

---

## App → board

### Presets & WLED

```json
{"type":"preset_save","id":"fantasy","name":"Fantasyland","wled":{"on":true,"bri":200,"seg":[{"fx":0}]}}
{"type":"preset_apply","id":"fantasy"}
{"type":"preset_delete","id":"fantasy"}
{"type":"preset_list"}
{"type":"wled_raw","wled":{"on":true,"bri":255,"seg":[{"fx":42}]}}
{"type":"wled_raw","wled":{...},"preset_id":"fantasy"}
{"type":"wled_get_effects"}
{"type":"wled_get_palettes"}
{"type":"wled_get_fxdata"}
{"type":"wled_get_state"}
{"type":"brightness","value":180}
```

`wled_raw` with a `preset_id` takes a MANUAL override and records that preset as active
(subject to override priority — see below); without `preset_id` it's a live preview/effect
push and does not change the active preset. Payloads containing a WLED `seg` array are
treated as a segment/preset apply (snap, no crossfade); payloads without `seg` go through
the crossfade path used for live BLE effects.

### Zones, overrides & transitions

```json
{"type":"zone_trigger","preset_id":"fantasy"}
{"type":"override_clear"}
{"type":"override_mode","kill_on_zone":true}
{"type":"fade_to_black","fade_ms":800}
{"type":"fade_to_black","fade_ms":800,"preset_id":"fantasy"}
```

- `override_mode.kill_on_zone` — when `true`, an active zone transition can clear a MANUAL override; persisted to NVS.
- `fade_to_black` — takes a MANUAL override and either fades WLED to off (`on:false`) or crossfades into `preset_id` if given, over `fade_ms` (default `800`). Blocked if a higher-priority override (SHOW_MODE / BLE_EFFECT) is active.

### Show Mode (parade / fireworks)

```json
{"type":"show_mode_config","parade":{"pre":"...","live":"..."},"fireworks":{"pre":"...","live":"__BLACK__","post":"..."}}
{"type":"show_mode_enter","show":"parade","phase":"live"}
{"type":"show_mode_exit"}
{"type":"parade_manual_start"}
{"type":"parade_manual_stop"}
```

- `show_mode_config` — persists the WLED "look" strings used for each show/phase combination to NVS. `pre`/`live`/`post` are opaque look identifiers consumed by `applyShowPhaseLook()`; `fireworks.live` defaults to the sentinel `"__BLACK__"`.
- `show_mode_enter` — `show` is `parade` or `fireworks`; `phase` is `pre`, `black`, `live`, or `post`. Entering `parade`+`post` is treated as an exit (clears the override) rather than a real phase. Takes the `SHOW_MODE` override, which outranks `MANUAL` and `ZONE`.
- `show_mode_exit` — clears `SHOW_MODE` unconditionally.
- `parade_manual_start` / `parade_manual_stop` — separate manual parade trigger path (`manualParadeStart()`/`manualParadeStop()`), independent of `show_mode_enter`.

### BLE Data (Starlight Wand & MagicBand+)

```json
{"type":"sw_config","enabled":true,"timeout_ms":30000}
{"type":"mb_config","enabled":true,"timeout_ms":30000,"defer_to_app":false}
{"type":"rules_pause_config","paused":true}
{"type":"ble_effect_config","transition_ms":700}
{"type":"scan_log_config","enabled":true}
{"type":"log_marker","msg":"Happily Ever After — castle flash"}
{"type":"list_rules"}
{"type":"set_rule_enabled","ruleId":"castle-flash","enabled":false}
{"type":"get_rule_log","limit":50,"events":["marker","match","suppressed"]}
{"type":"ble_capture_config","active":true,"label":"parade-run-1","duration_ms":60000}
{"type":"mb_unmatched_log_config","active":true}
{"type":"set_mb_rules","mapping":{"rules":[...],"segmentMaps":[...]}}
```

| Field | Notes |
|-------|-------|
| `timeout_ms` | `0` = never auto-clear BLE override |
| `mb_config.defer_to_app` | Persisted flag; consult firmware for current effect on rule-engine behavior — not yet documented here |
| `rules_pause_config.paused` | Pause/resume rule matching (NVS). Zones/manual presets still work; does not clear an active override |
| `ble_effect_config.transition_ms` | Crossfade duration used for live MagicBand+/Starlight Wand effect pushes (NVS) |
| `log_marker` | Prints `[Marker] …` on Serial and writes an SD/RAM rule-log `marker` event. `msg`/`message` accepted; truncated to 120 chars, non-printable/quote characters sanitized |
| `list_rules` / `set_rule_enabled` | Park-side enable/disable of individual rules without re-pushing the full mapping. Disabling the currently-active rule forces a lifecycle restore |
| `get_rule_log` | Pull newest ring entries (`limit` 1–96, clamped). Optional `events` string or array allow-list. Always served from RAM ring (SD is a durable mirror) |
| `ble_capture_config` | Starts/stops recording live Disney BLE traffic to the app (separate from the always-on unmatched-packet log). `duration_ms` auto-stops; omit for manual stop only |
| `mb_unmatched_log_config` | Independent of `ble_capture_config` — always-on log of rule-engine misses, toggled/persisted separately |
| `set_mb_rules` (aliases: `mb_rules_config`, `mb_mapping_config`) | Full rules/segment-map replacement. Accepts either `{"mapping": {...}}` or the mapping object directly at top level. Persisted to SPIFFS `/mb_rules.json` via a temp-file-then-rename write (not NVS — the old NVS blob storage overflowed the 20 KB partition and is actively cleared on every write). Failed persist ACKs `reason: fs_persist` and sets sticky `mb_rules_fs_degraded` |

Chase `sx`/`grp` and solid colors come from **rules/presets**, not global chase config (`mb_chase_config` / `five_point` removed).

### Runtime field editing

```json
{"type":"set_field","field":"magicBandTimeoutMs","value":20000}
{"type":"list_fields"}
```

`set_field`/`list_fields` operate on a fixed whitelist defined in `RuntimeFields.h` —
unlisted field names are rejected with `reason:"not_whitelisted"`. Current whitelist:

| Field | Type | Range / notes | NVS key |
|-------|------|----------------|---------|
| `overrideKillOnZone` | bool | — | `killOnZone` |
| `starlightEnabled` | bool | — | `swEn` |
| `starlightTimeoutMs` | ulong | 1000–120000 | `swTimeout` |
| `magicBandEnabled` | bool | — | `mbEn` |
| `magicBandTimeoutMs` | ulong | 1000–120000 | `mbTimeout` |
| `bleEffectTransitionMs` | ulong | 0–5000 | `bleTransMs` |
| `bleScanLogEnabled` | bool | — | `scanLog` |
| `rulesPaused` | bool | — | `rulesPaused` |
| `statusLedMode` | u8 | 0=normal, 1=dim (~30%), 2=off. Applied live via `writeStatusRgb()`; boot flash is raw and ignores this | `statusLedMode` |
| `boardRole` | string | `"logic_board"` / `"dual"` / `"dual_board"` → logic board mode, anything else → standalone. Not persisted via this path — applies live via `set_board_role` logic and reboots may be required for some effects | — |

Most fields listed above already have dedicated commands (`sw_config`, `mb_config`,
`ble_effect_config`, `scan_log_config`, `rules_pause_config`, `override_mode`) — `set_field`
exists for uniform/scripted access to the same underlying state rather than replacing them.

### Segment map editing

```json
{"type":"list_segments","mapId":"default"}
{"type":"set_segment_field","mapId":"default","segmentId":"front-left","field":"enabled","value":true}
{"type":"set_segment_field","mapId":"default","segmentId":"front-left","field":"start","value":0}
```

`set_segment_field` only accepts `field` of `enabled`, `start`, or `stop`. `start`/`stop`
must be an integer within `0..STRIP_LED_COUNT` (100); other field names or wrong-typed
values are rejected with a `reason`.

### Color calibration

```json
{"type":"set_color_calibration","calibration":{"enabled":true,"curves":{...}}}
{"type":"set_color_calibration","enabled":true,"curves":{...}}
```

Both the nested (`calibration: {...}`) and flat (`enabled`/`curves` at top level) shapes
are accepted. Persisted to LittleFS via `mbCalibrationFsSave` and applied live.

### MagicBand+ segment layouts

```json
{"type":"mb_layout_set","layouts":[{"name":"Standard","segments":{"...":[...]}}],"active":0}
{"type":"mb_layout_switch","index":1}
```

`mb_layout_set` replaces the full layout list (bounded by `MB_MAX_LAYOUTS`); an empty
`layouts` array falls back to firmware defaults. `mb_layout_switch` just changes which
already-loaded layout is active. Both persist to NVS (`mbLayouts`, `mbActiveLayout`).

### WLED network target

```json
{"type":"wled_net_config","ssid":"StrollerNet","pass":"...","ip":"4.3.2.1","port":80}
```

Any subset of `ssid`/`pass`/`ip`/`port` may be sent; unset fields keep their current
value. Persists to NVS and immediately triggers a reconnect to the (possibly new) WLED
target.

### Dual-board role & scanner pairing

```json
{"type":"set_board_role","role":"logic_board"}
{"type":"set_scanner_mac","mac":"AA:BB:CC:DD:EE:FF"}
```

- `set_board_role` — `role` of `"logic_board"`, `"dual"`, or `"dual_board"` all map to logic-board mode; anything else maps to `"standalone"`. Persists to NVS and applies live.
- `set_scanner_mac` — pins the expected scanner peer's MAC for the UART/transport layer; `mac` is a colon-separated hex string.

### Status

```json
{"type":"status"}
```

---

## Board → app

### Ack / error

```json
{"type":"ack","action":"preset_apply","id":"fantasy","ok":true}
{"type":"error","msg":"Failed to fetch effects"}
```

Most `ack` responses include `action` and, on failure, a short `reason` string
(`not_whitelisted`, `wrong_type`, `out_of_range`, `map_not_found`, `segment_not_found`,
`not_found`, `blocked`, `fs_persist`, `too_long`, etc.) rather than a free-text message —
check the relevant command's handler in `BleCommandHandler.cpp` for the exact set a given
command can return.

### Rules summary

```json
{"type":"rules_summary","rules":[{"id":"castle","name":"Castle","prio":0,"enabled":true}]}
```

Rule JSON may include `"reportAsUnmatched": true`. On successful apply the board still runs the rule and also writes SD + notifies `mb_unmatched` (same hex path as true unmatched) so Capture/Sheets can record it.

### Segments summary

```json
{"type":"segments_summary","mapId":"default","segments":[{"id":"front-left","start":0,"stop":25,"enabled":true}]}
```

On failure: `{"type":"segments_summary","mapId":"...","ok":false,"reason":"map_not_found","segments":[]}`.

### Runtime fields list

```json
{"type":"fields_list","fields":[{"name":"magicBandTimeoutMs","type":"ulong","min":1000,"max":120000,"value":15000}, ...]}
```

`type` per field is one of `u8`, `bool`, `ulong`, `string`. `min`/`max` are only present for `u8`/`ulong` fields.

### Rule log pull

```json
{"type":"rule_log_meta","ok":true,"sd":true,"path":"/rules_12345.jsonl","ring":40,"count":12,"limit":50}
```

Then a chunked `rule_log` envelope assembling to a JSON array body.

> **Known gap:** the firmware sends `rule_log` chunks (`{"type":"rule_log", "seq":…, "last":…, "data":…}`), but as of this writing `app/src/services/BLEService.ts`'s `CHUNKED_TYPES` map does not include an entry for `rule_log` → `rule_log_done`. Until the app is updated to reassemble it, `get_rule_log` responses beyond `rule_log_meta` are not consumed by the app. Add `'rule_log': 'rule_log_done'` to `CHUNKED_TYPES` to fix.

### Packet capture events

```json
{"type":"ble_capture","event":"started"}
{"type":"ble_capture","event":"stopped","reason":"manual"}
```

### Status

```json
{
  "type": "status",
  "override": 0,
  "kill_on_zone": false,
  "brightness": 180,
  "preset": "fantasy",
  "wifi": true,
  "wled_ssid": "StrollerNet",
  "wled_ip": "4.3.2.1",
  "wled_port": 80,
  "sw_enabled": true,
  "sw_timeout_ms": 30000,
  "mb_enabled": true,
  "mb_timeout_ms": 30000,
  "ble_transition_ms": 700,
  "rules_paused": false,
  "mb_mapping_loaded": true,
  "mb_rules_fs_degraded": false,
  "mb_layout_active": 0,
  "mb_layout_name": "Default",
  "mb_layout_count": 1,
  "show_type": "none",
  "show_phase": "none",
  "scan_log": true,
  "sd_rule_log": true,
  "sd_rule_log_path": "/rules_12345.jsonl",
  "sd_rule_log_ring": 40,
  "capture_active": false,
  "preset_count": 12,
  "board_role": "logic_board",
  "scanner_mac": "AA:BB:CC:DD:EE:FF",
  "logic_mac": "11:22:33:44:55:66",
  "scanner_seen": true,
  "scanner_age_ms": 842
}
```

**`override` values:** `0`=NONE · `1`=ZONE · `2`=MANUAL · `3`=SHOW_MODE · `4`=BLE_EFFECT

Priority: BLE Effect > Show Mode > Manual > Zone. MagicBand+ and Starlight Wand share `BLE_EFFECT` (same priority tier); per-rule exclusivity flags arbitrate between them.

When WiFi/WLED is up, `brightness` is refreshed from WLED `/json/si` before status is emitted (avoids cold default `128`).

`scanner_mac`/`scanner_seen`/`scanner_age_ms` reflect the dual-board UART link — `scanner_seen`
is `false` until the first scanner packet/heartbeat is received after boot, and `scanner_age_ms`
is the time since the last one. These fields are meaningful only when `board_role` is
`logic_board`.

`mb_rules_fs_degraded` is sticky in RAM: `true` after any failed persist of `/mb_rules.json`
(including a failed embedded-rules seed), `false` after a later successful save. The live
rule cache may still be running; a reboot can fall back to whatever is actually on SPIFFS
(or the compiled-in embed). The app shows a "reboot risk" warning when this is true.

### MagicBand+ events

```json
{"type":"ble_color","r":255,"g":0,"b":0}
{"type":"ble_event","event":"five_color"}
{"type":"ble_event","event":"flash"}
{"type":"ble_event","event":"animation"}
{"type":"ble_event","event":"timeout"}
```

### Starlight Wand events

```json
{"type":"sw_color","palette":4,"r":0,"g":100,"b":255}
{"type":"sw_event","event":"timeout"}
{"type":"sw_event","event":"disabled"}
{"type":"sw_event","event":"blocked"}
{"type":"sw_event","event":"wifi_down"}
{"type":"sw_debug","reason":"wand_cast","hex":"8301cf0b…","len":15}
```

### Chunked payloads (board → app)

Reassemble by `type` until `"last":true`:

```json
{"type":"preset_chunk","seq":0,"last":false,"data":"[…"}
{"type":"wled_effects","seq":0,"last":false,"data":"[\"Solid\",…"}
```

App `CHUNKED_TYPES` map (`app/src/services/BLEService.ts`):

| Chunk `type` | Assembled as |
|---|---|
| `preset_chunk` | `preset_list_raw` |
| `wled_effects` | `wled_effects_done` |
| `wled_palettes` | `wled_palettes_done` |
| `wled_fxdata` | `wled_fxdata_done` |
| `wled_state` | `wled_state_done` |

`rule_log` is sent by the firmware using the same chunk envelope shape but is **not**
currently in this map on the app side — see the note under "Rule log pull" above.

### Chunked payloads (app → board)

For commands with large JSON bodies, the app can also send `ble_cmd_chunk` envelopes to
the CMD characteristic instead of a single write; the board reassembles them by string
append before dispatching the inner command. See `BlePeripheral.cpp` for the exact
envelope shape if you need to send an oversized command payload.

---

## Not yet implemented

- **Phone clock sync (`set_time`)** — mentioned in project notes as planned (so SD/rule
  logs can be stamped with wall-clock time via a `timeOffsetMs = unixMs - millis()`
  offset), but there is currently no `set_time` command, and no `timeOffsetMs`/`unixMs`
  handling anywhere in `firmware/StrollerController/`. Logged timestamps are `millis()`-based
  only until this lands.

---

## USB serial debug (@ 115200)

| Command | Effect |
|---------|--------|
| `help` | List commands |
| `sniff [sec]` | Log all BLE manufacturer data |
| `sniff off` | Stop sniff |
| `tx on` | Broadcast WAND-IDLE (wand pairing test) |
| `tx off` | Normal advertising |
| `tx cast <0-31>` | WAND-CAST 3 seconds |

---

## GLEDOPTO / WLED setup

1. Connect to GLEDOPTO AP (`StrollerNet` / board config)
2. WLED UI at `4.3.2.1`
3. Logic board joins as WiFi station; POST `/json/state` for LED control
4. Strip: **100 LEDs**, segment 0 should span full logical run (`stop:100`)
5. On connect, board sends `{"on":true,"bri":40}` (GLEDOPTO relay needs `on:true`)

---

## Related

- [WandSimulator README](../WandSimulator/README.md) — transmit test packets
- [docs/pcb-final-build-spec.md](../../docs/pcb-final-build-spec.md) — dual-board UART build spec, pin maps
- [docs/starlight-wand-codes.md](../../docs/starlight-wand-codes.md) — wand testing (being updated separately)
