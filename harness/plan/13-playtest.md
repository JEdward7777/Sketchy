# Phase 13 — Playtest

The owner's phase: real phones, real people. Agents prepare the build and
record what comes back; they do not simulate any of it.

- `13` active: Playtest
  - `13.1` done: Owner's: deploy the release build to `*.workers.dev` — deployed by the orchestrator under 0021 (02d156b, 2026-11-27)
  - `13.2` todo: Owner's: first family game on the deployed build
  - `13.3` todo: Findings logged in `harness/observations/open.md`, then scoped into stages or decisions

**Verification.** 13.1 and 13.2 are confirmed by the owner in a session
note. 13.3 is done when every finding is an observation, a stage, or a
decision, with `node scripts/plan.mjs --check` passing.
