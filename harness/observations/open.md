# Open observations

Next free id: **O-04**.

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
