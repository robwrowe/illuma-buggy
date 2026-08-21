# Field: <Field Name>

## Status

<One of: Not yet migrated | Unconfirmed | Working Theory | Confirmed>

## Current Model

<The current best understanding, written as fact as of today — bit diagram, table, or prose as
appropriate. This section gets edited in place as understanding improves; it is NOT a lab
notebook, it's the up-to-date summary. Use the same ASCII bit-diagram style as the project's
existing timing-byte.md where applicable:>

```text
0000 00 0 0b
││││ ││ │ │
││││ ││ │ └─ Bit    [7] - <name>
││││ ││ │
││││ ││ └─── Bit    [6] - <name>
││││ ││
││││ └┴───── Bits [5-4] - <name>
││││
└┴┴┴──────── Bits [3-0] - <name>
```

## Position

- **Anchor-relative (primary):** <e.g. "N bytes after the first `0F` marker byte">
- **Absolute offset table (cross-check only — do not treat as authoritative; anchor-relative is
  the source of truth):**

  | Payload length | Absolute offset |
  |---|---|
  | <N> | <offset> |

## Findings

<Bullet list linking to every finding in ../findings/ that established or revised this field's
current model. Newest/most-recent-revision first.>

- [F-YYYY-MM-DD-NN](../findings/F-YYYY-MM-DD-NN-slug.md) — <one-line summary> — **Confidence:
  <level>**

## Open Questions

<Bullet list of what's not yet confirmed about this field. Each open question is a candidate for
a future finding.>

- <question>
