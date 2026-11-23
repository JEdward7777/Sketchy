# 0006 — Build a pure core first, then the server loop, then the screens

- **Date:** 2026-11-22
- **Status:** accepted
- **Stage:** 0.7

## Decision
The phase tree in `plan/` (phases 0–13) follows five rules:

1. **Pure core.** The game is `reduce(state, input, now) → {state, effects}`
   in `src/shared`, with `projectPublic`, `projectPrivate` and
   `nextDeadline`, built on pure leaves (scoring, guess matching, slide
   index, clock offset, room codes, cycle schedule). `RoomDO` is a thin
   adapter: storage, sockets, the one alarm.
2. **Presence lives in the core.** Connected flag plus per-phase connection
   history are part of the state, because they decide scoring (§5,
   decision 0003), the last-connected lock-in (§4), dark cards (§7), the
   faker-disconnect cancel (§7) and the 0004 hold logic.
3. **Server before client.** Both halves of the round run through real
   sockets (phases 6–7) before round screens are built (8–11). The lobby
   (phase 4) is the exception: it ships a real screen early so the owner
   can see progress on a phone.
4. **Images never in `state`.** Every `vote:set` rebroadcasts state, so
   drawings go out once per client per round, outside it; size is capped at
   intake; one storage row per drawing. The mechanism (WebSocket message or
   GET) is chosen in stage 6.5 against limits verified in stage 1.7.
5. **Every phase names its verification recipe**: the unit leg (vitest over
   `src/shared`), the DO leg (`vitest-pool-workers`, N sockets,
   `runDurableObjectAlarm`) and the E2E leg (Playwright, N contexts,
   `wrangler dev`, short Custom preset), all set up in phase 1.
   Owner-only stages are titled "Owner's:".

## Why
An independent review of the draft tree, accepted by the operator, found
that secrecy, presence-dependent scoring and the cycle schedule were spread
across late UI phases, where they would be retrofitted into `RoomDO`. A pure
reducer lets the secrecy property ("public state is identical whatever the
word and faker", stage 3.6) be tested for every phase with no runtime.

## Rejected
- **The draft vertical-slice tree** (phases 0–10, from the original
  `CLAUDE.md` order): each feature phase mixed server rules and screens, so
  the protocol kept moving under the client; scoring sat in phase 7 and
  cycles and disconnects in phase 8, after the code they change; images had
  no rule keeping them out of the broadcast.
- **All UI after all server work, lobby included:** nothing to see on a phone
  until phase 8.

## Revisit if
The reducer's effects grow complex enough that `RoomDO` stops being thin, or
the per-phase ratchet cost outweighs catching defects early.
