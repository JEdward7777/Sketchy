# 0003 — Keep the SPEC §5 scoring edge cases as written

- **Date:** 2026-11-22
- **Status:** accepted
- **Stage:** 0.3

## Decision
The four edge cases in `SPEC.md` §5 ("decided by Claude; please review") are
confirmed by the owner unchanged:

1. A real player connected during voting who casts no vote counts as "did not
   vote for the faker" → faker +1.
2. A player disconnected for the **whole** voting phase is excluded from the
   tally — neither side scores from them.
3. "Most votes" tallies every cast vote, including the faker's own.
4. A cancelled round (faker disconnects, §7) awards no points to anyone.

These are the test cases `scoreRound` (stage 7.1) must cover.

## Why
Owner reviewed and said they "sound reasonable" (2026-11-22).

## Rejected
Nothing proposed in its place.

## Revisit if
Playtests show players gaming the no-vote rule (e.g. abstaining to help a
faker) or "disconnected for the whole phase" proving ambiguous for a player who
drops partway through.
