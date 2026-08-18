---
id: F-YYYY-MM-DD-NN
field: <field-file-slug, e.g. style-flags>
date: YYYY-MM-DD
status: Unconfirmed | Working Theory | Confirmed | Superseded
confidence: Low | Medium | Medium-High | High
supersedes: null
superseded_by: null
---

# Finding F-YYYY-MM-DD-NN: <Short Title>

**Field:** [<field-name>.md](../fields/<field-name>.md)
**Date:** YYYY-MM-DD
**Status:** <Unconfirmed | Working Theory | Confirmed | Superseded>

## Hypothesis

<What is claimed. State the byte/bit position anchor-relatively, and what it's believed to
control.>

## Evidence

<Table or list of the samples that support this. Include raw hex, the specific byte/bit
extracted, and the observed label/behavior. This section is a record of what was seen — it does
not change after the finding is filed, even if a later finding supersedes the conclusion.>

| Sample | Byte value | Binary | Bit <N> | Label |
|---|---|---|---|---|
| | | | | |

## Test

<Description of any controlled test run (isolate one variable, hold everything else constant).
If no controlled test has been run yet, say so explicitly — "Not yet run" — and evidence is
field-sample-only. Do not blur this distinction; field samples and controlled tests carry
different weight and the confidence level below should reflect which kind of evidence exists.>

## Suggested Test (to raise confidence)

<If confidence is below High, describe the specific next test that would raise it — concrete
enough to execute (which byte, what value, what to hold constant, what tool — e.g.
WandSimulator POST /send — and what result would confirm/disconfirm the hypothesis).>

## Result

<Outcome of the suggested test, once run. "Pending" until then.>

## Confidence

**<Low | Medium | Medium-High | High>** — <justification: sample count, counterexamples (or
lack thereof), whether isolated via controlled test vs. field-sample-only.>

## Supersedes / Superseded By

<Links to prior/later findings this one revises or is revised by, or "—" if none.>
