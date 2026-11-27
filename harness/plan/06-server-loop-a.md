# Phase 6 — Server loop A: briefing to vote end

The first half of a round, end to end on the server, before any round
screens exist: start, briefing with the secret sent privately, drawing with
stroke intake (decision 0009), the slideshow and free browse with live
voting, and the faker-disconnect cancel. Drawings stay out of the broadcast
state (decision 0006). Tested with several sockets against one `RoomDO` and
stub stroke lists.

- `6` active: Server loop A — briefing to vote end
  - `6.1` todo: `host:start` fixes the game length and picks the faker (2.7, 0020), deals a word (5.3), enters briefing; each roster player's socket (3.2) gets its own `private` (a waiting late joiner's socket gets none), re-sent to a player's new socket whenever they reconnect during briefing or draw (§4, §14)
  - `6.2` todo: Briefing beat with the 0004 continue: server-held auto-advance, `host:hold`, immediate continue, per 0.8.8 (0017)
  - `6.3` todo: Draw: deadline from settings (§8), `draw:done` with strokes, everyone-done early end (§4)
      Applies 3.3.2's submission grace, so a client submitting its strokes
      at the deadline is not lost and 6.5's single delivery includes it.
  - `6.4` todo: Stroke intake: validated with 2.10, one storage row per drawing, cleared when the next round starts (§14, 0006, 0009)
      No gameplay cap on strokes or points. A submission is rejected only
      above the platform safety limit from `reference/budget.md` (1.7);
      chunked rather than truncated if 1.7.1 found honest play needs it.
      If the Custom draw maximum recorded in 2.9's decision exceeds the
      draw time 1.7.1 found to fit, chunking is required.
  - `6.5` todo: Drawing delivery outside `state`: once per client per round, never before the slideshow starts, re-sent on reconnect (0006)
      Choose a `drawings` WebSocket message or
      `GET /api/room/:code/drawing/:id` against the limits in budget.md, and
      record the choice in `reference/protocol.md`.
  - `6.6` todo: Slideshow: card set and random order (0007), dark cards for missing drawings (§7), end at `start + n × 2 × perSlide` (§8) or earlier when everyone has locked (0016)
  - `6.7` todo: Voting across slideshow and browse: `vote:set`, `vote:lock`, browse deadline = slideshow end + vote timer, last-connected-lock end over the roster (§4, 3.2), per 0.8.6 and 0.8.7
  - `6.8` todo: Faker disconnect in briefing or draw cancels the round, no points, not counted toward the game length; the next round picks a fresh faker (§7, 0003, 0020) per 0.8.3
  - `6.9` todo: Restart safety: evict mid-phase, wake, and continue from storage alone (§14, harness/AGENTS.md §5)

**Verification.** DO leg with N sockets and `runDurableObjectAlarm`:
3-player and 10-player rooms run briefing → vote end; every message each
socket received is recorded and checked — the faker's socket never receives
the word, no other socket ever receives the faker flag, no socket ever
receives another player's token, and public `state` messages are
byte-identical across sockets and carry neither stroke data nor any player
token; no socket receives any drawing frame, and
`GET /api/room/:code/drawing/:id` (if 6.5 chose it) returns no stroke data,
before the slideshow starts — including for a socket that reconnects during
draw; a waiting late joiner's socket receives no `private` round view and
does not hold up the all-done or lock-in end; malformed strokes and
submissions above the platform safety limit are refused; a late submission
within the grace is kept; faker disconnect cancels; a reconnecting socket
gets its `private` again; eviction mid-draw resumes. Console output captured
from `RoomDO` during these runs contains neither the word nor the faker's
identity before unmask. No client screens in this phase.
