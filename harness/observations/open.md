# Open observations

Next free id: **O-15**.

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

**Also (phase 6 review):** a socket's every `hello` after the slideshow
starts replays the round's drawings to that new socket (up to `P ×
STROKES_MAX_BYTES` outbound, one drawing in memory at a time). A client
that reconnects in a loop costs free outbound bytes plus one billed
upgrade each; decision 0031's 1 MB limit and card-by-card delivery bound
it. A rate limit here would cover it too.

### O-13 — First room create right after a deploy returned 500
**Spotted:** 2026-11-26, unit 4b deploy
**Why it matters:** the first `POST /api/room` after `wrangler deploy`
answered `{"error":"internal"}` 500; every later create succeeded. Likely
the DO RPC racing the version rollout. A host tapping "Create" at that
moment sees a failure.
**Not doing yet because:** transient and rare; the landing screen could
retry a 500 once before showing an error (cheap; do it with phase 12 polish
or earlier if seen again).

### O-14 — A scripted player can drain the shared deck to learn the word
**Spotted:** 2026-11-27, phase 5 review round 2
**Why it matters:** §6 deals from one shared deck without replacement. Someone
who scripts side rooms can deal through a difficulty (a repeat marks the
shuffle boundary) until one word is left, then start their real game: if they
are the faker they know the word. A partial drain still narrows the
candidates. Needs a script and minutes of quiet traffic; a friends' party
game is unlikely to see it.
**Not doing yet because:** it is the behaviour §6 specifies; the fixes trade
away "every word once per shuffle" (reshuffle when fewer than ~n/2 remain, or
deal with replacement below a threshold). Owner's call; pairs with O-12
(rate-limiting room creation would also slow a drain).

### O-15 — DeckDO tables have no migration; the local dev deck is on an old schema
**Spotted:** 2026-11-26, phase 6 E2E runs
**Why it matters:** `.wrangler/state` holds a `deck_order (difficulty,
count NOT NULL, ord)` table from a phase-5 iteration; the committed code
creates `deck_order (difficulty, ord)` with `CREATE TABLE IF NOT EXISTS`,
which keeps the old table, so every reshuffle's insert fails ("NOT NULL
constraint failed: deck_order.count") and the room retries the deal with
backoff. Locally this made the E2E mid-round "Rejoin as…" test time out
in `dealing` in 2 of 4 runs. The same would happen in production if a
deployed `DeckDO` ever created a table with a different shape, now or
after any later schema change.
**Not doing yet because:** outside phase 6. Fix locally by deleting
`.wrangler/state/v3/do/sketchy-DeckDO` (owner's machine state, not
touched). Check the deployed deck's schema; give `DeckDO` (and `RoomDO`)
a schema version or a shape check that recreates or migrates its tables.
**Update 2026-11-27:** the stale local `.wrangler` DeckDO state was deleted; the
local and deployed schemas now match the code. The open point is only that
future table changes need a schema version or migration.
