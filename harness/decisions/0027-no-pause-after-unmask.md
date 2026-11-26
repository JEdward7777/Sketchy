# 0027 — No pause from unmask on, or on the final results; round numbers never reset

- **Date:** 2026-11-26
- **Status:** accepted (orchestrator default under 0021; the owner may override)
- **Stage:** 3.3.4–3.3.5 (unit 3b review round 1)

## Decision
1. **From unmask through judging the round never pauses** (amends 0011).
   Votes are complete and the faker is public; the guess and judging run on
   their timers, absent judges abstain (0013, 0–0 accepts), an absent faker's
   guess is wrong (0012). A drop below 3 pauses at round results instead,
   where 0023's newcomer rule does not apply (results are between rounds).
   Because no pause can start after unmask, no 0023/0025 restart can scrub a
   round once unmask has begun (votes locked during a pause in browse can
   still be scrubbed by a restart before unmask).
2. **Round results of the game's last round, and final results, never
   pause:** a finished game needs no quorum to show its podium.
3. **`guess:submit` and `guess:judge` while paused** (a pause that began
   before unmask cannot reach the guess, so this is only defensive) are
   refused with `paused`.
4. **Round numbers are room-wide and never reset**, Play again included,
   so a late `wordDealt` or drawing key from a previous game never matches
   the current round.

## Why
1. A pause after unmask either freezes a round with nothing left to decide
   but a guess, or (with a newcomer) scrubs points the votes already earned.
2. §7's pause protects play in progress; there is none on a finished game.
3. Keeps 0011's "freeze" literal for every phase that can be paused.
4. A slow DeckDO answer across `host:end` + Play again was accepted as the
   new game's first word (review finding).

## Rejected
- Keep pausing in guess/judging (literal 0011) — loses earned points under 0023.

## Revisit if
The owner wants a pause to be possible during the guess.
