# Phase 5 — Deck

The singleton `DeckDO` (§6, §13): one seeded shuffle and position per
difficulty, shared by every game, reading `data/words.json`. The room asks
for the next word, skipping any already used in its current game; Mixed
difficulty uses the bag from decision 0007.

- `5` todo: Global deck
  - `5.1` todo: `DeckDO` singleton addressed by a fixed name; SQLite rows per difficulty hold seed and position (§6)
  - `5.2` todo: `deal(difficulty, exclude)`: next word in order, skipping excluded words; reshuffle with a new seed on exhaustion (§6)
  - `5.3` todo: The deal-word effect carries the used-words list held in state (3.2) as `exclude`; `RoomDO` passes it to `deal` and feeds the result to `reduce` as an adapter input (§6)
  - `5.4` todo: Mixed difficulty: `reduce` draws the round's difficulty from the bag in state (2.8, 3.2) and emits it in the deal-word effect; the adapter deals from that deck (0007)
  - `5.5` todo: `data/words.json` check: words unique across the file, every entry has a category, every difficulty is non-empty
      Counts are read from the file, not hard-coded.

**Verification.** DO leg: a fixed seed deals a reproducible order; a deck
deals every word once before reshuffling; two rooms dealing in turn never
receive the same word within one shuffle; an excluded word is skipped. Unit
leg: the words.json check and the Mixed bag.
