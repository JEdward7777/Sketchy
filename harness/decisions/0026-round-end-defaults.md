# 0026 — Round-end and game-end defaults from unit 3b

- **Date:** 2026-11-24
- **Status:** accepted (orchestrator default under 0021; the owner may override)
- **Stage:** 3.3.3–3.3.5 (unit 3b)

## Decision
1. **Randomness.** The slideshow order uses its own generator, separate from
   the one that picks the faker and draws the Mixed bag, and the adapter mixes
   fresh secure entropy into both on every step (O-10). Published orders and
   revealed fakers therefore never let a client predict a later faker.
2. **Play again** is the host's continue (`host:next {seq}`) on final
   results, so it is exactly-once like every other continue. It returns to
   the lobby (0014), resets every score to 0, clears the game length, the
   used-word list, the round and the stored drawings.
3. **`host:end`** works in every phase except the lobby and final results,
   paused or not, and lifts the pause. A round not yet scored is dropped: no
   points, and nothing about it is revealed (no faker before unmask, no word).
4. **Removed players at Play again** keep their seat and color and their
   score resets with everyone's (0019 over 0014's "leave the scoreboard").
   Final standings place only non-removed players; waiting late joiners are
   included with 0.
5. **The word** stays out of public state and the faker's view until the
   guess is resolved, through judging, not only until it is submitted. The
   submitted guess text is public.
6. **Beats:** unmask lasts `UNMASK_BEAT_MS` = 5 s; round results
   auto-continue after `RESULTS_BEAT_MS` = 8 s (0004 rule 1).
7. **An absent faker** still gets the full guess timer, so a faker who comes
   back can still guess; no guess by the deadline is wrong (0012 item 1).

## Why
1. A 32-bit generator whose outputs are published is brute-forceable,
   which would restore the deduction 0020 removed.
2. Reusing the continue gives the double-tap protection for free.
3. The host needs a way out from any state, including a pause; ending must
   not leak what the game would have revealed.
4. 0019 (the newer, more specific rule) keeps removed players' seats.
5. Judges decide whether a guess "counts" from the guess, not the word;
   showing the word mid-judging adds nothing and leaks to the faker.
6–7. Short beats match §4's "short fixed beat"; returning players should
   not lose their only chance to score by guessing.

## Rejected
- A dedicated `game:again` intent (needs its own exactly-once guard).
- Deriving the slideshow order from the faker generator.

## Revisit if
Playtests find the beats too short or long, or the owner prefers another
Play again or end-game flow.
