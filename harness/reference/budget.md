# Free-tier budget

Limits checked against Cloudflare's docs on **2026-11-23** (stage 1.7). Each
figure quotes the page it came from. Re-check when a limit starts to matter;
Cloudflare changes these.

Sources:

- [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers WebSockets API](https://developers.cloudflare.com/workers/runtime-apis/websockets/)
- [DO WebSockets best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [DO alarms API](https://developers.cloudflare.com/durable-objects/api/alarms/)

## Limits (Workers Free plan)

| What | Limit | Source, quoted |
|---|---|---|
| Worker requests | 100,000 / day | Workers limits: 100,000 requests a day, resetting at midnight UTC; over it returns error 1027 |
| Static asset requests | free, unlimited | Workers pricing: "Requests to static assets are free and unlimited." |
| Worker CPU | 10 ms per HTTP request | Workers limits |
| Worker WebSocket connection | 1 request | Workers pricing: "WebSocket connections made to a Worker are charged as a request." |
| DO requests | 100,000 / day | DO pricing, Free: "100,000 / day" |
| What counts as a DO request | HTTP, RPC, WS messages, alarms | DO pricing: "Includes HTTP requests, RPC sessions, WebSocket messages, and alarm invocations." |
| Inbound WS messages | 20 messages = 1 request | DO pricing: "a 20:1 ratio is applied to incoming WebSocket messages" |
| Outbound WS messages | free | DO pricing: "There is no charge for outgoing WebSocket messages" |
| DO duration | 13,000 GB-s / day | DO pricing, Free: "13,000 GB-s / day" |
| Duration memory | 128 MB per awake object | DO pricing: "charges for the 128 MB of memory your Durable Object is allocated, regardless of actual usage" |
| Duration under hibernation | none | DO pricing: "Durable Objects that are idle and eligible for hibernation are not billed for duration." |
| Duration with `ws.accept()` | whole connection | DO pricing: "Calling accept() on a WebSocket in an Object will incur duration charges for the entire time the WebSocket is connected." |
| SQLite rows read | 5 million / day | DO pricing, Free |
| SQLite rows written | 100,000 / day | DO pricing, Free |
| `setAlarm()` | 1 row written | DO pricing: "Each setAlarm() is billed as a single row written." |
| DO storage, account | 5 GB total | DO pricing ("5 GB (total)") and DO limits |
| DO storage, per object | 10 GB in the table; the FAQ says 1 GB on Free | DO limits; the page contradicts itself. Plan on 1 GB. |
| Storage key + value | 8 MB combined | DO limits: "Key and value combined cannot exceed 8 MB" |
| SQL string / BLOB / row | 8 MB | DO limits: "Max string, BLOB, or table row size: 8 MB" |
| SQL statement length | 100 KB | DO limits: "Max SQL statement length: 100 KB" |
| SQL bound parameters | 100 per query | DO limits |
| WS message size, received | 32 MiB | Workers WebSockets: "WebSocket messages received by a Worker have a size limit of 32 MiB (33,554,432 bytes)"; DO limits: "32 MiB (only for received messages)" |
| WS message size, sent | not stated | Neither page gives a limit for messages a Worker or DO sends. Unverified. |
| Serialized socket attachment | 16,384 bytes | DO WebSockets: "Maximum serialized size is 16,384 bytes." |
| Alarms per object | 1 | DO alarms: "Each Durable Object is able to schedule a single alarm at a time"; calling `setAlarm` again "will override the existing alarm" |
| Alarm retries | up to 6, exponential backoff, on an uncaught exception | DO alarms |
| DO classes | 100 (Free) | DO limits |
| Storage backend | SQLite only | DO limits: "Workers Free plan: Only Durable Objects with SQLite storage backend are available." |
| Over a limit | operations fail | DO pricing: "If you exceed any one of the free tier limits, further operations of that type will fail with an error." |

## Per-game estimates

The expressions below were the stage 1.7 estimate; **"Measured in phase 7"**
further down replaces them with counts from whole games through real
sockets. Symbols:

| Symbol | Meaning |
|---|---|
| `P` | players in the room |
| `R` | rounds in the game (`cycles × roster at start`, decision 0020) |
| `C` | WebSocket connects per player per game (`1 + reconnects`) |
| `k` | `ping` messages per connect (clock-offset probe; count set by stage 2.x) |
| `V` | `vote:set` messages per player per round (vote changes) |
| `J` | `guess:judge` messages per round (`0` on an exact guess, at most `P − 1`) |
| `h` | host taps per round (continue, next) |
| `L` | lobby messages per game (join, settings, start) |
| `A` | alarm invocations per round (one per phase deadline that fires) |
| `w` | SQLite rows written per handled message (set by how phase 3/6 persist state) |
| `T` | game length in seconds |

**Inbound messages per round** (client → room, the billed direction):

```
m_round = P            draw:submit
        + P × V        vote:set
        + P            vote:lock (at most)
        + 1            guess:submit
        + J            guess:judge
        + h            host taps
        = P × (2 + V) + 1 + J + h
```

**Inbound messages per game:** `M = R × m_round + C × P × (1 + k) + L`
(`hello` plus pings on every connect).

**DO requests per game:** `ceil(M / 20) + C × P + R × A + 1` (+ `R` deck
RPCs since phase 5, below)
— messages at 20:1, each WebSocket upgrade is an HTTP request to the room,
each fired alarm is a request, plus the room-creating request (more if a code
collides, decision 0007 item 1). Outbound broadcasts, including the state
rebroadcast after every `vote:set`, cost nothing.

**Worker requests per game:** `C × P + 1` (WebSocket upgrades plus room
creation; static assets are free).

**SQLite rows written per game:** `w × M + R × A` at most (each `setAlarm` is a
row; `armAlarm` skips a write when the alarm is unchanged).

**Duration:** zero while hibernating. An upper bound if the room never
hibernated is `0.125 GB × T` GB-s per game.

### What binds first

Evaluated for one illustrative large game, to show which limit matters, not
as a measurement: `P = 10`, two cycles so `R = 20`, `V = 3`, `J = 9`, `h = 1`,
`C = 2`, `k = 5`, `L = 3 × P`, `A = 7`, `T = 3600`.

- `m_round = 10 × 5 + 1 + 9 + 1 = 61`; `M = 20 × 61 + 2 × 10 × 6 + 30 = 1,370`
- DO requests `= ceil(1,370 / 20) + 20 + 140 + 1 = 230` → `100,000 / 230 ≈ 434` games a day
- Worker requests `= 21` → thousands of games a day
- Rows written `= 1,370 × w + 140` → `100,000 / 1,510 ≈ 66` games a day at `w = 1`,
  `≈ 34` at `w = 2`
- Duration bound `= 0.125 × 3,600 = 450` GB-s → `13,000 / 450 ≈ 28` games a day
  only if the room never hibernates; hibernation makes it far smaller

**As built in unit 4a:** each handled event (intent, socket close, alarm)
upserts one `room` row, so `w = 1`; `hello` and `ping` write nothing.
On top of that: a `draw:done` writes one `drawings` row (and the stored
flag rides in the same `room` upsert); `setAlarm` writes one row only when
the earliest deadline moves (`armAlarm`); each round's deal arms the
`DEAL_RETRY_MS` retry and then moves back, `2` alarm rows per round, plus
one more `room` row for the `wordDealt` event.

**A deal that never yields a usable word** (the source fails, or keeps
answering used words) backs off: retry `n` waits at least `dealBackoff(n) =
min(2 s × 2^n, 5 min)` (longer when used-word answers advance `attempts`
several steps per retry). A failing source costs per retry 1 `room` row (the
tick) + 1 alarm row; a used-word source at most `MAX_DEALS_PER_EVENT` = 2
calls per retry, so 1 + 2 `room` rows + up to 3 alarm rows = 6. The ramp
`2 + 4 + … + 256 s` takes 8 retries and 510 s, then one per 300 s, and the
room expires `ROOM_EXPIRY_MS` after the last player action (dealing is not
activity), so a stuck room makes at most `8 + (7,200 − 510) / 300 ≈ 31`
retries, ≤ `31 × 6 ≈ 190` rows, in its life. Before the review fix it was
8 calls per 2 s, never expiring (`≈ 10 rows / 2 s ≈ 430,000 / day`).

**The global deck (phase 5).** Each deal is one RPC from the room to
`DeckDO` (one DO request, "RPC sessions" above) that reads one `deck_pos`
row and upserts one: `R` more DO requests and `R` more rows written per
game (a re-deal of a used word would add one each, but the deck honours
`exclude`, so the reducer has no used word to refuse). A reshuffle writes
one more row (the new `deck_order`), once per `count` deals of a
difficulty (80 to 200 today), so under `1 / 80` of a row per deal; the
order is read from SQLite once per instance and then cached. The
illustrative game above becomes
`230 + 20 = 250` DO requests (`100,000 / 250 = 400` games a day) and
`1,510 + 20 = 1,530` rows at `w = 1` (`≈ 65` games a day). The deck is one
object for every room, so its own budget is the same rows summed over all
games: `100,000 rows / day ÷ (1 + 1/80) rows per deal` caps it near
98,000 deals a day, far above the room-side limits. A deal that never succeeds (deck
unreachable) costs the room as before, plus nothing on the deck.

**A failing alarm** re-arms after `FAILED_ALARM_RETRY_MS` = 60 s: at most
`1,440` alarms and setAlarm rows a day per broken room, until the stored
expiry passes and the adapter clears it (≤ 2 h, so ≤ 120).

**Room creation is unauthenticated.** Each `POST /api/room` is one Worker
request plus one DO request per code tried, and the new room writes 1
`room` row + 1 alarm row, then sits idle for `ROOM_EXPIRY_MS`. Nothing
limits a client that loops on it; observation O-12 proposes a rate limit.

So **rows written is the limit to design around**, not requests: persisting
state once per message is the floor (`w ≥ 1` per state-changing message), and
splitting state across several rows multiplies it. Phase 3/6 should keep `w`
at 1 for the common messages (`vote:set`), and the projection in phase 7
should replace this estimate with a count from a scripted game (done: "Measured in phase 7" below).

## Measured in phase 7 (stage 7.10)

From `test/do/budget.test.ts`, which plays whole games through real sockets
(3 players × 2 cycles, `R = 6`; 10 players × 1 cycle, `R = 10`) and
**asserts** each expression below, so a change that moves a count fails the
DO leg. It counts the room's own storage calls by spying on `RoomStore`
(`save`, `storeDrawing`, `clearDrawings`) and on the storage prototype's
`setAlarm`; the DO shares the tests' isolate. Print the raw numbers with
`npx vitest run --project do test/do/budget.test.ts --silent=false`.

**The baseline round** (what the test plays): the host taps the briefing
and round-results continues, every player draws once, sets one vote and
locks it, and the faker's exact guess auto-accepts. Every other deadline is
ended early, so the only alarm that fires is the unmask beat.

| Per game (baseline round) | Measured expression | `P = 10`, `R = 20` |
|---|---|---|
| Inbound game intents | `R × (3P + 3) + 2` (`P` each of `draw:done`, `vote:set`, `vote:lock`; one `guess:submit`; two `host:next`; plus settings and start) | 662 |
| Alarms fired | `R` | 20 |
| Deck deals (RPC to `DeckDO`) | `R` | 20 |
| `room` rows written (one per handled event: intent, fired alarm, dealt word) | `R × (3P + 5) + 2` | 702 |
| `drawings` rows written | `R × P` | 200 |
| `drawings` rows deleted (when the next round starts) | `(R − 1) × P` (the last round's `P` go at Play again or expiry) | 190 |
| Alarm rows (`setAlarm`) | `7R + 1`: the alarm moves at each of the round's 7 timed phases (dealing's retry, briefing, draw, slideshow, unmask, guess, results), then once to the expiry at final results | 141 |
| Lobby: create + `P` joins | `P + 1` `room` rows, and `1` to `P + 1` alarm rows (the test's pinned clock gives 1; at a live clock every join pushes the §14 expiry to a new instant) | 11 + ≤ 11 |
| Deck rows (on `DeckDO`) | `R` upserts, plus one per reshuffle (≤ `1/80` per deal) | 20 |

Variations, from the same accounting (each event is one `room` row): a vote
change is `+1` intent and row; a judged guess adds `J` intents and rows and
one alarm row (the judging phase), `+1` fired alarm if it runs to its timer;
a continue left to the auto-continue instead of tapped is `−1` intent and
`+1` fired alarm (rows unchanged); a phase that runs to its timer instead of
ending early is `+1` fired alarm and row. `hello` and `ping` touch no
storage, so a reconnect costs one row, its `rejoin` intent; a disconnect is
one row (the close event) and, once the blip grace runs out, one more (the
alarm), plus an alarm row when the grace is the earliest deadline.

**Rows written per game**, the binding limit, summing the table with deletes
counted as writes: `R × (5P + 13) + P + 5` at most (`P + 1` lobby alarm
rows) for a game with no reconnects. The illustrative game (`P = 10`,
`R = 20`) is `20 × 63 + 15 = 1,275` rows → `100,000 / 1,275 ≈ 78` games a
day, against the stage 1.7 estimate of `1,530` (`≈ 65`). With every round
judged by all `P − 1` agents and running to the judging timer, add
`R × (P + 1)` rows (`P − 1` judgments, the judging phase's alarm row, the
fired alarm's row): `1,495` (`≈ 66` a day).

Two terms the baseline test does not play, from the same accounting:

- **Connections** (`C` connects per player): each of the `(C − 1) × P`
  reconnects costs at most 5 rows: the close event's `room` row, the
  `rejoin` intent's row, up to 2 alarm rows (the alarm moves to the blip
  grace when it is the earliest deadline, and back), and the fired grace
  alarm's row if the player was gone past `BLIP_GRACE_MS`. So add
  `≤ 5 × (C − 1) × P`: 50 at `C = 2`.
- **Expiry** (§14): `deleteAll` removes the `room` row and the last
  round's `P` drawing rows, and the alarm is deleted: about `P + 2` more
  (whether Cloudflare bills a `deleteAll` per row is not stated; counted
  per row here as an upper bound). A Play again clears the `P` rows
  earlier instead.

With both, the illustrative game at `C = 2` is about `1,275 + 50 + 12 =
1,337` rows (`≈ 75` games a day).

**DO requests per game:** inbound messages are `R × (3P + 3) + 2` intents
plus `C × P × (1 + k)` `hello`s and pings, billed at 20:1; plus `C × P`
WebSocket upgrades, the fired alarms (`R` to about `7R` when every phase
runs to its timer), `R` deck RPCs and 1 create. Illustrative game with
`C = 2`, `k = 5`: `ceil((662 + 120) / 20) + 20 + (20 to 140) + 20 + 1 =
101` to `221` → 450 to 990 games a day. Requests do not bind.

**Outbound (free, for memory and phone data):** each socket gets one `state`
frame per event that changes public state, about one per `room` row: a
player's socket received 89 frames for `R = 6, P = 3` (86 game rows) and 363
for `R = 10, P = 10` (352), the rest being lobby joins. A `state` frame was
at most about 1,100 bytes at `P = 3` and about 2,500 bytes at `P = 10`
(means about 850 and 1,800; 1,138 / 2,524 and 854 / 1,798 in the recorded
runs, varying with names and timestamps), so about `R × (3P + 5) × 1.8 KB ≈ 1.3 MB` per socket for the
illustrative game, plus `R × P` drawing frames (sizes below). `private`
frames are at most 152 bytes, a few per round.

**Storage per room:** `state.storage.sql.databaseSize` was 20,480 bytes at
final results in both games (SQLite pages; the stub drawings are ~100
bytes). The `room` row is one state JSON of the size of a `state` frame;
the `drawings` table holds at most one round, `P` rows of at most
`STROKES_MAX_BYTES` each, honestly `≤ 10 × 165,631 ≈ 1.7 MB` (the 240 Hz
Relaxed scribble below), and at 0022's 180 s Custom draw maximum
`10 × 180 × 1,841 ≈ 3.3 MB`. Expiry deletes everything (§14), so the 5 GB
account total is reached only by `≈ 1,500` simultaneously live rooms each
holding ten worst-case 180 s drawings (`≈ 2,900` at Relaxed).

**Duration:** unchanged. The room hibernates between events; the DO leg
cannot measure wall-clock billing.

## Drawing payloads (stage 1.7.1, decision 0009)

Measured with `node scripts/measure-strokes.mjs` (deterministic, seeded). The
provisional format, ahead of the codec in stage 2.10 (re-measured in 7.10):

```
{"type":"draw:submit","strokes":[{"c":<color index>,"s":<size index>,"p":[[x,y],...]},...]}
```

Assumptions, as the script's parameters:

- Grid `GRID_W × GRID_H = 800 × (800 × 3 / 4) = 800 × 600`, integer points.
- 8 colors, 3 sizes (`SPEC.md` §9). Every pointer sample is kept: no
  simplification, no duplicate removal, so these are upper bounds per rate.
- Sampling at `60`, `120` and `240` samples per second of pen-down time
  (display refresh rates; coalesced pointer events can deliver more than one
  sample per frame, so 240 stands in for a fast high-refresh phone).
- **Sketch:** strokes of 0.3–2 s at 150–500 grid units/s, pen-up pauses of
  0.2–1.5 s, over a 90 s draw (about 58% pen-down).
- **Scribble:** pen down the entire 90 s, lifted every 2 s, moving at
  800–1200 grid units/s and turning sharply, so coordinates are mostly three
  digits.

| drawing | samples/s | points | JSON bytes (nested) | JSON bytes (flat `[x,y,x,y]`) | bytes / point | bytes / s of drawing | longest draw in one message (s) | longest draw in one storage value (s) |
|---|---|---|---|---|---|---|---|---|
| sketch | 60 | 3,136 | 31,604 | 25,332 | 10.08 | 351 | 95,554 | 22,781 |
| scribble | 60 | 5,400 | 53,605 | 42,805 | 9.93 | 596 | 56,336 | 13,431 |
| sketch | 120 | 6,226 | 61,925 | 49,473 | 9.95 | 688 | 48,767 | 11,626 |
| scribble | 120 | 10,800 | 104,364 | 82,764 | 9.66 | 1,160 | 28,936 | 6,898 |
| sketch | 240 | 12,446 | 122,582 | 97,690 | 9.85 | 1,362 | 24,635 | 5,873 |
| scribble | 240 | 21,600 | 208,864 | 165,664 | 9.67 | 2,321 | 14,458 | 3,447 |

"Longest draw" is `floor(limit / bytes per second)` with the message limit
`32 × 1024 × 1024` bytes and the storage-value limit read as `8 × 10^6` bytes
(the smaller reading of "8 MB").

**Against Relaxed (90 s, `SPEC.md` §8):** the worst row, a 240 Hz scribble,
fits one storage value for `3,447 s ≈ 38 × 90 s` and one message for
`14,458 s`. An honest full-timer drawing fits one message and one storage
value at every preset with a wide margin, so **no chunking is needed**
(decision 0009 item 4). The platform safety limit for stage 6.4 can be set in
bytes, well below `8 × 10^6`, rather than in strokes or points. Custom timers
(`any`, §8) are bounded by bytes, not seconds, so they need no special case.

**Stage 2.10 outcome.** The codec (`src/shared/stroke-codec.ts`) uses the
flat point form (`"p":[x,y,x,y,...]`), the "flat" column above. The grid,
palette and limits live in `src/shared/stroke-format.ts`, which
`scripts/measure-strokes.mjs` now imports (its output is unchanged). The
platform safety limit is `STROKES_MAX_BYTES = STORAGE_VALUE_LIMIT_BYTES / 2
= 4 × 10^6` bytes, and decision 0022 caps the Custom draw timer at
`2 × 90 s = 180 s`, inside the 3,447 s fit, so stage 6.4 does not chunk.
**Superseded by decision 0031 (phase 6 review):** memory binds before
storage, so `STROKES_MAX_BYTES = 1,000,000`. An honest 180 s scribble is
`180 × 2,321 ≈ 417,773` bytes (2.39× margin; 4.79× against the 208,864
of the Relaxed row). Still one row per drawing, no chunking.

**Stage 7.10: re-measured with the real codec.** `node
scripts/measure-strokes.mjs` now encodes the same seeded drawings with
`encodeStrokes`, checks them with `validateWireStrokes` as the room's intake
does, and measures the frames the room handles: the client's `draw:done`,
the stored row, and the `drawing` frame each socket receives (envelope with
a 3-digit round number and `p10`). The 1.7.1 nested size is repeated for
comparison. `simplified` runs `simplifyStroke` (stage 2.10.2, tolerance half
a grid unit) first, which a client may do; the room does not require it.

| drawing | samples/s | strokes | points | pen down | 1.7.1 nested | draw:done frame | stored row | drawing frame | simplified frame (points kept) | bytes/point | bytes/s of drawing | max draw s under STROKES_MAX_BYTES | in one message | in one value |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sketch | 60 | 44 | 3136 | 58% | 31604 | 25330 | 25299 | 25359 | 13951 (54%) | 8.08 | 281 | 3553 | 119222 | 28424 |
| scribble | 60 | 45 | 5400 | 100% | 53605 | 42803 | 42772 | 42832 | 40621 (95%) | 7.93 | 476 | 2102 | 70553 | 16821 |
| sketch | 120 | 43 | 6226 | 58% | 61925 | 49471 | 49440 | 49500 | 20085 (40%) | 7.95 | 550 | 1819 | 61043 | 14553 |
| scribble | 120 | 45 | 10800 | 100% | 104364 | 82762 | 82731 | 82791 | 74377 (90%) | 7.66 | 920 | 1087 | 36488 | 8699 |
| sketch | 240 | 46 | 12446 | 58% | 122582 | 97688 | 97657 | 97717 | 32567 (33%) | 7.85 | 1085 | 921 | 30913 | 7370 |
| scribble | 240 | 45 | 21600 | 100% | 208864 | 165662 | 165631 | 165691 | 132881 (80%) | 7.67 | 1841 | 543 | 18229 | 4346 |

- The codec's frames are the 1.7.1 "flat" column to within the envelope
  (`draw:done` is 2 bytes shorter than the provisional `draw:submit`): the
  codec adds nothing. The stored row is the frame minus its 31-byte
  envelope, and a delivered `drawing` frame is the row plus 60 bytes.
- **Worst honest rate: 1,841 B/s** (240 Hz scribble), 21% under the
  `MEASURED_WORST_BYTES_PER_SECOND` = 208,864 / 90 ≈ 2,321 B/s that
  `src/shared/stroke-format.ts` keeps as its (nested-format) upper bound.
  At 0022's 180 s Custom maximum that is `180 × 1,841 = 331,380` bytes,
  3.0× under `STROKES_MAX_BYTES` (decision 0031); the limit is reached
  only after 543 s of nonstop 240 Hz scribbling.
- Simplification cuts a sketch to 33–54% of its points but a scribble only
  to 80–95% (fast sharp turns leave little within half a grid unit), so it
  does not change the worst case.
- One client's copy of a round is at most `10 × 165,691 ≈ 1.7 MB` of
  `drawing` frames at the worst honest rate and Relaxed timers.

Two consequences for later stages:

- **Bind drawings as SQL parameters, never inline them in SQL text.** A
  statement is capped at 100 KB, and the 240 Hz scribble passes
  `100 × 1000 bytes / 2,321 bytes/s ≈ 43 s` — inside the Relaxed timer.
- **Delivering drawings.** One client's copy of a round is `P × drawing size`,
  at most `10 × 208,864 ≈ 2.1 MB` by the table's worst row; the docs state a
  size limit only for received messages, so the outbound limit for stage 6.5's
  choice is unverified.

**Stages 6.4–6.5 as built (decision 0030).** Intake stores each drawing
in one `drawings` row (no chunking: a frame over `STROKES_MAX_BYTES` is
refused with `too_large`, and the stored text is never longer than its
frame).

**Memory (decision 0031).** The room's isolate has 128 MB. Intake holds
the raw frame (≤ 1 MB as UTF-16, so ≤ 2 MB), its parse, and the stored
JSON string at once; the codec validates the parsed point arrays in place
and the stored strokes reuse them (`validateWireStrokes`), so there is no
per-point tuple and no second copy of the points. At the old 4 MB limit
the reviewer measured a 100–120 MB peak with the tuple-building decoder.
Delivery reads, frames and sends one drawing at a time (`deliverDrawings`
in `src/worker/room-drawings.ts`), so it holds one drawing, not a round. Delivery is one outbound `drawing` frame per submitted card per
socket, sent once per socket per round from the slideshow on:

- Outbound: `P` frames per socket per round, `≤ (P + 1) × P` with one
  observer (free; DO pricing). Each frame is at most `STROKES_MAX_BYTES`
  plus an envelope under 100 bytes, far inside the 32 MiB message limit
  even though the outbound limit is unverified; one frame per card also
  keeps the room from building a whole round's frames at once. The DO leg
  sends a frame of exactly the limit to three sockets in workerd;
  production is untested.
- Inbound: none. A GET per drawing per client would have been `P × P` more
  Worker and DO requests per round (`10 × 10 × 20 = 2,000` per
  illustrative game, against its `≈ 250` DO requests), the reason 0030
  chose the socket.
- Rows: the slideshow-starting event reads the round's `≤ P` rows once, one at a time;
  every later event of the round reads none unless a socket opened since
  (a reconnect reads them again). Rows written: unchanged (the
  `drawings` row per `draw:done` above; the delivered flag lives in the
  socket attachment, which is not SQLite).
