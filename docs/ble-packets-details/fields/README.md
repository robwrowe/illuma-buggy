# BLE Packet Fields — Index

Field-based reference for Disney MagicBand+ / Starlight Wand BLE packet structure. Supersedes
the opcode-centric model in `../op-codes/` (kept as-is for now — see migration note below).

**Core model change (2026-08):** the E9 sub-opcode byte is a **length byte**
(`payload_length = sub_opcode + 2`), not a behavior-category selector. Packet structure is
better understood as a set of independent fields — mask+color, timing, vibration, style/behavior
flags — addressed anchor-relative to markers (`0F`, `5B F0`, etc.) rather than fixed offsets tied
to a specific opcode. See [`length-byte.md`](./length-byte.md) for the retirement note on the old
opcode theory.

## How to Use This Folder

- **Field files** (this folder) are living references — always reflect current best
  understanding, and get edited in place as understanding improves.
- **[`../findings/`](../findings/)** holds the lab-notebook trail — one immutable, dated entry
  per discovery. A field file's "Findings" section links to the specific findings that
  established its current model. Once a finding's status is `Confirmed` or `Superseded`, its
  content doesn't change — corrections happen via a new finding that supersedes it.
- Every field file follows [`_field-template.md`](./_field-template.md) (structure only, not
  meant to be read as a field itself — create this template file per the spec below).

## Fields

| Field | Status | File |
|---|---|---|
| Length byte (opcode theory retirement) | Confirmed | [`length-byte.md`](./length-byte.md) |
| Timing byte | Not yet migrated | [`timing-byte.md`](./timing-byte.md) |
| Mask + color | Not yet migrated | [`mask-color.md`](./mask-color.md) |
| Vibration byte | Unconfirmed | [`vibration-byte.md`](./vibration-byte.md) |
| Style flags | Working theory | [`style-flags.md`](./style-flags.md) |

## Migration Note

The `../op-codes/E904.md`–`E914.md` docs are left as-is for now — they remain the raw-sample
library and contain useful field observations even though their opcode-as-category framing is
retired. Content migrates into this folder gradually, field by field, as each field's model
firms up enough to be worth consolidating. Do not delete or restructure the `op-codes/` docs as
part of this migration unless a separate spec says so.
