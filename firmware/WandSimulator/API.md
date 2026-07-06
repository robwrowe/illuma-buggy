# WandSimulator API

Reference for anything that talks to a flashed WandSimulator board over the
network or Serial — the web tool, a script, or an AI coding agent wiring up a
new client. This is the contract; treat it as stable even while the web tool
is being rebuilt around it.

## Connecting

1. Flash `WandSimulator.ino`, open Serial @ 115200.
2. Run `wifi <ssid> <password>` (see [Serial commands](#serial-commands)).
   The board prints its IP once connected:
   ```
   [WandSim] WiFi connected: 192.168.1.42
   [WandSim] HTTP server on :80 (/status, /send, /show, /stop)
   ```
3. Talk to `http://<that-ip>/...`. There's no mDNS name — discover the IP via
   Serial, or have your client scan/ask the user for it (this is what the web
   tool's "Simulator IP" field is for).

Things to design around, not workarounds to fix:

- **No credential persistence.** WiFi is intentionally not saved across power
  cycles — re-run `wifi <ssid> <password>` after every reboot. Don't build a
  client that assumes the IP is stable across sessions.
- **No auth, wide-open CORS** (`Access-Control-Allow-Origin: *` on every
  response). This is a LAN bench tool, not something to expose past your
  router.
- **Single board, single client at a time in practice.** There's no request
  queueing beyond what's documented below — two clients hitting `/send` at
  once will race for the radio.

## The one thing to get right: company ID byte handling

Every BLE manufacturer-data payload for this protocol starts with a 2-byte
company ID, `83 01`. Different parts of this API expect hex **with** or
**without** those two bytes, and mixing them up is the most likely bug:

| Where the hex comes from | Company ID included? |
|---|---|
| `POST /send` `{"hex": "..."}` | **No** — firmware prepends `8301` for you |
| `POST /show` step lines | **Yes** — send the exact bytes, firmware broadcasts them as-is |
| Serial `raw <hex>` | **Yes** — same as `/show`, exact bytes |
| A capture file's `hex` column (from the phone app / `bleCapture.ts`) | **Yes** — it's what was seen over the air, prefix included |

Rule of thumb: if the hex came from a **capture** (real advertisement bytes),
it already has the prefix — send it via `/show` or `raw`, not `/send hex`.
If you're hand-building a payload from the packet builders in this file
(`mb`, `cast`, etc.) and sending it as hex, that's the payload only — use
`/send hex` and let the firmware add the prefix.

## HTTP endpoints

Base URL: `http://<board-ip>` (port 80). All responses are `application/json`
except where noted. All endpoints send CORS headers and answer `OPTIONS`.

### `GET /status`

```json
{
  "ok": true,
  "device": "WandSim",
  "wifi": true,
  "ip": "192.168.1.42",
  "showActive": false,
  "showStep": 0,
  "showTotal": 0
}
```

`showActive`/`showStep`/`showTotal` reflect an in-progress `/show` playback
(see below) — poll this while a show is running to drive a progress bar.

### `POST /send`

Body is JSON, exactly one of:

```json
{"line": "mb red"}
```
```json
{"hex": "e100e9050009 0e75b0"}
```

- `line` — runs the string through the same parser as Serial input. Anything
  in [Serial commands](#serial-commands) works here.
- `hex` — spaces optional, whitespace-tolerant. This is the **payload only**
  (no company ID — see table above). Firmware wraps it in `8301` and
  broadcasts it.

Response: `{"ok":true}` for `line`, `{"ok":true,"bytes":N}` for `hex`.
`{"ok":false}` on a missing/empty body or unparseable hex (400).

**This call blocks for the duration of the broadcast — typically ~4 seconds**
(the firmware holds the BLE advertisement live for that long before
responding, matching how MagicBand+/wands actually pick up packets). Give
your HTTP client a timeout comfortably above that, and don't treat a slow
response as an error.

### `POST /show`

Batch/sequence playback — the way to replay an entire captured parade or
fireworks show. Body is **plain text, not JSON**, one step per line:

```
1200 8301e200e90900650fbbb5a4a4b5ba
340 8301e200e90900650fbbb5a4a4b5ba
5100 83010f1101f078119e4d6a650397c49a6438608a92
```

Each line is `<holdMs> <hex>`:
- `holdMs` — how long to hold that advertisement live before moving to the
  next step (integer milliseconds).
- `hex` — the **full** manufacturer-data bytes, company ID included (straight
  from a capture file's `hex` column — don't strip or re-add anything).

Blank lines are skipped; a line with no space or unparseable hex is dropped
silently rather than aborting the whole show — check `steps` in the response
against how many lines you sent if you need to confirm nothing was dropped.

Response: `{"ok":true,"steps":N}` (200) or `{"ok":false,"error":"no steps"}`
(400) if nothing parsed.

**This call returns immediately** — playback happens asynchronously in the
firmware's main loop. Poll `GET /status` (`showActive`/`showStep`/`showTotal`)
to track progress, and call `POST /stop` to cancel early. Starting a new
`/show` while one is active replaces the queue.

Practical notes for building the request body from a capture file:
- Capture rows appear twice per real packet (duplicate BLE channels) —
  dedupe consecutive identical `hex` values before building steps.
- Derive `holdMs` from consecutive **distinct** rows' `ts_ms` delta. Give the
  last step a sensible fallback (e.g. 3000ms) since there's no "next" row to
  diff against.
- There's no hard step-count limit enforced beyond available RAM; very long
  shows (thousands of steps) are fine but do increase the POST body size —
  chunking or a smaller time-range slice is a client-side choice, not
  something the firmware requires.

### `POST /stop`

No body needed. Cancels any active `/show` playback or Serial loop mode
(`mbsweep`, `mbloop`, `loop`, `swfxloop`) and stops the current advertisement.
Response: `{"ok":true}`.

## Serial commands

Everything below also works via `POST /send {"line": "..."}`. This is the
full command surface as of this version:

| Command | Effect |
|---|---|
| `cast <color>` | CF0B wand-to-wand color cast |
| `legacy <color>` | CF9B wiki-format color cast |
| `idle` | 0F11 idle beacon |
| `loop <color>` | repeat wand cast every 5s |
| `sw list` | list named animation presets |
| `sw solid <color>` | E905 solid (wands hear MB codes) |
| `sw pattern <mode> <color>` | E909 — mode: `solid`\|`spin`\|`all`\|`corners`\|`middle` |
| `sw fx <name>` | park animation preset (`rainbow`, `flash`, `sparkle`, `pulse`, `circle`, `fade`, `fade2`, `blink`, `palette5`) |
| `sw combo <color> <fx>` | CF0B cast then animation |
| `swfxloop` | cycle all `sw fx` presets every 4s |
| `mb <0-31\|name>` | E905 single color, all LEDs |
| `mb <pal> mask <0-255>` | E905 LED bitmask (bit N = band N, 0 = all) |
| `mb dual <in> <out>` | E906 inner + outer ring colors |
| `mb rgb <r> <g> <b>` | E908 raw 6-bit RGB (0–63 each) |
| `mb five <tl> <bl> <br> <tr> <c>` | E909 corners (TopLeft, BottomLeft, BottomRight, TopRight, Center) |
| `mb rainbow` | E909 preset rainbow corners |
| `ping` | CC03000000 wake ping |
| `raw <hex>` | broadcast exact bytes as-is, company ID included — same rules as `/show` |
| `mbsweep` | cycle palettes 0–31 every 3s |
| `mbloop <0-31\|name>` | repeat one MB color every 3s |
| `stop` | cancel any loop / sweep / show and stop the current advert |
| `test <segment>` | white-highlight one mapped region — `all`\|`inner`\|`outer`\|`five`\|`topLeft`\|`topRight`\|`bottomLeft`\|`bottomRight`\|`center`\|`band0`..`band7` |
| `wifi <ssid> <password>` | connect + start the HTTP server (quoted SSID/password OK) |
| `wifi off` | disconnect WiFi / stop HTTP server |
| `help` | print this list |

Palette names: `0`–`31`, or hyphenated MB palette names (`red`,
`midnight-blue`, `yellow-orange`, `lime-green`, `pink-3`, etc.); short
aliases `cyan purple blue pink yellow lime orange red green white` also work.
`off` (29) and `unique`/`random` (30/31) are reserved — not real colors.

## Notes for agents wiring up a new client

- Treat `/send` and `/show` as the only two ways to get bytes on air; `/show`
  is the one to reach for whenever you have more than one packet queued —
  don't loop `/send` calls yourself, since each one blocks ~4s and you'll
  fight the radio's own hold/release timing doing it manually.
- There's no way to read back "what's currently advertising" beyond
  `/status`'s show-progress fields — if you need to confirm a single `/send`
  actually went out, the ~4s blocking response *is* your confirmation.
- If a capture file only has a handful of distinct packets repeated over a
  long capture window (typical for MB+ idle beacons), don't naively replay
  every row — dedupe first or you'll send a "show" that's mostly the same
  packet with padding.
