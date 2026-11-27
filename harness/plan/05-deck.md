# Phase 5 — Deck

The singleton `DeckDO` (§6, §13): one seeded shuffle and position per
difficulty, shared by every game, reading `data/words.json`. The room asks
for the next word, skipping any already used in its current game; Mixed
difficulty uses the bag from decision 0007.

- `5` done: Global deck
  - `5.1` done: `DeckDO` singleton addressed by a fixed name; SQLite rows per difficulty hold the stored CSPRNG order and position (§6, decision 0029)
  - `5.2` done: `deal(difficulty, exclude)`: next word in order, skipping excluded words; reshuffle with a fresh CSPRNG order on exhaustion (§6, decision 0029)
  - `5.3` done: The deal-word effect carries the used-words list held in state (3.2) as `exclude`; `RoomDO` passes it to `deal` and feeds the result to `reduce` as an adapter input (§6)
  - `5.4` done: Mixed difficulty: `reduce` draws the round's difficulty from the bag in state (2.8, 3.2) and emits it in the deal-word effect; the adapter deals from that deck (0007)
  - `5.5` done: `data/words.json` check: words unique across the file, every entry has a category, every difficulty is non-empty
      Counts are read from the file, not hard-coded.

Built 2026-11-26: `DeckDO` (`src/worker/deck-do.ts`) over the pure
`src/shared/deck.ts` (`parseWordList`, `shuffledOrder`, `drawNext`); each
shuffle draws every swap from the CSPRNG and is stored in SQLite (review:
a seeded order could be brute-forced from a few seen words); every word
excluded deals a flagged repeat (decision 0028). Tests:
`test/unit/deck.test.ts`, `test/do/deck.test.ts`, and the 5.4 and 0028
cases in `test/unit/core/round.test.ts`. `5` stays active for review.

**Verification.** DO leg: a scripted random source deals a reproducible
order (production orders are CSPRNG shuffles stored in SQLite, decision
0029 amending §6's "seeded shuffle"); a deck
deals every word once before reshuffling; two rooms dealing in turn never
receive the same word within one shuffle; an excluded word is skipped. Unit
leg: the words.json check and the Mixed bag.
