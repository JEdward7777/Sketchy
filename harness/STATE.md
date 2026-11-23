# Where the project is

*Rewritten every session. Short by design — the plan holds the detail, the session
files hold the history, and `reference/` holds everything that is simply true.*

**Tree state**: git repo on `main`, public `JEdward7777/Sketchy`; phase-0 plan rewrite committed (ratchet: 8 review rounds, gate skipped per 0008).
**Active stage**: `0` — owner questions `0.8.x` and operator inputs `0.6`.
**Next action**: ask Joshua the owner questions `0.8.1`–`0.8.11` one at a time, then settle the rest of `0.6` and start the ratchet at phase `1`.
**Live**: nothing deployed.

## Settled so far

- Design locked in `../SPEC.md` (2026-11-22, from a claude.ai chat).
- Harness layout (0001), React + Vite client (0002), §5 edge cases
  unchanged (0003), auto-continue held by host taps (0004), public repo / MIT
  / `main` (0005).
- Phase structure: pure core, presence in core, server before client, drawings
  out of `state`, a verification recipe per phase (0006).
- Technical defaults for spec gaps (0007).
- Second-model gate skipped unless Fable is available (0008).
- Drawings travel as strokes, not images; amends §9 (0009, owner-approved).
- Execution process: the ratchet, `pipeline/ratchet.md`.

## Open before coding

`plan/00-plan.md`: owner questions `0.8.x` (each with options and a
recommendation) and ratchet operator inputs `0.6`.
