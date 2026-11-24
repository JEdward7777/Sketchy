# 0015 — Any roster player but yourself is a vote target; a faker no-vote earns nothing

- **Date:** 2026-11-23
- **Status:** accepted
- **Stage:** 0.8.6

## Decision
Clarifies `SPEC.md` §4–§5.

1. A valid vote target is any roster player (3.2) other than the voter,
   connected or not. (Whether a player removed before the slideshow stays a
   target is settled in 0.8.10.)
2. A vote for a player who disconnects or is removed later in the round still
   counts.
3. A faker who casts no vote earns no framing bonus (§5).

## Why
The owner accepted the recommendation (2026-11-23): under 0012 a faker can drop
after drawing and must still be catchable.

## Rejected
- Only connected players as targets: lets a faker escape by disconnecting.

## Revisit if
—
