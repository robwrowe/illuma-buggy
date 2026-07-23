# `set_mb_rules` wire format (compact ↔ verbose)

The web Rule Editor and app store keep the **verbose** rule shape (explicit
`mode: "default" | "stored" | "custom"` on every `segmentOverrides` field, full
`extract[].targets[]` keys). Compaction happens **only** at the BLE send
boundary:

| Side | Function |
|------|----------|
| Web | `compactMbPayloadForBle()` in `web/src/lib/ble/mbMapping.js` (via `boardSync.js`) |
| App | `compactMbPayloadForBle()` in `app/src/utils/mbConfig.ts` (via `bleBoardSync.ts`) |
| Firmware | Dual-reads compact **and** verbose in `applySegmentOverridesOntoWled` / extract `dispatchTarget` (`MbRuleEngine.cpp`). Compact form is kept in `gRulesDoc` (no expand-to-verbose pass) so PSRAM savings persist after cache. |

Do **not** compact for editor preview, normalize, or export JSON — those stay verbose.

---

## 1. `segmentOverrides`

### Verbose (editor)

```json
{
  "segabc": {
    "fx": { "mode": "custom", "value": 28 },
    "pal": { "mode": "default" },
    "sx": { "mode": "stored" },
    "ix": { "mode": "stored" },
    "blend": { "mode": "stored" },
    "colors": [
      { "mode": "stored" },
      { "mode": "custom", "value": "#ff0000" },
      { "mode": "stored" }
    ]
  }
}
```

### Compact (wire)

| Verbose mode | Wire encoding |
|--------------|---------------|
| `stored` / `extract` / missing | **Omit** the key (firmware = no-op / leave map value) |
| `default` | Bare sentinel string `"d"` (apply rule effect for that field) |
| `custom` | Bare value (number / blend string / etc.) — no `{mode,value}` wrapper |
| `colors` | Only custom slots: `[{ "i": slotIndex, "v": "#rrggbb" }, ...]` |

```json
{
  "segabc": {
    "fx": 28,
    "pal": "d",
    "colors": [{ "i": 1, "v": "#ff0000" }]
  }
}
```

**Important:** `default` is **not** a no-op. Omitting it would change behavior
(stored = leave segment map alone; default = copy rule `fx`/`pal`/`sx`/`ix`).

---

## 2. `extract[].targets[]`

### Verbose

```json
{ "kind": "segmentColor", "segmentId": "segqq2wflj", "colorSlot": 1 }
{ "kind": "maskColor", "mask": "all" }
```

### Compact

| Kind | Wire |
|------|------|
| `segmentColor` | `{ "s": "<segmentId>", "c": <colorSlot> }` — `kind` omitted (firmware defaults to `segmentColor`). Multi-seg: `"ss": ["id1","id2"]` instead of `s`. |
| `maskColor` | `{ "k": "maskColor", "m": "all" }` |
| `ignore` | Dropped from wire |
| Other / future | Pass through verbose object |

Tuple encoding (`["segId", slot]`) is **not** used yet — defer until measured need.

---

## 3. Match conditions (`type` / `op`)

Not compacted in this pass. Revisit only if payload still presses the 128KB budget.

---

## 4. Measured impact (2026-07-23 export)

Config: 19 rules / 9 segment maps (`illuma-buggy-export-2026-07-23 (6).json`).

| Metric | Verbose | Compact | Δ |
|--------|---------|---------|---|
| Total mapping blob | 67,383 B | 50,120 B | **−17,263 (−25.6%)** |
| `rules[]` | 49,619 B | 32,356 B | −17,263 |
| `segmentOverrides` (sum) | 17,576 B | 4,481 B | −13,095 |
| `extract[]` (sum) | 14,819 B | 10,791 B | −4,028 |
| No-op leaf objects (`default`/`stored` only) | 597 | 0 mode wrappers | — |

`extract` target `kind` in this config: only `segmentColor` (safe to omit on wire).

After this change, re-calibrate `ARDUINOJSON_OVERHEAD_FACTOR` in
`estimateMbPayloadFootprint()` against live board PSRAM deltas — compact trees
have fewer string keys, so the provisional 1.55 factor may drift.
