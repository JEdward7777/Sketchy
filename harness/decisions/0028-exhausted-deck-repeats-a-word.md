# 0028 — When a game has used every word of a difficulty, deal a repeat

- **Date:** 2026-11-26
- **Status:** accepted (orchestrator default under 0021; the owner may override)
- **Stage:** 5.2–5.3

## Decision
1. `DeckDO.deal(difficulty, exclude)` skips excluded words (§6). When
   **every** word of the difficulty is in `exclude`, it does not search
   forever or fail: it deals the next word of its order anyway (advancing
   its position as usual) and answers `{entry, repeat: true}`.
2. The room passes the flag on as `wordDealt {repeat: true}`; the reducer
   then takes the used word for the round instead of asking again, and
   does not add it to `usedWords` a second time. Without the flag, a used
   word is re-dealt as before (§6 "skip it and deal the next one").

## Why
§6 does not cover a game that outlasts a deck. With today's list (80
abstract words) and at most `3 cycles × 10 players = 30` counted rounds a
game it needs many cancelled rounds to get there, but the alternative
behaviours are all worse: an error or a retry leaves the round in
`dealing` until the 2 h expiry (observation O-11 was exactly that with the
stub), and switching difficulty silently changes the host's setting. A
repeated word is a small blemish in a very long game; a stuck game is a
broken one.

## Rejected
- **An `exhausted` answer and a retry with backoff:** the retry can never
  succeed, so the room sits in `dealing` until expiry.
- **Clearing the game's used list:** would allow repeats in every
  difficulty, not only the exhausted one.
- **Dealing from another difficulty:** overrides the host's choice.
- **Repeating the least-recently-used word:** which word that is follows
  from the game's public history (every round's word is public once its
  guess resolves), so players could predict the repeated secret word. The
  next word of the deck's CSPRNG order is not predictable.

## Revisit if
The word list shrinks enough that a normal game can exhaust a difficulty,
or players report repeats.
