# 0011 — Below 3 active players the game freezes and resumes

- **Date:** 2026-11-23
- **Status:** accepted; item 3's frozen grace amended by 0025
- **Stage:** 0.8.2

## Decision
Clarifies `SPEC.md` §7's pause rule.

1. **Active** = connected and not removed, and seated in the game — a waiting
   late joiner (not yet in a round roster, 3.2) does not count until seated.
2. The pause starts only after the same short reconnect grace used elsewhere
   (0010), so a reload does not flash a pause screen.
3. **Freeze and resume:** on pause, store the time remaining on every running
   deadline (phase, auto-continue, grace); when active players are back to 3,
   re-arm each from now plus its remaining time. Nothing is cancelled and no
   drawing is lost. The host (or a claimed host, 0010) can still end the game.
4. **Order:** if one event both triggers §7's faker-disconnect cancel and drops
   the game below 3, the cancel applies first, then the pause.
5. Because only disconnected players can be removed (§7), a removal never
   changes the active count by itself.

## Why
The owner accepted the recommendation (2026-11-23): one rule, no lost drawings,
and the pause screen does not flash on reloads.

## Rejected
- Cancel the round on pause: throws away drawings already made.
- Freeze only between rounds: a 2-player round cannot be played fairly.

## Revisit if
Playtests show 3-player games pausing too often.
