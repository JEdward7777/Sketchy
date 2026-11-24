# Wire protocol

Skeleton from stage 1.8. The code is the source of truth:
`src/shared/protocol.ts` (`ClientMessage`, `ServerMessage`,
`PROTOCOL_VERSION`, `parseClientMessage`). This file records the rules the
types cannot express. Message sketch: `SPEC.md` §14.

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

## Errors

`error {code, message}`. `code` is the stable, machine-readable part; clients
switch on it. `message` is for logs and is not shown to players verbatim.

| code | Meaning | Socket |
|---|---|---|
| `version` | protocol version mismatch | closed, 4000 |
| `bad_message` | frame is not a known, well-formed message | stays open |
| `hello_first` | a well-formed message arrived before a successful `hello` | stays open |

Game errors (wrong phase, not host, …) are added with the intents that raise them.

## Messages so far

| Direction | Message | Since |
|---|---|---|
| client → server | `hello {v}` | 1.8 |
| client → server | `ping {t}` | 1.8 |
| server → client | `welcome {v, serverTime}` | 1.8 |
| server → client | `pong {t, serverTime}` | 1.8 |
| server → client | `error {code, message}` | 1.8 |

Reserved by `SPEC.md` §14 and arriving with the reducer: `state`, `private`,
and the intents `join`, `rejoin`, `rejoinAs`, `host:*`, `draw:*`, `vote:set`,
`vote:lock`, `guess:submit`, `guess:judge`.
