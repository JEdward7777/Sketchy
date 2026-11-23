# Open observations

Next free id: **O-03**.

### O-01 — `plan.mjs --check` does not check that a `dropped` stage has notes
**Spotted:** 2026-11-22, stage 0.7
**Why it matters:** the earlier `plan/README.md` listed "a `dropped` stage has
notes" among the checker rules, but `check` in `scripts/plan.mjs` tests only
duplicates, parentage, done-with-unfinished-children, indentation and the
active-leaf count. A stage can be dropped without saying why and the check
still passes. The rewritten README now calls it a convention.
**Not doing yet because:** `scripts/` is out of scope for phase 0; adding the
check is a small change for phase 1 (1.1 wires `plan:check`).

### O-02 — Slideshow could replay each drawing being drawn
**Spotted:** 2026-11-22, stage 0.7
**Why it matters:** with drawings stored as ordered strokes (decision 0009),
the slideshow could animate a drawing stroke by stroke — a possible fun touch,
and a way to see whether someone hesitated.
**Not doing yet because:** not in `SPEC.md`; it changes slideshow timing
(`players × 2 × perSlide`, §8) and needs the owner's say. Idea only.
