# Phase 8 — Client: briefing and drawing

The first round screens over the stable protocol from phases 6–7: the client
connection and countdowns, the start button, the hold-to-reveal briefing
envelope (§4, §12 — the signature interaction), and the drawing canvas with
its tools and stroke capture (§9 as amended by decision 0009). Ends with the owner's real-phone check,
because touch behaviour cannot be trusted from a desktop browser.

- `8` active: Client: briefing and drawing
  - `8.1` done: Client connection: reconnect with backoff, apply `state` and `private`, countdowns from absolute deadlines and the clock offset (§14)
      Reconnect, state/private and the clock probe came with 4b
      (`RoomConnection`); phase 8 added `game/countdown.ts` (deadlines,
      frozen while paused) and the `drawing` frame buffer for phase 9
      (`net/drawing-buffer.ts`, `RoomSnapshot.drawings`).
  - `8.2` done: Host start button, enabled at ≥3 players (§7)
      Built in 4b (`Lobby`, `canStart`); lobby.spec.ts covers it.
  - `8.3` done: Briefing envelope: press and hold reveals category + word, or category + "You are the faker!"; hides on release; identical when not held (§4)
    - `8.3.1` done: Pointer down/up/cancel and lost-focus all hide it; no text selection or long-press menu
    - `8.3.2` done: The envelope stays reachable during drawing (§4)
    - `8.3.3` done: Outside the held envelope no screen renders the word, and before unmask none renders the role — draw, waiting, slideshow and browse screens show the category only; unmask, guess and judging screens may show the faker (public from 7.1) but not the word, which is public only in `round.result.word` once the guess resolves, judging included (decision 0026 item 5) (§4)
  - `8.4` done: Canvas: fixed 4:3 aspect, pointer events, no scrolling or zooming while drawing (§9)
  - `8.5` done: Tools: about 8 colors, 2–3 brush sizes, eraser, undo, clear with confirmation (§9); each tool maps onto the stroke model (0009)
  - `8.6` done: Capture strokes: points quantized to the logical grid (2.10), eraser as background-color strokes, undo pops the last stroke, clear empties the list; the canvas draws through the shared renderer (2.11); submit on Done or at the deadline (0009)
  - `8.7` done: Done early and a waiting screen until the draw phase ends (§4)
      A sent drawing stays "sending" until `round.done` lists the player;
      it is sent again on each new socket and after `DRAW_RESEND_MS` on
      the same one (review round 1: a frame on a dying socket is lost
      silently). The draw screen is one viewport tall at any size, tools
      beside the canvas in short landscape (`draw-layout.spec.ts`).
  - `8.9` done: Host's briefing continue: the 0004 button (immediate continue, fill from the server deadline); any other tap on the host's screen sends a throttled `host:hold`, with envelope presses treated per 0.8.8; 10.5 reuses the component for round results
      `AutoContinueButton` (screens/game/AutoContinue.tsx) and `useHostHold`
      (game/use-now.ts, `HoldThrottle`: one `host:hold` per `HOLD_THROTTLE_MS`
      plus one trailing). `host:narration` is not sent yet: there is no
      narrator until 12.1 (12.1.4 sends it); the button already shows
      `hostSpeaking`.
  - `8.8` todo: Owner's: real-phone check on iOS Safari and Android Chrome — hold-to-reveal, canvas does not scroll or zoom, drawings submit
      Owner's step; needs a deploy (owner's unless 0.6 grants authority).

**Verification.** E2E leg: N browser contexts against `wrangler dev` with a
short Custom preset play briefing and drawing; Playwright records every
WebSocket frame per context and asserts the faker context never receives the
word; synthetic pointer strokes produce a stroke list the server accepts,
and the recorded WebSocket frames, or the recorded HTTP responses if 6.5
chose `GET`, of another context show that exact list delivered at slideshow
start (6.5); on-screen rendering in other contexts is verified in phase 9
(9.1). Unit leg for the stroke-capture logic (quantization, undo, clear).
The rendered DOM of every context, outside a held envelope, contains neither
the word nor the role text ("You are the faker!") during briefing and draw.
8.8 is the owner's and is never simulated.
