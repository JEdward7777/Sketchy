# Verification legs

Set up in phase 1 (stage 1.6, decision 0006 item 5). Each phase's plan file
names which legs it needs. All commands run from the repo root after
`npm ci`.

## The gate

```bash
npm run check
```

= `types:check` (generated `src/worker/worker-env.d.ts` matches
`wrangler.jsonc`) → `typecheck` → unit leg → DO leg → `plan:check`. It stops
at the first failure. The E2E leg is separate because it builds the client and
starts `wrangler dev`.

## Typecheck

```bash
npm run typecheck
```

`tsc -p` once per runtime, so globals never leak between them:
`tsconfig.shared.json` (no DOM, no Workers), `tsconfig.worker.json` (Workers
types only), `tsconfig.client.json` (DOM), `tsconfig.sw.json` (WebWorker, for
`src/client/sw.ts`), `tsconfig.tools.json` (tests and configs). After
editing `wrangler.jsonc`, run `npm run types` to regenerate
`src/worker/worker-env.d.ts`.

## Unit leg

```bash
npm run test:unit        # vitest run --project unit
```

- **Runs:** in node (vitest project `unit` in `vitest.config.ts`), over
  `test/unit/**/*.test.ts`: pure code in `src/shared` and pure `src/client`
  modules (the service-worker fetch policy `swStrategy`).
- **Tools:** `vi.useFakeTimers()` / `vi.setSystemTime()` for time;
  `seededRng(seed)` in `test/helpers/seeded-rng.ts` for reproducible random
  inputs (test-only; the game's RNG is stage 2.1).
- `test/unit/platform-rules.test.ts` also scans server source for the §5
  rules a runtime test cannot see: `setAlarm` mentioned only in
  `src/worker/alarm.ts`, no `accept` in `src/worker` other than
  `ctx.acceptWebSocket`, no `setTimeout`/`setInterval`/`scheduler.wait`. It
  strips comments with esbuild's parser (string and regex literals survive)
  and matches identifiers, so aliases and string keys are caught; its own
  self-tests prove both.

## DO leg

```bash
npm run test:do          # vitest run --project do
```

- **Runs:** inside workerd via `@cloudflare/vitest-plugin` (vitest project
  `do`), with the real entrypoint `src/worker/index.ts` and the bindings from
  `wrangler.jsonc`, over `test/do/**/*.test.ts`. Static assets come from
  `test/do/fixture-assets`, so no client build is needed.
- **Helpers** (`test/do/helpers.ts`): `openSockets(code, n)` opens `n`
  WebSockets to one `RoomDO` through the Worker and completes `hello` on each;
  `Socket.next(pred)` waits for a matching message; `freshCode()` keeps tests
  apart (storage is shared across a run).
- **Firing deadlines:** `runDurableObjectAlarm` runs the alarm handler at
  once and does not move the clock, so `fireAlarmAtScheduledTime(code)` reads
  the pending alarm, pins the room's injectable clock (`src/worker/clock.ts`,
  `setClockForTests`) to that instant, then runs it. Tests schedule deadlines
  an hour ahead so the runtime never fires the real alarm mid-test, and call
  `resetClock()` after each test.
- `evictDurableObject(stub)` drops the instance while keeping storage and
  hibernated sockets; tests use it to show nothing needed lives in memory.
- **Handler exceptions do not fail a test on their own.** An exception thrown
  by a hibernation handler (`webSocketMessage`, …) is only logged by workerd
  ("uncaught exception; … TypeError: …") and the leg still passes. To pin a
  handler's behaviour, call it directly inside `runInDurableObject` and
  assert that it resolves, as "handler calls never throw for frames after a
  close" in `test/do/room.test.ts` does. A clean run prints no
  "uncaught exception" lines.
- Known noise: each run prints `"node:inspector" … is not available` and
  `Fallback service failed to fetch module` twice. It comes from vitest's
  own inspector chunk under a Worker without `nodejs_compat`; tests are
  unaffected (observation O-03).

## E2E leg

```bash
npx playwright install chromium   # once per machine
npm run test:e2e                  # playwright test
```

- **Runs:** Playwright (`playwright.config.ts`) starts
  `npm run build && npx wrangler dev --port 8799 --ip 127.0.0.1` itself, waits
  for `/api/health`, and runs `test/e2e/**/*.spec.ts` in Chromium with a
  Pixel 7 profile. Tests open several browser contexts, one per simulated
  player; the smoke test has each context load the shell and complete the
  WebSocket handshake. The smoke file also covers the service worker (shell
  served from it, `/api` never; shell opens offline after one visit; the
  asset layer's fallback HTML for a missing file is never cached and a
  non-HTML navigation never replaces the cached shell) and Worker-first
  routing for navigations to `/api`, `/api/*` and `/ws`.
- The short-timer Custom preset (`SPEC.md` §8) that game-flow E2E tests need
  arrives with the settings in phase 4.
- Local only; nothing is deployed.

## Baseline

Recorded 2026-11-23 (after review round 3) from
`rm -rf node_modules dist .wrangler && npm ci` ("added 127 packages … found 0
vulnerabilities"), Linux (WSL2), node v24.14.0, npm 11.21.0, wrangler
4.166.0, `@cloudflare/vitest-plugin` 1.9.0, vitest 5.1.1.

| Leg | Command | Result |
|---|---|---|
| types drift | `npm run types:check` | up to date |
| typecheck | `npm run typecheck` | 5 configs, 0 errors |
| unit | `npm run test:unit` | 5 files, 26 tests passed |
| DO | `npm run test:do` | 2 files, 17 tests passed |
| plan | `npm run plan:check` | consistent, 179 stages |
| gate | `npm run check` | exit 0 |
| E2E | `npm run test:e2e` | 6 tests passed (Chromium 159.0.8154.6, Playwright 1.65.1) |

The unit and DO legs together (`npx vitest run`) passed 43 of 43 on three
consecutive runs.

## Dependency versions

Every direct dependency is pinned to an exact version in `package.json`, and
a version must have been published **at least a few days** before it is
adopted (check with `npm view <pkg> time --json`). A same-day release has had
no time for a bad publish to be noticed and pulled. On 2026-11-23 that moved
wrangler from 4.167.0 to 4.166.0, `@cloudflare/vitest-plugin` from 1.9.1 to
1.9.0 and `@cloudflare/workers-types` from 5.20261124.1 to 5.20261120.1. Every
other direct dependency was already older; the newest of them is vitest 5.1.1,
published 2026-11-18. After changing
`wrangler`, run `npm run types`.
