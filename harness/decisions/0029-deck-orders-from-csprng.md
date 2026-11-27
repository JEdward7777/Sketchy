# 0029 — Deck orders come from a CSPRNG and are stored, not seeded (amends SPEC §6)

- **Date:** 2026-11-27
- **Status:** accepted (orchestrator default under 0021; the owner may override)
- **Stage:** 5.1–5.2 (phase 5 review)

## Decision
Each deck's shuffle is a Fisher–Yates permutation drawn with
`crypto.getRandomValues` (rejection sampling) and stored in `DeckDO`'s SQLite
(`deck_order`), with the position in `deck_pos`. A reshuffle draws a fresh
permutation. §6's "seeded shuffle … reshuffles with a new seed" describes the
behaviour (every word once per shuffle, a new order each time), not the
mechanism; the order is no longer derived from a seed.

## Why
Every dealt word is shown in round results. A 32-bit seed is recovered by
brute force from about six observed words, which then reveals future words —
including the word a faker must not know (phase 5 review round 1).

## Rejected
- A larger seed with a fast PRNG: still a deterministic stream whose outputs
  are published; a stored CSPRNG permutation costs one row per reshuffle.

## Revisit if
`DeckDO` row writes ever matter for cost (they are under 1/80 of a row per deal).
