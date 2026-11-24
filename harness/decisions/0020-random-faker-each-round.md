# 0020 — The faker is picked at random every round

- **Date:** 2026-11-23
- **Status:** accepted
- **Stage:** 0.8.11

## Decision
Amends `SPEC.md` §7 (cycles). Supersedes decision 0012 item 4, decision 0014
item 1 and decision 0019 item 2; reinterprets decision 0018.

1. **Random faker.** At the start of every round the faker is picked uniformly
   at random, with the seeded room RNG (2.1), from the round roster's
   connected players. Past rounds have no effect: the same player can be the
   faker twice in a row, and some players may fake more often than others.
   No "evening out" weighting — any weighting leaks information.
2. **Game length.** The cycles setting stays (1–3, default 2 per 0018) but now
   sets a round count: `totalRounds = cycles × roster size at host:start`.
   Late joiners do not change it. The game ends after `totalRounds` completed
   rounds.
3. **Cancelled rounds** (§7 faker disconnect in briefing or draw) award
   nothing and do not count toward `totalRounds`; the next round picks a
   fresh faker. There is no turn to move later.
4. **Late joiners and returning removed players** are seated from the next
   round, not the next cycle.
5. **Secrecy.** There is no hidden schedule; the only hidden pre-unmask facts
   are the word and the faker. `projectPublic` must not expose the RNG state
   (it would predict future fakers).

## Why
The owner raised it (2026-11-23): with "everyone fakes once per cycle", each
unmask rules a player out, so later rounds of a cycle are increasingly
deducible — not just the last one. A fresh random pick makes every round
independent. Owner: "Let's go with fully random." Games in this genre
(Spyfall, A Fake Artist Goes to New York) pick the spy at random for the same
reason.

## Rejected
- Keep per-cycle rotation and accept the deduction (the original 0.8.11
  recommendation).
- Shuffle all cycles together: only moves the problem to the end of the game.
- Weighted random toward players who have faked less: leaks part of the
  deduction back.
- Zero or two fakers sometimes: complicates scoring and the guess step.

## Revisit if
Playtests show the uneven faker counts feel unfair.
