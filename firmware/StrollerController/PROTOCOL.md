# StrollerController v2.0 — BLE Protocol
#
# Connect via BLE to "IllumaBuggy"
# Service UUID:      12345678-1234-1234-1234-123456789abc
# Command char UUID: 12345678-1234-1234-1234-123456789abd  (WRITE)
# Notify char UUID:  12345678-1234-1234-1234-123456789abe  (NOTIFY)
#
# App writes JSON to CMD char. Board notifies responses on NOTIFY char.
# All messages are JSON strings.

# ─────────────────────────────────────────────
# APP → BOARD (write to CMD characteristic)
# ─────────────────────────────────────────────

## Save a preset
{"type":"preset_save","id":"fantasy","name":"Fantasyland","wled":{"on":true,"bri":200,"seg":[{"fx":0,"col":[[255,100,200]]}]}}

## Apply a preset (manual override)
{"type":"preset_apply","id":"fantasy"}

## Delete a preset
{"type":"preset_delete","id":"fantasy"}

## List all presets (response comes back in chunks)
{"type":"preset_list"}

## Zone trigger (app evaluated zone, board applies if override allows)
{"type":"zone_trigger","preset_id":"fantasy"}

## Clear override (resume zone control)
{"type":"override_clear"}

## Set override mode
{"type":"override_mode","kill_on_zone":true}   // zone entry kills override
{"type":"override_mode","kill_on_zone":false}  // override persists until manual clear

## Set brightness (0-255)
{"type":"brightness","value":180}

## Raw WLED passthrough
{"type":"wled_raw","wled":{"on":true,"bri":255,"seg":[{"fx":42}]}}

## Get status
{"type":"status"}

# ─────────────────────────────────────────────
# BOARD → APP (notifications on NOTIFY characteristic)
# ─────────────────────────────────────────────

## Ack
{"type":"ack","action":"preset_apply","id":"fantasy","ok":true}

## Preset list (chunked — reassemble until last=true)
{"type":"preset_chunk","last":false,"data":[...]}
{"type":"preset_chunk","last":true,"data":[...]}

## Status
{"type":"status","override":0,"kill_on_zone":false,"brightness":180,"preset":"fantasy","wifi":true}
# override: 0=NONE 1=ZONE 2=MANUAL 3=BLE_MAGIC 4=BLE_STARLIGHT

## MagicBand+ color event
{"type":"ble_color","r":204,"g":0,"b":255}

## Starlight Wand color event
{"type":"sw_color","palette":4,"r":0,"g":100,"b":255}

## MagicBand+ generic events
{"type":"ble_event","event":"fireworks"}
{"type":"ble_event","event":"flash"}
{"type":"ble_event","event":"vibrate"}
{"type":"ble_event","event":"animation"}

## Starlight Wand events
{"type":"sw_event","event":"timeout"}

# ─────────────────────────────────────────────
# GLEDOPTO SETUP
# ─────────────────────────────────────────────
# 1. Connect to GLEDOPTO's own AP (WLED-AP / wled1234)
# 2. Go to 4.3.2.1 in browser
# 3. Config → WiFi Setup
# 4. Leave SSID as-is (WLED runs its own AP by default)
# 5. Logic board connects to it as a station
# 6. WLED IP on its own AP is always 4.3.2.1
