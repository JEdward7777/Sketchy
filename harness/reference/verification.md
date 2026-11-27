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
- **Word source:** rooms deal from the real `DeckDO` singleton unless a
  test swaps in a scripted or failing source with `setWordSourceForTests`
  (`src/worker/words.ts`); reset it after each test. Deck tests
  (`test/do/deck.test.ts`) address their own `DeckDO` names, so they never
  move the singleton's position, and script the shuffle's swaps with
  `setDeckRandomForTests` (`src/worker/deck-do.ts`; the deck itself
  draws every swap from the CSPRNG, never a seed). A throw out of a DO
  RPC method is also reported as an unhandled rejection, which fails the
  run, so a test that expects `deal` to throw calls it inside
  `runInDurableObject`.
- **Phase 6 helpers** (`test/do/round-helpers.ts`): `briefingRoom(n)`
  (scripted deal: `SECRET` first, other words after, since a used word is
  re-dealt), `strokesFor(i)` stub drawings, `fireUntil`, and the frame
  recording checks `assertRecordedSecrecy` (word, faker role, tokens,
  strokes, drawing-before-slideshow, byte-identical `state` runs over
  every socket) and `captureConsole` / `assertLogsClean` (no log line
  names the word, the faker's id or name). `test/do/round-a.test.ts` runs
  3- and 10-player rounds briefing → vote end; `test/do/drawings.test.ts`
  covers intake (a frame of exactly `FRAME_MAX_BYTES`, 1 MB since
  decision 0031, is kept; one byte more is `too_large`), delivery, the
  faker cancel and eviction mid-phase.
- **Phase 7 helpers** (`test/do/game-helpers.ts`, `test/do/game-secrecy.ts`):
  `newGame(n, words)` (a scripted deck of same-length words, so none is a
  substring of another, optionally with `alt`s; `n` players plus an unbound
  watcher), `playRound(game, plan)` (briefing → round results through each
  player's own socket, the plan written relative to whoever the room
  picked as faker: drawers, votes, locks, guess, judgments, hooks
  `duringDraw` / `beforeVotes` / `atUnmask`, `stopAt`), `continueRound`,
  `close` / `drop` / `rejoin` / `joinLate`, `openDisplay`, and `section5`,
  the §5 table written out again in the test (not `scoreRound`) to check
  every round's points. Ordering is by barrier, never by predicate: `sync`
  sends a `ping` on each sender and then on the watcher and waits for the
  `pong`s, so `watch.lastState()` is then the room's state; `dealt` polls
  out `dealing` (the deck answers in its own event; firing the alarm there
  would re-deal); `fireUntil` / `fireTo` fire the alarm until the state
  matches. `assertGameSecrecy(sockets, tokens, truth)` is phase 6's
  recording check carried over whole games: per round (truth from the
  scripted deal and the unmask `state`, never from the frames checked),
  the word only in that round's roster agents' own `private` (a round view
  only on the roster) until the socket has
  seen the `state` that resolves the round (a round ended by `host:end`
  never), `round.faker` null before unmask, the faker role only on that
  round's faker, tokens and strokes as before. `assertLogsCleanOfGame`
  checks every word, alt, faker id and player name against the log.
  `test/do/game-full.test.ts` (3 × 2 cycles and 10 × 1 cycle to final
  results, Play again, duplicate continues, results auto-continue),
  `game-edges.test.ts` (§5 and 0013 cases), `game-fairness.test.ts`
  (removal and return, pause and resume, no pause after unmask, host claim,
  `host:end`), `display.test.ts` (7.11) and `budget.test.ts` (7.10, its
  counts asserted as expressions in `P` and `R`). Every random faker is
  handled: a test that drops "an agent" picks one who is neither the faker
  nor the host.
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
- **Round leg (phase 8)**, `test/e2e/round.spec.ts` with
  `test/e2e/round-helpers.ts`: three contexts, Custom draw 15 s, every
  WebSocket frame recorded per context (`recordFrames`). Roles and the
  word come from each context's own `private` frames, so it is the same
  test whoever the room picks as faker. It checks: the faker's frames
  never carry the word (every string value, whole-word match, the room
  `code` excepted since a 4-letter word can equal it by chance); no DOM
  string outside a held envelope contains the faker line, and one that
  contains the word passes only if the faker's DOM showed that exact
  string too (the deck has words like "envelope" and "eraser" that are
  also interface text); the closed envelope's markup is identical on every
  phone; hold reveals, release and `blur` hide; the host's envelope press
  sends no `host:hold` and a tap elsewhere does; Continue sends
  `host:next` with the shown `seq`; strokes sent by Done, by Done after
  Clear (an empty list), and by the deadline reach every other context as
  exactly that list in a `drawing` frame after the slideshow `state`.
  It also compares every player's briefing and draw markup with names,
  digits and the host's footer removed (`roleBlindMarkup`): one set for
  everyone, faker included.
- **Draw layout and lost submissions (phase 8 review round 1)**,
  `test/e2e/draw-layout.spec.ts`: contexts at 360×640, 375×667 and
  667×375 (landscape) assert the whole Done button, the 4:3 canvas (not
  overlapping the tools, over 40% of the viewport) and no page scroll,
  also with the "reconnecting" banner showing (new sockets refused through
  an init script, open ones closed with a plain `close()`, which the room
  answers with 1000 since O-17). Then one context's `draw:done` is swallowed and its
  socket closed: the client sends it again on the next socket, the room
  lists the player done, and the others receive exactly that drawing.
  Also (review round 2): a 90 px block pushed in above the canvas
  mid-stroke, after which the stroke still ends at the grid point under
  the pointer (±1), and focus back on Clear after "Keep it".
- **Evidence leg (phase 9)**, `test/e2e/evidence.spec.ts`: four
  contexts, Custom draw 10 s / slide 2 s / vote 40 s / guess 5 s, every
  frame recorded. A non-faker, non-host context (picked from its own
  `private` frames, so the faker-disconnect cancel of §7 never fires) is
  closed at the start of the draw and is a "went dark" card on every other
  phone. Round 1: at instants 0.6–1.4 s into a slide every context's
  `data-slide` equals `floor((now − startsAt) / perSlide)` and shows the
  same artist; a vote, a vote change and a lock in one context show as
  (sealed) chips in all; no context has a vote button on its own row or
  card; browse flips by Prev/Next, ArrowRight and a swipe (which sends no
  `vote:set`); tapping a drawing votes; the last connected lock ends
  browse well before its timer. Round 2: everyone locks mid-slideshow and
  unmask starts before the slideshow's `endsAt` (0016). Frames: every
  slideshow `state` after the first changes votes, locks, players or
  pause (never a per-slide tick), no more of them than vote intents + 2,
  no `state` carries `strokes`/`points`, no `error` frames. DOM samples
  during slideshow and browse: never the faker line; the word or "faker"
  only in strings both roles saw.
  Review round 1 added: the host context's `Date.now` runs
  `CLOCK_SKEW_MS` (7 s) fast through an init script and still shows the
  same slide (the measured offset corrects it); the current segment's fill
  is within 15% of the time into the slide in every context; slideshow
  `state` frames are bounded by the vote intents sent while the slideshow
  was up and are fewer than `cards × 2`; a double-tapped Lock sends one
  `vote:lock`; each canvas's backing store equals its client size × DPR
  (capped at 3); at 568×320 every card's artist name fits and the
  "Your suspect" pill does not overlap the drawing; a 20-character name
  ellipsizes inside its tag. Review round 2: no string value in any frame
  a faker received during their round carries that round's word (`code`
  excepted), so the faker's DOM is a sound control. A DOM string that is
  just the word (case, punctuation, a plural or an `alt` stripped) always
  fails; any other string holding the word passes only if the faker saw
  it, the other round (a different word) showed it, or it is a whole
  quoted or JSX-text literal in `src/client` (the word can be "change",
  which the lock bar says only to players who have voted). A mutation
  rendering the private word on the evidence screen fails the spec. Contexts get a 15 s default action timeout,
  so a missing control fails with its name instead of hanging.
  `lobby.spec.ts` and `draw-layout.spec.ts` now wait for the `evidence`
  screen instead of the placeholder.
- **Results leg (phase 10)**, `test/e2e/results.spec.ts`: three
  contexts play a whole game (1 cycle × 3 agents = 3 rounds; Custom draw
  20 s / slide 1 s / vote 30 s / guess 20 s: judging uses the guess timer too, and the round-2 checks and screenshots must fit inside it) to the podium and back, every
  frame recorded, roles and words from each context's own `private`
  frames, every step written relative to whoever is faker (the host
  included). Every round: everyone locks mid-slideshow, then every
  context's unmask board shows each voter's target and whether it caught
  the faker, and the same `faker-reveal`; in the guess phase only the
  faker has the field, the others the waiting state, everyone the
  category. Round 1: the faker types the word in capitals → `auto`, no
  `judging` state ever, the word in `results-word`, every scoreboard row's
  score and this-round gain equal to the room's; results then continue on
  their own (no `host:next`/`host:hold` sent but the next briefing's).
  Round 2: `<word>qq` → judging; only non-faker contexts have Accept /
  Reject, the faker gets its own notice, the count reads 0 → 1 of 2 in all,
  one accepts and one rejects, and the 1–1 tie is accepted ("a tie goes to
  the faker"). On results the host taps the page: one `host:hold`, the
  fill start moves to ≥ tap + `HOLD_REARM_MS` − 2 s with the beat kept,
  status "On hold", still up past the original `continueAt`; Continue
  sends the shown `seq`. Round 3: no guess → `none`; "Final results";
  the podium's places and steps match `final.standings`; Play again only
  for the host, "waiting" elsewhere; a non-host saves its own drawing and
  another agent's as downloads named `sketchy-<name>-round-<no>.png`
  (Web Share removed by an init script), each a PNG of 1600×1200; Play
  again (shown `seq`) returns every context to the lobby with scores 0.
  Results and final at 568×320 have no sideways scroll.
  Review round 1 added: in every guess phase all contexts can flip the
  drawing browser through all three cards (each a drawing, wrapping back
  to the first, no vote buttons), and a judge can during judging; at
  568×320 the faker's guess field is fully on screen without scrolling;
  two clicks on Accept in one task send exactly one `guess:judge`.
  Review round 2: the browser's vote chips sit in a footer under the
  picture; with 8 cloned chips added to a card (9 votes) at 568×320 and
  360×740 the artist's name still shows its first 3 characters and no
  chip is clipped by the card (fails with the chips back in the header);
  at 568×320 both judge buttons are fully on screen without scrolling
  (guess and judging drop the app header there and put the drawings in a
  right column).
  Unit: the PNG canvas is freed after encoding, `share()` is called
  synchronously (before `savePng` awaits) with a title naming the artist. Secrecy: the
  faker's received frames before the state resolving the guess never
  hold the word (`code` excepted); DOM samples from unmask, guess and
  judging (envelopes closed) never show the bare word, and a string
  holding it must also appear in the faker's DOM, another round's, or as a
  whole client literal (helpers moved to `test/e2e/secrecy-helpers.ts`,
  shared with the evidence leg). A mutation rendering a judge's private
  word on the judging screen fails it. Evidence leg now waits for the
  `unmask` / `results` screens and the host's `host-continue`, and takes
  its round-2 DOM sample before the last lock (that lock opens unmask,
  where the faker is public by design).
- **Fairness leg (phase 11)**, `test/e2e/fairness-drops.spec.ts` and
  `test/e2e/fairness-seats.spec.ts` with `test/e2e/fairness-helpers.ts`:
  3–4 contexts per test, Custom draw 120 s (so every drop lands inside the
  draw) / slide 1 s / vote 30 s / guess 5 s, 1 cycle. A dropped phone is a
  closed context (`closeAgent`, which first reads its stored token); the
  same phone coming back is a new context whose init script writes that
  token (`reopenAgent`), so the room sees a `rejoin`. One frame log per
  agent spans every context it opened. Who drops is picked from the
  contexts' own `private` frames (`roles`), so each test holds whoever the
  room picks. 11.7.1: round 1 played for non-zero scores, then an agent and
  the faker reload mid-draw: same id and scores, the mini envelope shows the
  word / the faker line, no `scrubbed` state and no `connected: false` ever
  recorded (the blip grace). 11.7.2: four agents, the faker's context closes
  in the draw: every other context shows `scrubbed` with its countdown,
  progress unchanged, the card naming nobody and never saying "faker", then
  a new round whose faker is not the dropped one. 11.7.5: three agents, a
  non-faker non-host drops: the pause screen (focused, the screen underneath
  `inert` with the header, the draw countdown frozen, End game only for the
  host), a late joiner makes the 0025 restart wait appear, and the token
  rejoin resumes the same round before it, focus back on Done. 0010: the
  host's context closes; every other context is offered the claim; the
  claimer's header menu counts the dark host and removes them, and the
  dialog passes `layoutProblems` at every `SIZES` viewport.
  `fairness-layout.spec.ts` (review round 1): `layoutProblems` (the box
  inside the viewport, no two of its parts overlapping, no chip name
  squeezed to 0 width, no chip part spilling out, and a guard that the
  selectors matched something) on the pause card at 320×568, 360×640,
  568×320 and 740×360, first for the host with a pending "Rejoin as…"
  request and a dark agent, then, after Let in and the host's drop, for an
  agent with the claim on the pause screen. Reverting the chip CSS makes it
  fail ("chip name squeezed", "spills out of its chip"). 11.7.3:
  four agents; after round 1 a non-faker non-host drops in round 2's draw;
  the host removes them from the header menu (score kept); the round ends
  with their scoreboard row `data-removed` at the same score and opacity
  below 1; the token rejoin at results reinstates them (same score) and the
  next round seats them with their envelope. 11.7.4: a fourth context joins
  during round 1's draw: on deck, no private round view, off the roster,
  `total` unchanged; seated with an envelope from round 2. Every test ends
  with `assertFramesSecret` (word only in non-faker `private`, one faker per
  round, `round.faker` null before unmask, no `state` with the word before
  the result, nothing the faker received carries the word before the
  resolving state) and most with `assertDomSecret` (no faker line, no bare
  word, the word only inside whole client literals).
- **Screenshots:** `SKETCHY_SHOTS=<dir> npx playwright test test/e2e/round.spec.ts test/e2e/draw-layout.spec.ts` (and `results.spec.ts` for unmask, guess, judging, results and the podium; the three `fairness-*.spec.ts` for the pause, scrubbed, host menu, claim and on-deck screens)
  writes phone-size light and dark screenshots of the briefing, held
  envelope, draw (portrait, landscape, reconnecting) and waiting screens there (`shot`); without the variable
  nothing is written.
- Local only; nothing is deployed.

## Baseline

Recorded 2026-11-27 after phase 10 (client unmask, guess, judging, round
results with the host continue, final podium, Play again, Save my
drawing), same machine and versions as below:

| Leg | Command | Result |
|---|---|---|
| typecheck | `npm run typecheck` | 5 configs, 0 errors |
| unit | `npm run test:unit` | 45 files, 539 tests passed |
| DO | `npm run test:do` | 13 files, 98 tests passed |
| plan | `npm run plan:check` | consistent, 181 stages |
| gate | `npm run check` | exit 0 |
| E2E | `npm run test:e2e` | 15 tests passed, 3 consecutive full runs (about 2.6 min each); `results.spec.ts` about 55 s |

Recorded 2026-11-27 after phase 9 (client evidence: synced slideshow,
went-dark cards, live vote chips, lock-in, free browse), same machine and
versions as below:

| Leg | Command | Result |
|---|---|---|
| typecheck | `npm run typecheck` | 5 configs, 0 errors |
| unit | `npm run test:unit` | 43 files, 515 tests passed |
| DO | `npm run test:do` | 13 files, 98 tests passed |
| plan | `npm run plan:check` | consistent, 181 stages |
| gate | `npm run check` | exit 0 |
| E2E | `npm run test:e2e` | 14 tests passed, 3 consecutive full runs (about 1.8 min each); `evidence.spec.ts` about 43 s |

Recorded 2026-11-27 after phase 8 (client briefing and draw: envelope,
host continue with throttled holds, canvas, tools, stroke capture,
auto-submit, resend of an unconfirmed drawing, waiting screen, drawing buffer; after review round 1), same machine and versions as
below:

| Leg | Command | Result |
|---|---|---|
| types drift | `npm run types:check` | up to date |
| typecheck | `npm run typecheck` | 5 configs, 0 errors |
| unit | `npm run test:unit` | 42 files, 499 tests passed |
| DO | `npm run test:do` | 13 files, 98 tests passed |
| plan | `npm run plan:check` | consistent, 181 stages |
| gate | `npm run check` | exit 0 |
| E2E | `npm run test:e2e` | 13 tests passed; `round.spec.ts` and `draw-layout.spec.ts` together passed 3 consecutive runs (about 25 s each) after review round 1 |

Recorded 2026-11-27 after phase 7 (server loop B through real sockets:
whole 3- and 10-player games to final results and Play again, every §5
edge case, removal, pause, host claim, `host:end`, display sockets,
measured budget), same machine and versions as below:

| Leg | Command | Result |
|---|---|---|
| types drift | `npm run types:check` | up to date |
| typecheck | `npm run typecheck` | 5 configs, 0 errors |
| unit | `npm run test:unit` | 40 files, 454 tests passed |
| DO | `npm run test:do` | 13 files, 96 tests passed (5 consecutive runs green, 8–10 s each) |
| plan | `npm run plan:check` | consistent, 181 stages |
| gate | `npm run check` | exit 0 |
| E2E | `npm run test:e2e` | 11 tests passed |

Recorded 2026-11-26 after phase 6 (server loop A: drawing intake with
`too_large`, `drawing` frames from the slideshow on per decision 0030,
3- and 10-player DO runs briefing → vote end with per-socket frame
recording and console capture, eviction mid-phase), same machine and
versions as below:

| Leg | Command | Result |
|---|---|---|
| types drift | `npm run types:check` | up to date |
| typecheck | `npm run typecheck` | 5 configs, 0 errors |
| unit | `npm run test:unit` | 40 files, 449 tests passed |
| DO | `npm run test:do` | 8 files, 71 tests passed |
| plan | `npm run plan:check` | consistent, 181 stages |
| gate | `npm run check` | exit 0 |
| E2E | `npm run test:e2e` | 11 tests passed (2 of 4 runs had the mid-round "Rejoin as…" test time out in `dealing`: stale local DeckDO tables, observation O-15) |

Recorded 2026-11-26 after phase 5 and its review round 1 (global deck:
`DeckDO` with a stored CSPRNG shuffle and a position per difficulty,
exclude, reshuffle, flagged repeat when every word is excluded per
decision 0028; rooms deal from it over RPC; the words.json check, alts
included), same machine and versions as below:

| Leg | Command | Result |
|---|---|---|
| types drift | `npm run types:check` | up to date |
| typecheck | `npm run typecheck` | 5 configs, 0 errors |
| unit | `npm run test:unit` | 39 files, 443 tests passed |
| DO | `npm run test:do` | 6 files, 60 tests passed |
| plan | `npm run plan:check` | consistent, 181 stages |
| gate | `npm run check` | exit 0 |
| E2E | `npm run test:e2e` | 11 tests passed |

The E2E lobby leg's mid-round test now deals from the real `DeckDO`
under `wrangler dev` (no test seam there).

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

After phase 11 review round 1 (2026-11-27): unit 46 files / 548 tests, DO 13
files / 98 tests, plan 181 stages, E2E 22 tests (the seven fairness tests
passed on three separate runs, one of them the full suite).

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
