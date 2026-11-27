# 0030 — Drawings go out as one `drawing` WebSocket frame per card

- **Date:** 2026-11-26
- **Status:** accepted (implementor default under 0021; the owner may override)
- **Stage:** 6.4, 6.5

## Decision
1. **Delivery is a WebSocket message, not an HTTP GET.** When the
   slideshow starts, the room sends every live socket that has completed
   `hello` one `drawing {roundNo, playerId, strokes}` frame per card
   holder who submitted, in card order, right after the `state` that
   opened the slideshow. A socket that opens later (a reconnect) gets
   them right after its `welcome` / `state`. Each socket gets them once
   per round: its attachment records `drawingsRound`.
2. **Nothing before the slideshow.** The core's `publicDrawings(state)`
   is null until `round.cards` is set (the slideshow has started), so no
   frame, size or count of a drawing leaves the room during the draw. The
   only drawing fact public during the draw is `round.done`, which §4
   needs.
3. **One frame per drawing, never one for the round.** A frame is at most
   one stored drawing plus a few dozen bytes of envelope, so it stays
   under `STROKES_MAX_BYTES` + that envelope; one frame for the round could
   reach `MAX_PLAYERS × STROKES_MAX_BYTES` = 40 MB, past the 32 MiB
   WebSocket message limit (budget.md).
4. **No chunking at intake.** A `draw:done` frame over `FRAME_MAX_BYTES`
   (= `STROKES_MAX_BYTES` = 4 × 10^6) is refused whole with
   `error {code: "too_large"}`, never truncated; everything up to it is
   stored in one `drawings` row. The 0022 Custom draw cap (180 s) is inside
   the 3,447 s that budget.md found to fit one storage value, so honest
   play never needs a second row.

## Why
- Outbound WebSocket messages cost nothing (budget.md, DO pricing); a GET
  per drawing per client is a Worker request **and** a DO request each:
  `P × P` per round, `10 × 10 × 20 = 2,000` for the illustrative game,
  against the room's other `≈ 250` DO requests.
- The socket is already authenticated by its binding and already ordered
  with `state`; a GET would need its own secrecy check (refusing before the
  slideshow) and its own retries.
- A socket-scoped "sent" flag in the attachment survives hibernation, so
  restart safety (6.9) needs nothing extra.

## Rejected
- **`GET /api/room/:code/drawing/:id`:** billed per request, and a second
  path that must refuse before the slideshow.
- **One `drawings` frame for the whole round:** can exceed the message
  limit in the adversarial case (item 3).
- **Sending during the draw to save time at the slideshow:** leaks who has
  drawn what, and how much, before the faker is guessed.

## Revisit if
The outbound frame size limit (unverified, budget.md) turns out smaller
than `STROKES_MAX_BYTES`, or a big-screen display (7.11) needs drawings
on a different schedule.
