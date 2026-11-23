# Phase 2 — Pure leaves

The small pure functions in `src/shared` that the core reducer (phase 3) is
built from. No Workers runtime, no I/O: every function takes time and
randomness as arguments, so tests run with fake time and a seeded RNG.
Scoring lands here first because harness/AGENTS.md §5 requires it to be pure
and tested against every §5 edge case (decision 0003 refers to it as stage
7.1 of the earlier draft tree; it is `2.2` now).

- `2` todo: Pure leaves
  - `2.1` todo: Seeded RNG and shuffle helper used by every random choice below
      The RNG's state is plain serializable data, so it can live in the
      reducer state (3.2) and survive hibernation.
  - `2.2` todo: `scoreRound` — the §5 table, over the round roster only (3.2)
    - `2.2.1` todo: Tests per §5 row: real player +1 for voting the faker; faker +1 per real player not voting them; +2 correct guess; +1 framing when the faker's target has the most votes, ties counting
    - `2.2.2` todo: Tests per decision 0003: connected no-vote → faker +1; disconnected for the whole voting window → excluded; "most votes" includes the faker's vote; cancelled round → zero for all
        "Whole voting window" is defined in decision 0007.
    - `2.2.3` todo: Tests for the owner's answer to 0.8.6 (faker no-vote, votes for disconnected players)
  - `2.3` todo: Guess normalization and matching (§4): lowercase, trim, collapse whitespace, strip punctuation, plural tolerance, `alt` list
      Tests from §4's own examples (`sock`/`socks`, `box`/`boxes`,
      `berry`/`berries`) plus `alt` entries taken from `data/words.json`.
  - `2.4` todo: `slideIndex(now, start, perSlide, n)` → card and pass, and the slideshow end `start + n × 2 × perSlide` (§8, §14)
      `n` counts every card including "went dark" cards (decision 0007).
  - `2.5` todo: Clock-offset estimate from `ping`/`pong` samples, preferring the lowest round-trip sample (§14)
  - `2.6` todo: Room-code generation: 4 letters, confusable letters excluded (§14)
  - `2.7` todo: Cycle and faker schedule (§7)
    - `2.7.1` todo: Build a cycle: every active player is faker exactly once, in a secret random order
    - `2.7.2` todo: A cancelled faker turn moves later in the cycle (and a not-started turn per 0.8.3); dropped if that player is not back by the end of the cycle
    - `2.7.3` todo: Removing a player drops their remaining turns
    - `2.7.4` todo: Late joiners enter at the start of the next cycle; behaviour with no next cycle per 0.8.5
    - `2.7.5` todo: Cycles setting 1–3; the game ends when the schedule is exhausted
  - `2.8` todo: Mixed-difficulty bag and shared final placement (decision 0007)
  - `2.9` todo: Timer presets from the §8 table, and Custom validation; the Custom bounds (§8 says "any") are recorded in a decision, and a Custom draw maximum above the draw time 1.7.1 found to fit means 6.4 must chunk (0009)
  - `2.10` todo: Stroke codec and validator (decision 0009, amends §9)
      Strokes: palette color, brush size, integer points on the fixed 4:3
      logical grid; eraser = background color. No cap on strokes or points;
      only the platform safety limit from 1.7.
    - `2.10.1` todo: Tests: encode/decode round-trip; rejects unknown colors, unknown sizes, out-of-range or non-integer coordinates, malformed lists
    - `2.10.2` todo: Optional point simplification that drops only points within half a grid unit of the simplified polyline; tests assert that tolerance on recorded and synthetic strokes
  - `2.11` todo: Shared pure stroke renderer used by every client and the big screen (0009), written against a minimal drawing-context interface declared in `src/shared` (no DOM types)
    - `2.11.1` todo: Tests: the sequence of context calls recorded by a fake context is deterministic for a given stroke list and target size; undo and clear reflected exactly

**Verification.** Unit leg only (`reference/verification.md`): vitest over
`src/shared` with fake time and the seeded RNG from 2.1. Each function's test
file cites the SPEC section or decision it encodes. No DO or browser leg.
