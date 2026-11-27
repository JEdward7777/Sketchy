# Phase 9 — Client: evidence

The evidence screens: the synced two-pass slideshow with artist labels,
"Agent went dark" cards, live public vote chips, lock-in, and free browse
with the vote countdown (§4, §7, §8). The slide index comes from
`slideIndex` and the clock offset, never from per-slide messages
(harness/AGENTS.md §5).

- `9` done: Client: evidence
  - `9.1` done: Drawings (stroke lists) received once per round (6.5), cached for the round, drawn with the shared renderer (2.11), with a placeholder while loading
  - `9.2` done: Synced slideshow: two passes, each card labeled with its artist, index from `slideIndex` (2.4) and the clock offset (§4, §14)
  - `9.3` done: "Agent went dark" card for a missing drawing (§7)
  - `9.4` done: Live vote chips (color and icon) on each drawing; tap to vote or change; no self-vote; the faker votes too (§4)
  - `9.5` done: Lock-in; a locked vote shows as final and cannot be changed (§4)
  - `9.6` done: Free browse: flip through all drawings while the vote countdown runs (§4); the end-of-voting behaviour per 0.8.7

**Verification.** E2E leg with N contexts and a short Custom preset: at
sampled instants every context shows the same slide index; a vote in one
context appears in all others; a self-vote is not offered; the last
connected lock-in ends browse; a context closed before drawing shows as a
dark card elsewhere. Frame recording confirms no per-slide messages and no
stroke data inside `state`; no context's DOM shows the word or the role text
during slideshow or browse (8.3.3).
