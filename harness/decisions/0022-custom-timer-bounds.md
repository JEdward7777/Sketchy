# 0022 — Bound the Custom timers; the draw maximum is twice Relaxed

- **Date:** 2026-11-23
- **Status:** accepted
- **Stage:** 2.9

## Decision
Clarifies `SPEC.md` §8, whose Custom row says "any". Custom timers are
integer milliseconds within these inclusive bounds (`CUSTOM_TIMER_BOUNDS` in
`src/shared/timers.ts`, checked by `validateCustomTimers`):

| Timer | Min | Max | Max as an expression |
|---|---|---|---|
| Draw | 5 s | 180 s | `2 × Relaxed draw (90 s)` |
| Per slide | 1 s | 10 s | `2 × Relaxed per slide (5 s)` |
| Vote (after slideshow) | 5 s | 180 s | `3 × Relaxed vote (60 s)` |
| Guess (also judging, 0013) | 5 s | 120 s | — |

Every preset lies inside these bounds, so a preset is also a valid Custom set.

## Why
- **Minimums** are short enough for the E2E leg's "short Custom preset"
  (plan phases 8–11) to play a round in seconds, yet long enough that each
  phase is visible: a 1 s slide still shows each card.
- **Draw maximum and chunking (0009 item 4, plan 6.4).** budget.md's stage
  1.7.1 table gives the worst measured rate, the 240 samples/s scribble, as
  `208,864 bytes / 90 s ≈ 2,321 bytes/s`, and the longest such drawing that
  fits one storage value as `floor(8 × 10^6 / (208,864 / 90)) = 3,447 s`. 180 s is far
  inside that, so **stage 6.4 does not need to chunk**. The worst honest
  180 s drawing is `180 × 208,864 / 90 = 417,728 bytes`, and the platform
  safety limit `STROKES_MAX_BYTES = STORAGE_VALUE_LIMIT_BYTES / 2 = 4 × 10^6`
  bytes (`src/shared/stroke-format.ts`) sits about 9.6× above it.
  `test/unit/timers.test.ts` and `test/unit/stroke-codec.test.ts` assert both.
- A tighter draw maximum keeps stage 6.5's per-client delivery bounded too:
  `10 players × 417,728 bytes ≈ 4.2 MB` for a round of worst-case 180 s
  scribbles, against `10 × 208,864 ≈ 2.1 MB` at Relaxed.
- **Per slide**: §8 makes the slideshow `players × 2 × perSlide`, so 10 s
  slides already give `10 × 2 × 10 s = 200 s` with 10 players.
- **Vote** and **guess** maxima give a slow group room to argue (3× Relaxed's
  vote) without letting a round stall for many minutes; the guess timer is
  reused for judging (0013 item 1), so its maximum can apply twice per round.

## Rejected
- Truly unbounded "any": a host typo (draw 6000 s) would hold the room for
  hours and could make honest drawings approach the storage limit.
- Draw maximum near the measured fit (thousands of seconds): technically
  storable, but delivery size grows with it and no party round needs it.
- Minimums of several seconds more: they would slow the E2E game-flow legs.

## Revisit if
Hosts ask for longer drawings, or stage 7.10's re-measurement with the real
codec finds a higher bytes-per-second rate than budget.md's table.
