# 0012 — Faker disconnects after drawing, reload blips and presence rules

- **Date:** 2026-11-23
- **Status:** accepted; item 4 superseded by 0020
- **Stage:** 0.8.3

## Decision
Clarifies `SPEC.md` §4, §7 and decision 0003.

1. **After drawing the round continues.** A faker who disconnects during the
   slideshow, voting or guess does not cancel the round; their drawing and any
   selected vote stand, and an absent faker at the guess is "no guess = wrong"
   (§4). §7's cancel applies only in briefing and draw.
2. **Blip grace.** A socket close counts as a disconnect only after a short
   reconnect grace (one named constant, shared with 0010 and 0011). Any
   faker-only grace deadline stays out of `projectPublic` (3.6.1).
3. **Generic cancel wording** ("Mission scrubbed"-style) — it does not name the
   faker, though the cancel itself is inherently revealing.
4. **An already-disconnected scheduled faker** is deferred later in the cycle
   without starting the round (same move as §7's cancel, no briefing shown).
5. **Draw early end** waits only for connected roster players (after the
   grace), matching §4's "last connected player locks in".
6. **A faker absent for the whole voting window** still scores by §5 as usual
   (+1 per real player not voting them, +1 to real players who voted for them;
   no guess = wrong). 0003 item 2's "neither side scores" exclusion covers real
   players only. Stage 2.2.2 tests this.

## Why
The owner accepted all recommendations (2026-11-23): the round's evidence
already exists after drawing, and a phone that sleeps for a moment should not
wreck a round.

## Rejected
- Cancel on any faker disconnect, any phase: throws away finished drawings.
- Any socket close counts: reloads would cancel rounds.
- Start-then-cancel for an absent scheduled faker: wastes a briefing and
  announces who the faker would have been.

## Revisit if
Playtests show the grace too short or too long.
