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

