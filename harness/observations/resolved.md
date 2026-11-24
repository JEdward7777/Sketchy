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
