# 0014 — Final-cycle late joiners wait; Play again returns to the lobby

- **Date:** 2026-11-23
- **Status:** accepted; item 1 superseded by 0020
- **Stage:** 0.8.5

## Decision
Clarifies `SPEC.md` §4 (Play again) and §7 (late joiners).

1. A late joiner who arrives during the final cycle waits (public state only,
   no `private` round view) until Play again. No extra cycle is added.
2. **Play again** returns to the lobby with every non-removed player, waiting
   late joiners included; scores reset; settings are editable by the host;
   starting builds a fresh schedule with the current cycles setting. Removed
   players leave the scoreboard.

## Why
The owner accepted the recommendation (2026-11-23): an extra cycle would change
the game length everyone agreed to, and the lobby is the natural place to
adjust settings between games.

## Rejected
- An extra cycle for a final-cycle late joiner.
- Play again straight into a new game with unchanged settings.

## Revisit if
Late joiners in playtests feel left out for too long.
