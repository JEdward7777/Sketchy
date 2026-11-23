# 0008 — Skip the ratchet's second-model gate unless Fable is available

- **Date:** 2026-11-22
- **Status:** accepted
- **Stage:** 0.6

## Decision
`pipeline/ratchet.md` step 3 (second-model gate) is **skipped** on this
project unless the session actually has Fable. A phase is ready to commit when
a fresh same-model review round returns `no actionable findings`. Do not
substitute another model for the gate.

## Why
The owner's account has no Fable: a `fable` spawn offered to swap to Opus,
which is the orchestrating model, so the "different model" property is lost.
The owner then ruled: "Don't use Sonnet," and "Just default the second model
level out unless we happen to load this harness in one that does have Fable"
(2026-11-22).

## Rejected
- Sonnet or Haiku as the gate: ruled out by the owner.
- A same-model "gate": adds nothing over another fresh review round.

## Revisit if
The harness is run from an account or tool that has Fable — then run the gate
as `ratchet.md` describes.
