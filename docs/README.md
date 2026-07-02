# Illuma Buggy — Protocol & Reference Docs

| Document | Purpose |
|----------|---------|
| [disney-ble-protocol.md](./disney-ble-protocol.md) | **Canonical reference** — Disney `0x0183` BLE packets, palette table, E9 commands, Illuma firmware behavior |
| [e9-parser-and-effect-mapping.md](./e9-parser-and-effect-mapping.md) | E9 parser tiers, effect-class mapping, app-side WLED routing |
| [starlight-wand-codes.md](./starlight-wand-codes.md) | Starlight Bubble Wand packets, effects, testing |
| [magic-band-bluetooth-codes.md](./magic-band-bluetooth-codes.md) | Archived [emcot.world](https://emcot.world/Disney_MagicBand%2B_Bluetooth_Codes) community wiki (detailed byte breakdowns) |

## External references

- [Adafruit BLE Beacon NeoPixels guide](https://learn.adafruit.com/ble-beacon-neopixels) — tutorial
- [Adafruit `CLUE_BLE_Beacon_Remote`](https://github.com/adafruit/Adafruit_Learning_System_Guides/tree/main/CLUE_BLE_Beacon_Remote) — `magicband_protocol.py`, `command_library.py` (packet builders we port)
- [emcot MagicBand+ codes](https://emcot.world/Disney_MagicBand%2B_Bluetooth_Codes) — original reverse-engineering wiki

## Firmware docs

- [firmware/StrollerController/PROTOCOL.md](../firmware/StrollerController/PROTOCOL.md) — app ↔ board JSON over BLE
- [firmware/WandSimulator/README.md](../firmware/WandSimulator/README.md) — bench broadcaster serial commands
