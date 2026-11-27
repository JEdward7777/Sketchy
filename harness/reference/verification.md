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
  inputs. It is a mutable wrapper over the game's pure RNG
  (`src/shared/rng.ts`, stage 2.1), so the same seed gives the same sequence
  as `rngNext`; `test/unit/rng.test.ts` asserts it.
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
  `Socket.next(pred)` waits for a matching message (consuming everything
  before it), with `nextState`, `nextPrivate` and `nextError` built on it;
  `Socket.raw` keeps every frame's exact bytes for secrecy checks.
  `freshCode()` keeps tests apart (storage is shared across a run);
  `newRoom()` creates a room under one (a `hello` to a room never created
  gets `no_room`); `roomWithPlayers(n)` creates one with `n` joined players,
  `p1` the host.
- **Word source:** `setWordSourceForTests` (`src/worker/words.ts`) swaps the
  stub deck for a scripted or failing one; reset it after each test.
- **Logged room failures fail the test:** `RoomDO` catches a failed event
  and logs `room event failed: …`. `failOnRoomErrors()` (call it at the top
  of a test file) spies on `console.error`, which the DO shares with the
  tests, and fails any test during which that line appears, unless the
  test called `allowRoomErrors()` because it makes events fail on purpose.
- **Injected failures:** `setFaultForTests` (`src/worker/room-policy.ts`)
  runs a function at the `'commit'` point inside the event's SQLite
  transaction, after the drawing writes and before the state is saved; a
  throw there must leave storage, attachments and the alarm unchanged.
  `storedRoom(code)` reads the stored reducer state and pending deal.
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
  can be set from the lobby since unit 4b: pick Custom, enter the 0022
  minimums (5 s / 1 s / 5 s / 5 s), Save timers (as `lobby.spec.ts` does).
- Local only; nothing is deployed.

## Baseline

Recorded 2026-11-26 after phase 4 unit 4b and its review rounds 1–2 (client
lobby: theme tokens with an AA contrast test, base components, landing,
join form, "Rejoin as…", lobby with QR and host settings, `RoomConnection`
with reconnect/connect timeout/wake probe/token/clock probe; `RoomDO`
answers an uncreated code with `no_room` on an open socket), same machine
and versions as below plus `qrcode.react` 4.2.0:

| Leg | Command | Result |
|---|---|---|
| types drift | `npm run types:check` | up to date |
| typecheck | `npm run typecheck` | 5 configs, 0 errors |
| unit | `npm run test:unit` | 38 files, 418 tests passed |
| DO | `npm run test:do` | 5 files, 47 tests passed |
| plan | `npm run plan:check` | consistent, 181 stages |
| gate | `npm run check` | exit 0 |
| E2E | `npm run test:e2e` | 11 tests passed (6 smoke, 5 lobby) |

`test/e2e/lobby.spec.ts`: three contexts create/join/share a lobby
(taken colors disabled, a reload rejoins as the same player, host
settings reach everyone, Start at 3); "Rejoin as…" after the blip grace;
an uncreated code returns to the landing; mid-round "Rejoin as…" admitted
by the host (Custom 5 s draw, 10 s slides: the player drops only once
the slideshow is on, so a faker drop can never cancel the round). Two of
them wait out `BLIP_GRACE_MS` (10 s) each; the leg takes about 47 s.
A fifth test plants a stale token and expects the join form's "HQ lost
your file" notice. An offline → online reconnect test was tried and
dropped: Playwright's `setOffline` does not close an open WebSocket to
127.0.0.1 in Chromium, so the page never notices; the unit leg covers
reconnect instead. The smoke
test now checks the landing (`data-testid="landing"`) instead of the
phase-1 `shell-status` line.

Recorded 2026-11-26 after phase 4 unit 4a and its review round 1
(`RoomDO` adapter, `POST /api/room`, presence, expiry, deal retry with
backoff, transactional commit, ghost-request cleanup) and review round 2, same machine and
versions as below:

| Leg | Command | Result |
|---|---|---|
| types drift | `npm run types:check` | up to date |
| typecheck | `npm run typecheck` | 5 configs, 0 errors |
| unit | `npm run test:unit` | 30 files, 350 tests passed |
| DO | `npm run test:do` | 5 files, 46 tests passed |
| plan | `npm run plan:check` | consistent, 181 stages |
| gate | `npm run check` | exit 0 |
| E2E | `npm run test:e2e` | 6 tests passed |

The E2E smoke test now creates its room with `POST /api/room` before the
handshake.

Recorded 2026-11-26 after phase 3 unit 3b and its review round 1 (core
reducer: slideshow through final results, secrecy to the guess, per-call
entropy, decision 0027, property and run-to-run secrecy tests), same
machine and versions as below:

| Leg | Command | Result |
|---|---|---|
| types drift | `npm run types:check` | up to date |
| typecheck | `npm run typecheck` | 5 configs, 0 errors |
| unit | `npm run test:unit` | 29 files, 346 tests passed |
| DO | `npm run test:do` | 2 files, 17 tests passed |
| plan | `npm run plan:check` | consistent, 181 stages |
| gate | `npm run check` | exit 0 |
| E2E | `npm run test:e2e` | 6 tests passed |

The 3.7 property test (`test/unit/core/property.test.ts`, 40 seeds × 400
steps, random entropy per call) runs in about a second. `RoomDriver`
supplies deterministic per-call entropy (`mix32(call count)`) so tests
replay exactly. The run-to-run secrecy test
(`test/unit/core/secrecy-runs.test.ts`, 2 × 150 seeds) takes about a
second.

After phase 3 unit 3a, recorded 2026-11-23 (core reducer: lobby, briefing,
draw, with decisions 0023–0025 and review rounds 1–3's fixes), Linux (WSL2), node v24.14.0, wrangler 4.166.0,
`@cloudflare/vitest-plugin` 1.9.0, vitest 5.1.1, same `node_modules` as the
phase-1 baseline below. The reducer's unit tests pass `now` explicitly, so
they need no fake timers: the reducer reads no clock.

| Leg | Command | Result |
|---|---|---|
| types drift | `npm run types:check` | up to date |
| typecheck | `npm run typecheck` | 5 configs, 0 errors |
| unit | `npm run test:unit` | 22 files, 277 tests passed |
| DO | `npm run test:do` | 2 files, 17 tests passed |
| plan | `npm run plan:check` | consistent, 181 stages |
| gate | `npm run check` | exit 0 |
| E2E | `npm run test:e2e` | 6 tests passed |

After phase 2 (pure leaves) and its review rounds 1–2: unit 16 files / 192
tests, DO 2 files / 17 tests, plan 181 stages, E2E 6 tests.

Phase-1 baseline (2026-11-23, after review round 3) from
`rm -rf node_modules dist .wrangler && npm ci` ("added 127 packages … found 0
vulnerabilities"): unit 5 files / 26 tests, DO 2 files / 17 tests, plan 179
stages, E2E 6 tests (Chromium 159.0.8154.6, Playwright 1.65.1). The unit and
DO legs together (`npx vitest run`) passed 43 of 43 on three consecutive runs.

## Dependency versions

Every direct dependency is pinned to an exact version in `package.json`, and
a version must have been published **at least a few days** before it is
adopted (check with `npm view <pkg> time --json`). A same-day release has had
no time for a bad publish to be noticed and pulled. On 2026-11-23 that moved
wrangler from 4.167.0 to 4.166.0, `@cloudflare/vitest-plugin` from 1.9.1 to
1.9.0 and `@cloudflare/workers-types` from 5.20261124.1 to 5.20261120.1. Every
other direct dependency was already older; the newest of them is vitest 5.1.1,
published 2026-11-18.

`qrcode.react` 4.2.0 (unit 4b, the lobby QR; named by decision 0002) was
published 2024-12-11 and is the latest release; it has no dependencies and
a React `^16.8 || … || ^19` peer range. After changing
`wrangler`, run `npm run types`.
