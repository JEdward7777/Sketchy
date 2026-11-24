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
