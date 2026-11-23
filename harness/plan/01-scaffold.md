# Phase 1 — Scaffold

Toolchain, Worker with static assets, `RoomDO` and `DeckDO` shells, the PWA
shell, and — before any feature exists — the three verification legs every
later phase names, plus the free-tier budget and protocol references. Layout
and setup follow Storython2 and Satellite-Chess as recorded in
`reference/sibling-projects.md`; the client stack is decision 0002. Ends with
the owner's first deploy to `*.workers.dev` (§13).

- `1` todo: Scaffold
  - `1.1` todo: `package.json` (npm), `src/{client,shared,worker}`, one tsconfig per runtime, Vite + React (0002), scripts `typecheck`, `test`, `plan`, `plan:check`, `check`
  - `1.2` todo: `wrangler.jsonc`: static assets with SPA fallback, Worker-first routing for `/ws/*` and `/api/*`, `new_sqlite_classes` migration for both DOs, `observability.enabled` (§13)
  - `1.3` todo: Worker entry routes `/ws/:code` to that room's `RoomDO` and `/api/*` to handlers; unknown `/api` paths 404
  - `1.4` todo: DO shells: `RoomDO` accepts sockets with `ctx.acceptWebSocket()` only; `DeckDO` is a plain SQLite-backed shell; `RoomDO`'s one-alarm arm function sets the alarm to the earliest of a list of absolute deadlines (harness/AGENTS.md §5)
      Only the arm function calls `setAlarm`. From phase 4 the list comes
      from `nextDeadline(state)` (3.5); in phase 1 a test feeds it two
      deadlines and shows both fire in order from one alarm.
  - `1.5` todo: PWA shell: manifest, placeholder icons, service worker caching the app shell (§13)
    - `1.5.1` todo: The service worker never intercepts `/ws` or `/api`; a test or fetch-handler assertion shows it
  - `1.6` todo: Verification legs (decision 0006)
    - `1.6.1` todo: Unit leg: vitest over `src/shared` and pure `src/client` modules (node or jsdom environment) with fake timers and a seeded-RNG test helper
    - `1.6.2` todo: DO leg: `@cloudflare/vitest-pool-workers` with a helper that opens N WebSockets to one `RoomDO`, and fires due deadlines with `runDurableObjectAlarm`; that call does not move the clock, so `RoomDO` reads time through an injectable clock that the helper sets to the alarm's scheduled time first
    - `1.6.3` todo: E2E leg: Playwright with N browser contexts against `wrangler dev`, one smoke test that loads the shell
        The short-timer Custom preset (§8) it relies on arrives with the
        settings in phase 4; the smoke test only needs the shell.
    - `1.6.4` todo: `reference/verification.md`: the exact command per leg, where it runs, and the recorded baseline
  - `1.7` todo: `reference/budget.md`: free-tier limits checked against current Cloudflare docs (date and links recorded)
      Must cover: Workers requests, DO requests and duration under
      hibernation, DO SQLite storage and the per-value size limit, WebSocket
      message size limit, alarms. Per-game estimates written as expressions
      (for example messages per round in terms of players and vote changes),
      not bare numbers. These limits set the platform safety limit for
      stroke submissions in 6.4 (decision 0009).
    - `1.7.1` todo: Measure stroke payload for a realistic sketch and for continuous scribbling as bytes per second of drawing; derive the longest draw time that fits one message and one storage value, record it in `reference/budget.md`, and compare it with Relaxed (§8) (0009)
        The codec arrives in 2.10, so this uses the provisional format
        (integer points on the logical grid, plain JSON); 7.10 re-measures
        with the real codec. If an honest scribble does not fit one message
        or one storage value, record that chunking is needed (0009).
  - `1.8` todo: `reference/protocol.md` skeleton: message envelope, protocol version field in the handshake, public `state` vs per-socket `private` rule (§14)
  - `1.9` todo: Owner's: first deploy to `*.workers.dev`, open it on a phone, confirm the shell loads and offers install
      Owner's step unless 0.6 grants deploy authority for the run.

**Verification.** All three legs run green from a clean install, with the
commands and baseline recorded in `reference/verification.md` (1.6.4):
`npm run check` (typecheck + unit + DO leg + plan check) and the Playwright
smoke test against `wrangler dev`. The multiplexer test (1.4) and the service
worker bypass (1.5.1) are DO-leg and unit-leg tests respectively. 1.9 is the
owner's and is never simulated.
