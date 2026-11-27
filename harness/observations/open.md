# Open observations

Next free id: **O-13**.

### O-02 — Slideshow could replay each drawing being drawn
**Spotted:** 2026-11-22, stage 0.7
**Why it matters:** with drawings stored as ordered strokes (decision 0009),
the slideshow could animate a drawing stroke by stroke — a possible fun touch,
and a way to see whether someone hesitated.
**Not doing yet because:** not in `SPEC.md`; it changes slideshow timing
(`players × 2 × perSlide`, §8) and needs the owner's say. Idea only.

### O-03 — DO leg prints a `node:inspector` warning on every run
**Spotted:** 2026-11-23, stage 1.6.2
**Why it matters:** `npm run test:do` prints `"node:inspector", required from
…/vitest/dist/chunks/inspector…js, is not available at this Worker's
compatibility date and flags` and `Fallback service failed to fetch module`
twice per run. All tests pass, but noise like this trains readers to skim
past real warnings. Enabling `nodejs_compat` in `wrangler.jsonc` would likely
silence it, at the cost of the production Worker no longer matching what
ships without Node APIs.
**Not doing yet because:** harmless today; worth a look when
`@cloudflare/vitest-plugin` or vitest next upgrades, or if a test-only
compatibility flag proves possible without touching the deployed config.

### O-04 — Random room codes can spell unfortunate words
**Spotted:** 2026-11-23, stage 2.6
**Why it matters:** `generateRoomCode` draws 4 letters uniformly from
`ROOM_CODE_ALPHABET`, which keeps the vowels `A` and `E` (and `Y`), so a code
can spell a rude English word. The game is family-friendly (`SPEC.md` §6:
family-friendly word list; §12: fun for kids).
**Not doing yet because:** §14 only asks for confusables to be excluded;
whether to drop vowels or add a blocklist (and which words) is a product call.
Room creation (4.2, planned) will retry on collision (decision 0007), so a rejected code could reuse that retry.

### O-07 — The `dealing` phase has no timeout
**Spotted:** 2026-11-23, stage 3.3.2
**Why it matters:** `startRound` emits `dealWord` and the room waits in
`dealing` until the adapter answers with `wordDealt`; `phaseDeadline` gives
`dealing` no deadline. If the `DeckDO` call fails and the adapter does not
retry, the room sits in `dealing` until the §14 inactivity expiry.
**Not doing yet because:** the retry belongs to the adapter (stages 5.3,
6.1); a reducer-side re-deal deadline is an option if 6.x finds retrying
awkward.
**Update 2026-11-26 (unit 4a):** `RoomDO` now stores the pending deal and
retries it from the alarm every `DEAL_RETRY_MS` until it is answered or the
room leaves `dealing` (DO test "a failed deal is retried from the alarm").
Close this once 5.3 wires `DeckDO` through the same path.

### O-08 — A host can approve their own "Rejoin as…" (0024 trust limit)
**Spotted:** 2026-11-24, unit 3a review round 2
**Why it matters:** requests are anonymous by design (0024), so a host —
or a faker who claims host while the host is away (0010) — can open a second
device, ask to "Rejoin as…" a dropped agent and approve it, reading the word
(or, as a non-faker host, learning who a dropped faker is). The approval is a
human trust boundary, not a guarantee. During the guess phase this lets a
host-faker read the word through the dropped agent's seat and submit it, so
the guess is accepted automatically.
**Not doing yet because:** 0024 accepts this trade-off. Possible mitigations
for the owner: a public "<name>'s seat moved to a new device" notice on
approval; or forbid a host who is on the round roster from approving.

### O-09 — Graces expiring in the same millisecond settle one at a time
**Spotted:** 2026-11-24, unit 3a review round 4
**Why it matters:** `runDue` fires each due grace and `settle`s after it, in
player order. If two of three seated players drop in the same millisecond,
the outcome depends on order: the faker first → cancel; the other first →
pause (the faker's cancel waits for resume). Workers clocks do not advance
during processing, so simultaneous socket closes can share a timestamp.
Reveals nothing beyond the cancel itself; matches 0011 for drops 1 ms apart.
**Not doing yet because:** harmless; fix by firing every grace due at the
same instant before one `settle` if it ever matters in play.

### O-11 — The stub word source runs out within one long game
**Spotted:** 2026-11-26, unit 4a
**Why it matters:** `stubWordSource` (`src/worker/words.ts`) holds 12
concrete, 12 medium and 7 abstract words. A game that deals more rounds of
one difficulty than that (e.g. 8 abstract rounds) gets only used words: the
reducer re-deals and the round stays in `dealing` until `host:end`. Since
the unit 4a review, retries back off (2 s doubling to 5 min, 2 source calls
per retry) and dealing is not activity, so such a room expires 2 h after
the last player action at a cost of ≤ ~190 rows (`budget.md`); before, it
cost ~10 rows every 2 s and never expired.
**Not doing yet because:** the stub is temporary; phase 5's `DeckDO`
(5.1–5.3) replaces it behind the same `WordSource` interface. Delete this
observation then.

### O-12 — `POST /api/room` has no rate limit
**Spotted:** 2026-11-26, unit 4a review round 1
**Why it matters:** room creation is unauthenticated. Each call is a Worker
request, a DO request per code tried, and two rows written, and a room
lives 2 h. A script looping on it could spend the free plan's 100,000
daily requests or rows and fill the 160,000-code space (`20^4`), after
which every create returns `503 no_free_code`.
**Not doing yet because:** a family party game is not a target today. A
Workers Rate Limiting binding (`ratelimits` in `wrangler.jsonc`, keyed by
client IP) in front of `POST /api/room` is the likely fix; check it is on
the free plan first.
