# 0017 — Pressing the briefing envelope is not a host hold

- **Date:** 2026-11-23
- **Status:** accepted
- **Stage:** 0.8.8

## Decision
Narrows decision 0004 rule 3 for the briefing: the host's press-and-hold on
the briefing envelope (§4) does **not** send `host:hold`. Every other tap on
the host's screen other than Continue still holds, as 0004 says.

## Why
The owner accepted the recommendation (2026-11-23). Otherwise a host who reads
the word always pushes the deadline out, and the briefing is never the ~8 s
beat §4 describes.

## Rejected
- Literal 0004: envelope presses hold.

## Revisit if
—
