# StrollerController — BLE Protocol

Connect via BLE to **`IllumaBuggy`**

| Role | UUID |
|------|------|
| Service | `12345678-1234-1234-1234-123456789abc` |
| CMD (write) | `12345678-1234-1234-1234-123456789abd` |
| NOTIFY | `12345678-1234-1234-1234-123456789abe` |

App writes JSON to CMD. Board notifies JSON on NOTIFY. Large responses are chunked (`seq`, `last`, `data`).

Disney BLE packet reference: [docs/disney-ble-protocol.md](../../docs/disney-ble-protocol.md)

---

## App → board

### Presets & WLED

```json
{"type":"preset_save","id":"fantasy","name":"Fantasyland","wled":{"on":true,"bri":200,"seg":[{"fx":0}]}}
{"type":"preset_apply","id":"fantasy"}
{"type":"preset_delete","id":"fantasy"}
{"type":"preset_list"}
{"type":"wled_raw","wled":{"on":true,"bri":255,"seg":[{"fx":42}]}}
{"type":"wled_get_effects"}
{"type":"wled_get_palettes"}
{"type":"wled_get_fxdata"}
{"type":"wled_get_state"}
{"type":"brightness","value":180}
```

### Zones & overrides

```json
{"type":"zone_trigger","preset_id":"fantasy"}
{"type":"override_clear"}
{"type":"override_mode","kill_on_zone":true}
```

### Starlight Wand & MagicBand+

```json
{"type":"sw_config","enabled":true,"timeout_ms":30000}
{"type":"mb_config","enabled":true,"five_point":true,"timeout_ms":30000}
{"type":"mb_chase_config","speed":128,"thickness":4}
{"type":"scan_log_config","enabled":true}
```

| Field | Notes |
|-------|-------|
| `timeout_ms` | `0` = never auto-clear BLE override |
| `mb_chase_config.speed` | WLED Chase `sx` (0 = stationary) |
| `mb_chase_config.thickness` | WLED Chase `grp` (pixels per color block) |

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

### Status

```json
{
  "type":"status",
  "override":0,
  "kill_on_zone":false,
  "brightness":180,
  "preset":"fantasy",
  "wifi":true,
  "sw_enabled":true,
  "sw_timeout_ms":30000,
  "mb_enabled":true,
  "mb_five_point":true,
  "mb_timeout_ms":30000,
  "mb_chase_speed":128,
  "mb_chase_thickness":4,
  "scan_log":true
}
```

**`override` values:** `0`=NONE · `1`=ZONE · `2`=MANUAL · `3`=BLE_MAGIC · `4`=BLE_STARLIGHT

Priority: Starlight Wand > MagicBand+ > Manual > Zone.

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

### Chunked payloads

Reassemble by `type` until `"last":true`:

```json
{"type":"preset_chunk","seq":0,"last":false,"data":"[…"}
{"type":"wled_effects","seq":0,"last":false,"data":"[\"Solid\",…"}
```

App maps: `preset_chunk`→`preset_list_raw`, `wled_effects`→`wled_effects_done`, etc.

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
| `chase speed <0-255>` | MB chase speed (persisted NVS) |
| `chase thick <1-50>` | MB chase thickness (persisted NVS) |

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
- [docs/starlight-wand-codes.md](../../docs/starlight-wand-codes.md) — wand testing
