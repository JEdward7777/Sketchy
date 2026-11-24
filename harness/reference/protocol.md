# Wire protocol

Skeleton from stage 1.8, game messages from stage 3.1. The code is the
source of truth: `src/shared/protocol.ts` (`ClientMessage`, `GameIntent`,
`ServerMessage`, `PROTOCOL_VERSION`, `parseClientMessage`) and
`src/shared/core/views.ts` (`PublicState`, `PrivateView`). This file records
the rules the types cannot express. Message sketch: `SPEC.md` §14.

## Transport

- One WebSocket per device, at `/ws/<room code>` on the page's own origin
  (`wss:` on `*.workers.dev`). The Worker routes it to that room's `RoomDO`
  (`env.ROOM.getByName(code.toUpperCase())`, so codes are case-insensitive);
  a request without `Upgrade: websocket` gets 426, a path that does not name
  one room gets 404.
- The room accepts the socket with the hibernation API
  (`ctx.acceptWebSocket`), so it may be evicted between messages. Anything
  the room must remember about a socket lives in its serialized attachment
  (at most 16,384 bytes, `reference/budget.md`) or in storage.
- HTTP endpoints live under `/api/*`; unknown ones return
  `404 {"error":"not_found"}` as JSON, never the HTML shell.

## Envelope

Every frame, in both directions, is one UTF-8 JSON object with a string
`type`. Other fields belong to that type; there is no wrapper object.

```
{"type": "<name>", ...fields}
```

- Names use `noun:verb` for intents (`vote:set`, `guess:submit`) and a bare
  noun otherwise (`hello`, `state`, `private`), as in `SPEC.md` §14.
- Binary frames, non-JSON text, and unknown or malformed types are answered
  with `error {code: "bad_message"}`; the socket stays open (except after a
  version-mismatch close, see below).
- A frame longer than `FRAME_MAX_BYTES` UTF-8 bytes (= `STROKES_MAX_BYTES`,
  the stroke safety limit of decision 0009 item 4) is refused before it is
  parsed, so it is also a `bad_message`. String fields are at most
  `FIELD_MAX_LENGTH` characters.
- Times are absolute epoch milliseconds from the server clock
  (`serverTime`, deadlines). Clients convert with a measured offset; the
  server never sends countdowns.

## Handshake and protocol version

The first message on every socket is `hello`, carrying the client's protocol
version:

```
client → {"type":"hello","v":1}
server → {"type":"welcome","v":1,"serverTime":<epoch ms>}
```

- `v` is `PROTOCOL_VERSION` in `src/shared/protocol.ts`. Bump it on any
  incompatible change to a message shape.
- **Mismatch** (decision 0007 item 8): the room sends
  `error {code: "version"}` and closes the socket with code
  `CLOSE_VERSION_MISMATCH` (4000). The client shows a "new version — reload"
  prompt, updates the service worker and reloads; it keeps its player token,
  so the reload reconnects as the same player.
- A well-formed message other than `hello` sent before a successful `hello`
  gets `error {code: "hello_first"}` (an unreadable frame gets `bad_message`
  instead). After a version mismatch the room has closed the socket, and any
  frames already in flight are ignored without a reply.
- The handshake state is kept in the socket's attachment, so it survives the
  room hibernating (DO-leg test "remembers the handshake across eviction").
- Phase 4 adds identity to the handshake (`join` / `rejoin` with the player
  token, `SPEC.md` §7); it extends this, it does not replace the version check.

## Clock probe

```
client → {"type":"ping","t":<client epoch ms>}
server → {"type":"pong","t":<echoed>,"serverTime":<epoch ms>}
```

The client estimates its offset from the round trip (stage 2.x clock offset).
Each `ping` is a billed inbound message (`reference/budget.md`, symbol `k`),
so probes are a few per connect, never periodic for the whole game.

## Public `state` vs per-socket `private`

The rule that keeps the game fair (`SPEC.md` §14, `harness/AGENTS.md` §5):

- **`state`** is the same for every socket in the room and is broadcast
  whenever it changes. It is built by `projectPublic(state)` (phase 3) and
  **never** contains the secret word or the faker's identity before unmask,
  nor anything from which they can be derived. Tests assert that public state
  is identical whatever the word and faker (stage 3.6).
- **`private`** goes to one socket only, built by `projectPrivate(state,
  playerId)`: the role, plus the word for non-fakers. It is the only message
  that ever carries secret material before unmask, and it is never logged.
- **Drawings** ride in neither: they go out once per client per round
  (decisions 0006, 0009); the mechanism is chosen in stage 6.5.

## Game intents (stage 3.1)

`parseClientMessage` checks structure only; the reducer (`src/shared/core`)
decides everything else and answers a refused intent with `error` to the
sending socket only.

| Intent | Who | Notes |
|---|---|---|
| `join {name, color, icon}` | unbound socket | `color` from `PLAYER_COLORS`, unique in the room, removed players' colors stay reserved (0019); `icon` from `SPY_ICONS`; name trimmed, 1–`NAME_MAX_LENGTH`. Refused at `MAX_PLAYERS`, counting removed players and waiting late joiners. The adapter mints the token (CSPRNG) and passes it as `mintedToken`. |
| `rejoin {token}` | unbound socket | Same player, same score (§7); a removed player is reinstated (0019). |
| `rejoinAs {playerId}` | unbound socket | Only a player with `connected: false` in public state (§7). The adapter mints a token for it, as for `join`. Between rounds (lobby, scrubbed) it binds at once; during a round (dealing onward) it only asks the host and the socket is told `rejoin {status: "pending"}` (decision 0024). Every success rotates the player's token to the minted one, so an earlier device's token stops working. |
| `host:settings {settings}` | host, lobby | Partial: `difficulty`, `cycles` (1–3), `timers` (`quick`/`normal`/`relaxed`/`custom`), `custom` (validated with the 0022 bounds). |
| `host:start` | host, lobby | Needs `MIN_PLAYERS` active players (0011 item 1). |
| `host:next {seq}` | host | Continue now (0004 rule 4). `seq` is the `PublicState.seq` the tap was made in; any other `seq` is ignored silently, so a duplicate continue never skips a phase (rule 6). |
| `host:hold` | host | A tap anywhere on the host's screen except Continue (0004 rule 3) — **not** a press on the briefing envelope (0017). Pushes the fill start to `HOLD_REARM_MS` after the tap. Ignored from anyone else and while paused. Holds and narration survive a reload inside the blip grace; they end when the host is disconnected (the grace ran out, 0012 item 2) or the role moves (0010). The fill then starts at the beat's own start if no hold or narration had moved it, otherwise at the release instant, so the continue deadline is never before the release (0004 rule 5). Clients should throttle it (0004 "Revisit if"). |
| `host:narration {speaking}` | host | The host's narrator started/stopped (0004 rule 2). The fill waits while speaking, capped server-side at `NARRATION_CAP_MS` after the start; a host going offline counts as stopped (rule 5). |
| `host:remove {playerId}` | host | Only a player with `connected: false`; keeps token, seat, color, score (0019). |
| `host:claim` | any player | Only while the host has `connected: false` (0010). First accepted claim wins. |
| `host:admit {playerId, approve}` | host | Approve or decline the pending "Rejoin as…" for `playerId` (0024 item 2). |
| `draw:done {strokes}` | roster player, draw | Wire strokes (`src/shared/stroke-codec.ts`), validated by `decodeStrokes`; accepted strictly before `closesAt` (at `closesAt` the draw has closed). One per player per round. |
| `host:end`, `vote:set`, `vote:lock`, `guess:submit {text}`, `guess:judge {accept}` | — | Parsed now; the reducer handles them from unit 3b and answers `wrong_phase` until then. |

The narrator's lines themselves are client-side (§10); only the host's
"speaking" signal reaches the server.

## Public `state` (stage 3.4)

`PublicState` (`src/shared/core/views.ts`) carries: room code, phase with its
public times, `seq`, `hostId`, players (id, name, color, icon, `connected`,
`removed`, `seated`, score), settings, `progress {completed, total}`, the
round (`no`, `roster`, `category`, `done`), and `paused`.

- `connected` flips to false only once a socket close outlasts
  `BLIP_GRACE_MS` (0012 item 2); the grace is identical for every player, so
  it says nothing about who the faker is. A rejoin during the grace never
  shows as a disconnect.
- Phase times: briefing `continueAt` and `fillFrom` (the host's fill runs
  from `fillFrom` to `continueAt`; `hostSpeaking` while the narrator holds
  it); draw `endsAt` (the countdown) and `closesAt = endsAt +
  DRAW_SUBMIT_GRACE_MS` (submissions accepted strictly before it; a timed-out draw
  ends there); `scrubbed.endsAt` (the "Mission scrubbed" beat after a
  faker-disconnect cancel, §7, 0012 item 3).
- `paused {since}` (0011): every phase time is frozen. Clients show
  `time − since` as the time left; on resume the room re-arms each time from
  the resume instant plus that remainder.
  Blip graces are presence, not game timers: they keep running during a
  pause, so a host who drops while paused becomes claimable (0010). A faker
  whose grace ran out during the pause is cancelled (§7) on resume.
  If a round has been paused for at least `RESTART_WAIT_MS` and seated plus
  waiting players **with an open socket** number 3 or more, the round goes
  to `scrubbed` (decisions 0023 item 1, 0025 item 1) and the next round
  seats everyone; a seated player's return before then resumes the round.
  The restart instant (`since + RESTART_WAIT_MS`) is one of the room's
  deadlines and does not depend on the faker.
- `rejoinRequests`: players a device has asked to "Rejoin as…" mid-round,
  in room order, never which socket asked (0024 item 4).
- `dealing`: a round has started and the word is on its way; no times.
- `slideshow {startsAt}` is a unit-3a stub; 3b defines the real slideshow.

## "Rejoin as…" during a round (decision 0024)

The requesting socket stays unbound, so it gets no `private` view, until the
host sends `host:admit {approve: true}`; it is told
`rejoin {playerId, status}`: `pending` on asking, `declined` by the host,
`cancelled` when the request lapses. A request lapses when the player comes
back by token (or any presence event) and is dropped when its socket closes
or joins another way. When the round ends (back between rounds) with the
player still disconnected, the request turns into an immediate rejoin. A
request for the host's own seat, or one made while no host is connected,
waits for the round to end or for a claimed host (0010).

## Private view (stage 3.4)

`private {view}` with `view = {you: {id, token}, round}`. `round` is
`{no, category, role: "agent", word}` for a roster non-faker,
`{no, category, role: "faker"}` for the faker, and null for a waiting late
joiner, while dealing, after a cancel, and in the lobby. The adapter sends it
to each bound socket whenever it changes.

## Reducer contract for the adapter (phase 4)

`reduce(state, input, now) → {state, effects}`; `nextDeadline(state)` is
the instant to arm the one alarm for (null after expiry).

- **Inputs:** `intent {conn, player, intent, mintedToken?}` (`player` from
  the socket attachment, null before joining; `mintedToken` for `join` and
  `rejoinAs`); `connClosed {conn}` when a socket that is not bound to a
  player closes (drops its pending "Rejoin as…"); `presence {player,
  connected}` when a player's first socket opens or last socket closes
  without an intent; `tick` when the alarm fires; `wordDealt {roundNo,
  entry}` answering `dealWord`; `drawingStored {key}` answering
  `storeDrawing`.
- **Effects:** `send {conn, msg}` (errors), `bind {conn, player}`,
  `dealWord {roundNo, difficulty, exclude}`, `storeDrawing {key, strokes}`,
  `clearDrawings {roundNo}`, `expireRoom`.
- Every call first fires whatever is due at `now`, so an intent that beats a
  late alarm sees the same history.
- **Ordering:** the adapter must deliver `connClosed` for a socket before any
  later input, or an admission could bind a socket that is already gone. The
  reducer applies `connClosed` before firing overdue deadlines.
- If overdue deadlines fired at the start of a step bind the sending socket
  (a pending "Rejoin as…" admitted because the round ended), an intent sent
  as unbound counts as from that player: player intents act as them, and
  `join`/`rejoin`/`rejoinAs` get `already_joined`. The adapter records the
  `bind` effect in the socket attachment as usual.
- `presence {connected: true}` for a removed player is ignored; a removed
  player returns only through `rejoin` or `rejoinAs` (0019).
- The faker is picked from every `connected` roster player, those inside the
  blip grace included (0020 item 1, 0025 item 2).
- The `dealing` phase has no deadline: if the deal fails the adapter must
  retry it (observation O-07).

## Errors

`error {code, message}`. `code` is the stable, machine-readable part; clients
switch on it. `message` is for logs and is not shown to players verbatim.

| code | Meaning | Socket |
|---|---|---|
| `version` | protocol version mismatch | closed, 4000 |
| `bad_message` | frame is not a known, well-formed message | stays open |
| `hello_first` | a well-formed message arrived before a successful `hello` | stays open |

Game errors (socket stays open), from the reducer:

| code | Meaning |
|---|---|
| `join_first` | a player intent from a socket that has not joined |
| `already_joined` | `join`/`rejoin`/`rejoinAs` from a bound socket |
| `room_full` | `MAX_PLAYERS` players already (removed and waiting included) |
| `bad_name`, `bad_color`, `bad_icon` | join field outside the allowed set |
| `color_taken` | another player (removed ones included) has that color |
| `unknown_token` | `rejoin` with a token not in this room |
| `not_rejoinable` | `rejoinAs` for a player who is not disconnected |
| `not_host` | host-only intent from another player |
| `wrong_phase` | intent not available in the current phase |
| `paused` | `host:next` while paused |
| `bad_settings` | cycles out of range, or Custom without values |
| `not_enough_players` | `host:start` with fewer than `MIN_PLAYERS` active |
| `not_removable` | `host:remove` of a connected or already-removed player |
| `host_connected` | `host:claim` while the host is connected (or by the host) |
| `rejoin_pending` | `rejoinAs` for a player another socket has already asked for (the same socket asking again replaces its request) |
| `no_request` | `host:admit` for a player nobody asked for |
| `not_in_round` | `draw:done` from a player not on the round roster |
| `already_done` | a second `draw:done` |
| `bad_strokes` | `decodeStrokes` refused the drawing (its message names the first problem) |

## Messages so far

| Direction | Message | Since |
|---|---|---|
| client → server | `hello {v}` | 1.8 |
| client → server | `ping {t}` | 1.8 |
| server → client | `welcome {v, serverTime}` | 1.8 |
| server → client | `pong {t, serverTime}` | 1.8 |
| server → client | `error {code, message}` | 1.8 |
| client → server | `join`, `rejoin`, `rejoinAs`, `host:settings`, `host:start`, `host:next`, `host:hold`, `host:narration`, `host:remove`, `host:end`, `host:claim`, `draw:done`, `vote:set`, `vote:lock`, `guess:submit`, `guess:judge` | 3.1 (types and parsing; `RoomDO` routes them from phase 4) |
| server → client | `state {state}`, `private {view}` | 3.1 |
| client → server | `host:admit {playerId, approve}` | 3a review (0024) |
| server → client | `rejoin {playerId, status}` | 3a review (0024) |

`PROTOCOL_VERSION` stays 1: stage 3.1 only added message types and no
deployed client sends them yet.
