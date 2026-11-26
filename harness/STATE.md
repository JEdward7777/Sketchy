# Where the project is

*Rewritten every session. Short by design — the plan holds the detail, the session
files hold the history, and `reference/` holds everything that is simply true.*

**Tree state**: git repo on `main`, public `JEdward7777/Sketchy`; phases 1–3 committed; phase 4 next.
**Active stage**: `4` — Lobby (`RoomDO` adapter over the core, first real screens).
**Next action**: run the ratchet on phase `4`, then onward; no stop point, email Joshua before blocking (0021).
**Live**: https://sketchy.hootowl7777-cloud.workers.dev — phase-1 shell (deployed 2026-11-23).

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
- Owner answers to `0.8.x` (2026-11-23): host claim (0010), pause freezes
  (0011), faker disconnect and blip grace (0012), judging (0013), Play again
  (0014), vote targets (0015), all-locked ends voting (0016), envelope is not
  a hold (0017), 2 cycles default (0018), removed players can return (0019),
  random faker every round, amends §7 (0020).
- Ratchet inputs: no stop point, deploys once Wrangler is signed in, email
  before blocking (0021).
- Custom timer bounds (0022).
- Orchestrator defaults the owner may override (2026-11-24): a paused round
  restarts with newcomers, default difficulty Mixed (0023); mid-round
  "Rejoin as…" needs the host's OK and rotates the token (0024); a restart
  waits 30 s and counts open sockets, faker pool is every connected roster
  player, graces run during a pause (0025); round-end defaults: entropy
  per step, Play again via continue, host:end, beats (0026); no pause from
  unmask on or on final results, room-wide round numbers (0027).
- Execution process: the ratchet, `pipeline/ratchet.md`.

## Waiting on Joshua

Owner real-phone stages, collected as the run reaches them (none block the run):

- `1.9.2` — open the live URL on a phone; confirm the shell loads and offers install.

To confirm or override when convenient (the run continues on these defaults):

- 0023–0027, written by the orchestrator during phase 3.
- Whether votes should be refused while the game is paused (0027 note).
- O-08: a host can approve their own "Rejoin as…" (0024's trust limit).
