# 0031 — The stroke safety limit is 1 MB, set by memory, not storage

- **Date:** 2026-11-27
- **Status:** accepted (orchestrator default under 0021; the owner may override)
- **Stage:** 6.4 (phase 6 review round 1)

## Decision
`STROKES_MAX_BYTES` is 1,000,000 bytes (it was half the 8 MB storage value
limit). It is still only the 0009 item 4 platform safety limit — no gameplay
cap — and a submission above it is refused whole, never truncated.

## Why
0009 item 4 ties the guard to platform limits; the Durable Object's 128 MB
memory limit binds first. Taking in a 4 MB submission peaked at ~100–120 MB
of heap, and delivering ten of them held ~80 MB more. The honest worst case
is about 418 KB (budget.md's 2,321 B/s × 0022's 180 s Custom maximum), so
1 MB keeps a 2.4× margin there and ~4.8× at the longest preset.

## Rejected
- Keep 4 MB and only slim the codec: the delivery fan-out and a `hello`
  replay still scale with the limit.

## Revisit if
Playtests show honest drawings near the limit; then chunk (0009 item 4).
