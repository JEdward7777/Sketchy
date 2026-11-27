# Resolved observations

### O-01 — `plan.mjs --check` does not check that a `dropped` stage has notes
**Spotted:** 2026-11-22, stage 0.7
**Why it matters:** the earlier `plan/README.md` listed "a `dropped` stage has
notes" among the checker rules, but `check` in `scripts/plan.mjs` tests only
duplicates, parentage, done-with-unfinished-children, indentation and the
active-leaf count. A stage can be dropped without saying why and the check
still passes. The rewritten README now calls it a convention.
**Not doing yet because:** `scripts/` is out of scope for phase 0; adding the
check is a small change for phase 1 (1.1 wires `plan:check`).
**Outcome:** fixed in stage 1.1 (2026-11-23). `parse` in `scripts/plan.mjs`
records whether a stage line is followed by indented prose, and `check`
reports a `dropped` stage without it. `plan/README.md` lists it among the
checker rules.

### O-05 — No default difficulty in the spec
**Spotted:** 2026-11-23, stage 3.2
**Why it matters:** `SPEC.md` §6 lets the host pick Concrete, Medium,
Abstract or Mixed but names no default. `DEFAULT_DIFFICULTY` in
`src/shared/core/rules.ts` is `mixed`, chosen without the owner.
**Not doing yet because:** a product call for Joshua; trivially changed.
**Outcome:** resolved by decision 0023 item 2 (2026-11-23): the default is
Mixed; `DEFAULT_DIFFICULTY` in `src/shared/core/rules.ts` cites it.

### O-06 — A paused game cannot be resumed by a waiting late joiner
**Spotted:** 2026-11-23, stage 3.3.2
**Why it matters:** decision 0011 item 1 counts only seated players as
active, and 0020 item 4 seats late joiners (and returning removed players)
only when the next round starts. A round paused with 2 seated players
therefore stays paused however many newcomers arrive, until a seated player
reconnects or the host ends the game (`host:end`, unit 3b). The reducer
implements this literally (`isActive`, `maybeResume`).
**Not doing yet because:** it follows the decisions as written; whether a
paused game should seat newcomers (e.g. cancel and restart the round with
them) is the owner's call.
**Outcome:** resolved by decision 0023 item 1 (2026-11-23): while paused, if
connected seated plus connected waiting players reach `MIN_PLAYERS` and no
seated return has lifted the pause, the round is scrubbed like a §7 cancel
and the next round seats everyone (`maybeRestart` in
`src/shared/core/reduce.ts`; tests in `test/unit/core/restart.test.ts`).

### O-10 — Revealed fakers publish the faker generator's output
**Spotted:** 2026-11-24, unit 3b
**Why it matters:** `rng` (mulberry32) holds 32 bits and advances by a
fixed constant per draw. Each unmask publishes one `pickFaker` output
(`log2(roster)` bits), and words in round results reveal Mixed-bag draws.
Over a long game (e.g. 3 cycles × 10 players) a client could brute-force the
2^32 seeds against the revealed fakers, pin the state, and predict every
later faker — the deduction decision 0020 set out to prevent. Unit 3b kept
the slideshow order (public before unmask, up to ~22 bits a round) off this
generator with a separately seeded `orderRng`, so the leak needs many
unmasks, not one slideshow.
**Was deferred because:** it needs fresh CSPRNG entropy per round, which
only the adapter has: e.g. `wordDealt` (or a new input) carrying entropy
that is mixed into `rng` before the faker is picked, which would move the
pick from `startRound` to the deal. A design change to 3a's round start;
for the orchestrator to schedule (phase 4 adapter work is the natural time).
**Outcome:** fixed in phase 3 unit 3b (2026-11-24) at the coordinator's
request. `reduce(state, input, now, entropy)` takes 32 fresh bits from the
adapter's CSPRNG on every call and folds them into `rng` with `rngAbsorb`
(`mix32(s ^ entropy)`, murmur3's fmix32) and a separately mixed copy into
`orderRng`, before any deadline or input is handled. Revealed outputs can no
longer pin the generator. `test/unit/core/entropy.test.ts` shows the faker
and the card order depend on the call's entropy, that the streams stay
apart, that the mix avalanches and that public state does not change with
it; the property test runs with random entropy per call.

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
**Outcome:** resolved in phase 5 (2026-11-26). The real `DeckDO` deals
through the same pending-deal path: an RPC failure is retried from the
alarm with `dealBackoff` (unchanged, DO tests "a failed deal is retried
from the alarm" and the backoff tests), and a deck that has nothing left
outside `exclude` answers `repeat: true` instead of failing (decision
0028), so `dealing` ends on the first answer whenever the deck is
reachable (DO test "a room that has used every word of its difficulty
still gets a word, at once").

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
**Outcome:** resolved in phase 5 (2026-11-26). `stubWordSource` is gone;
rooms deal from `DeckDO` over the whole of `data/words.json`, which
honours `exclude` and, if a game ever uses every word of a difficulty,
deals a flagged repeat (decision 0028) rather than leaving the round in
`dealing`.

### O-17 — A client close without a code is never echoed by the room
**Spotted:** 2026-11-27, phase 8 review round 1 (E2E)
**Why it matters:** `RoomDO.webSocketClose` echoes the client's close code
with `ws.close(code, reason)`. A browser `close()` with no code arrives as
1005, which may not be sent, so the echo throws (caught) and the browser's
socket stays in CLOSING without a `close` event. The room still runs
`closed(ws)`, and `RoomConnection` detaches a socket's handlers before it
closes one, so play is unaffected; it only matters to code that waits for
`onclose` after its own code-less `close()` .
**Not doing yet because:** server code is outside phase 8; the fix is to
echo 1000 when the code is 1005 or 1006.
**Outcome:** fixed in phase 8 review round 1 (2026-11-27). `echoCloseCode`
(`src/worker/room-policy.ts`) echoes 1000 and 3000–4999 and answers any
other code with 1000; `RoomDO.webSocketClose` uses it. Unit test in
`test/unit/room-policy.test.ts`; DO tests "answers a code-less client
close …" (fails without the fix) and "echoes an application close code"
in `test/do/room.test.ts`. The E2E's 3001 workaround went back to a plain
`close()`.

### O-21 — The E2E DOM secrecy scan fails when the deck deals "polite"
**Spotted:** 2026-11-27, phase 12 (unit 12a), full E2E run
**Why it matters:** `domStrings` (test/e2e/round-helpers.ts) collects every
attribute value, and several screens carry `aria-live="polite"`. When the
deck deals the word `polite` (data/words.json), `results.spec.ts` reports
"shows the bare word" — a false positive that fails the run by chance
(about 1 in 400 per dealt word). Seen once; the rerun passed.
**Not doing yet because:** test-only, rare; the fix is to skip
`aria-live`/`role`-style enumerated attribute values in `domStrings` (or in
`isBareWord`'s callers), which belongs with whoever next touches the
secrecy helpers.
**Outcome:** fixed in unit 12a review round 1 (2026-11-27). `domStrings` now reads
text nodes, form values and only shown or announced attributes
(`SHOWN_ATTRIBUTES`: aria-label, aria-description, aria-valuetext,
aria-roledescription, aria-placeholder, title, alt, placeholder). The faker's
page also gets `assertFakerDomClean`, a strict scan of every attribute
(`data-*`, `class` included) except HTML/ARIA keyword attributes, in
round.spec, evidence.spec and results.spec.
