# Rules Engine Reference — Match Conditions & Structure

Companion reference to the per-opcode docs (E9 05, E9 07, E9 09, E9 0C, E9 0D, E9 0E, etc.).
Covers the rules-engine JSON structures those docs' "Building Your Own" sections assume, as
observed in the currently-shipped ruleset. This is a structural/schema reference, not a
protocol reverse-engineering doc — it doesn't belong in any single opcode's page since it's
shared across all of them.

## Match Condition Types

Three condition types are in active use across the shipped rules. All match evaluation
happens against the payload with the `8301 <E1|E2> 00` prefix intact (i.e. offsets in `byte`/
`bits` conditions use the same full-frame indexing as the per-opcode docs), except where a
rule explicitly matches on the shorter opcode-only prefix (see `e9-09_five-color_solid`'s
bare `"E909"` hexPrefix option, which matches captures with the prefix already stripped).

### `hexPrefix`

```json
{ "type": "hexPrefix", "value": "E100E909" }
```

Matches if the packet's hex string starts with `value` (case-insensitive). The near-universal
pattern across every rule is to wrap 2-3 `hexPrefix` conditions in a `"mode": "some"` group,
one per Disney-identifier variant (`E100`, `E200`, and sometimes the bare opcode with no
prefix at all) — since the `E1`/`E2` byte's purpose is still unconfirmed and empirically
doesn't affect behavior, every opcode rule matches all observed variants rather than picking
one.

### `byte`

```json
{ "type": "byte", "offset": 6, "op": "eq", "value": 15, "mask": 255 }
```

Matches a single full-frame byte at `offset` against `value` using operator `op` (`eq`
confirmed in use; other operators not observed in the current ruleset but the schema has an
`op` field, implying more may exist), after applying `mask` (bitwise AND before comparison —
`255`/`0xFF` in every observed use, i.e. no masking is actually applied in practice yet).

This is how the shipped rules distinguish sub-modes within one opcode — e.g. `e9-08_solid_rgb`
vs `e9-08_five-color_solid` are the same opcode (`E908`) split into two rules purely by a
`byte` condition on offset 6 (`0xD2`/210 selects the RGB sub-format, `0x0F`/15 selects the
five-zone-palette sub-format) — this is the concrete implementation of the "d2 55 marker vs
0f marker" split described in the E9 08 findings.

**Hex/decimal trap:** `value` is decimal in this schema. `0x19` (tight-sync pattern selector
in E9 0E) must be entered as `25`, not `19` — entering `19` matches decimal 19 (`0x13`)
instead, silently matching the wrong packets rather than failing to match at all. This exact
mistake is called out in the E9 0E doc's byte-13 section; it's a schema-wide trap, not
opcode-specific.

### `bits`

```json
{ "type": "bits", "offset": 5, "bitStart": 6, "bitCount": 1, "op": "eq", "value": 1 }
```

Matches a sub-byte bit range, same offset/bitStart/bitCount addressing used throughout the
extract system (see below). Used in the shipped ruleset to match the timing byte's individual
scaler (bit 6) or extended-timeout (bit 7) flags independently of the rest of that byte's
value — e.g. `e9-0e_five-color_strobe_slow` matches "scaler bit set OR extended bit set" via
two `bits` conditions wrapped in a `"some"` group, rather than trying to enumerate every full
byte value that has either bit set.

### Combining conditions — `mode: "all"` / `"some"`

Conditions nest arbitrarily via `mode` groups (`"all"` = AND, `"some"` = OR), matching your
project's originally-documented match-group design. The shipped rules consistently follow one
pattern: an outer `"all"` group containing (1) a `"some"` group of `hexPrefix` variants, and
(2) one or more additional `byte`/`bits` conditions (themselves sometimes wrapped in their own
`"some"` group) that narrow down to a specific sub-mode. This is the standard shape to follow
for any new opcode rule with sub-modes — see `e9-0e_five-color_strobe_tight-sync` for a
three-level-deep example (prefix OR-group, AND'd with a value OR-group, AND'd with a single
marker-byte condition).

## Rule Priority and Fallthrough

Rules are evaluated in ascending `priority` order (0, 10, 20, 30... in the shipped set, gapped
by 10 to leave room for insertions); the first matching *enabled* rule wins. Sub-mode-specific
rules for one opcode are consistently given lower priority numbers (i.e. checked first) than
that opcode's catch-all — e.g. all three specific E9 0E pattern rules (priority 60-80) are
checked before the base/catch-all strobe rule (priority 100 in the E9 0D case, which reuses
the E9 0E-style catch-all pattern). When adding a new sub-mode rule for an opcode that already
has a catch-all, give it a lower priority number than the catch-all or it will never be
reached.

## Fan-out Extraction (one color → multiple physical segments)

```json
{
  "name": "col-0",
  "source": "payloadBits",
  "offset": 7, "bitStart": 0, "bitCount": 5,
  "paletteMap": true,
  "targets": [
    { "kind": "segmentColor", "segmentId": "segA", "colorSlot": 0 },
    { "kind": "segmentColor", "segmentId": "segB", "colorSlot": 0 },
    { "kind": "segmentColor", "segmentId": "segC", "colorSlot": 0 },
    { "kind": "segmentColor", "segmentId": "segD", "colorSlot": 0 }
  ]
}
```

One extracted color can drive an arbitrary number of `targets` — this is the shipped
implementation of the "fan-out extract targeting" feature referenced in your project notes.
`e9-0e_five-color_base_strobe` is the clearest example: each of its 5 zone-color extracts fans
out to 4 physical LED segments (20 total), presumably because that build's physical strip
layout has 4 physical clusters per logical zone. Use this pattern whenever one decoded color
needs to apply to more than one physical segment — don't duplicate the extract entry per
segment.

## `fallbackDuration` — Behavior Without a Timing Byte

```json
"fallbackDuration": {
  "enabled": false,
  "onSec": 10,
  "fadeSec": 0,
  "cooldownSec": null
}
```

Present (disabled) on every shipped rule as a standard field, but not yet turned on for any of
them — every currently-implemented opcode has `timing.enabled: true` and a confirmed or
working-assumption timing model, so none of them currently need the fallback path. This is the
field to enable for a genuinely unhandled/undecoded opcode rule, where there's no timing byte
to decode and you just want a fixed on-duration before automatic return to normal. See the
rules-engine fallback-duration spec for the full firmware-side behavior.

## `startTransition` / `stopTransition`

```json
"startTransition": { "type": "fade", "timeMs": 0 },
"stopTransition": {
  "enabled": true,
  "type": "fade",
  "durationMode": "timingFade",
  "timeMs": null
}
```

Every shipped opcode rule uses `stopTransition.durationMode: "timingFade"`, meaning the
stop-transition fade duration is derived from the timing model's own fade-stretch value
(`mbRuleFadeMs`) rather than a fixed `timeMs` — i.e. these two settings are usually kept in
sync with the timing model rather than configured independently. The Starlight Wand and
unhandled-opcode rules are the exception, using `durationMode: "custom"` with a fixed
`timeMs: 400`, since those rules don't have `timing.enabled` at all (no timing byte to derive
a fade duration from).

`type` accepts the full transition-style vocabulary (`fade`, `instant`, `fairyDust`,
`swipeRight`, etc.) — see the transition-styles reference for the complete list. Every shipped
rule currently uses `"fade"`; none exercise the other 23 styles yet.

## Known Issue in the Current Ruleset

`unhandled_op_code` (priority 120, lowest/last-checked) and `starlight-wand` (priority 110)
currently have **identical match conditions** (`CF0B`/`CF9B` hexPrefix, same as each other) —
this looks like a copy-paste leftover rather than an intentional design, since an "unhandled
opcode" catch-all matching the exact same narrow Starlight-Wand-prefix condition as the rule
directly above it means `unhandled_op_code` can never actually fire (Starlight Wand packets
always match the higher-priority `starlight-wand` rule first, and non-Starlight/non-E9
packets never reach either). Worth revisiting what `unhandled_op_code` is supposed to match —
likely a true wildcard/always-matches condition (lowest priority, no specific prefix) so it
functions as a genuine last-resort fallback for any BLE packet that reached the rule engine
without matching anything more specific.
