# Phase 8 — Client: briefing and drawing

The first round screens over the stable protocol from phases 6–7: the client
connection and countdowns, the start button, the hold-to-reveal briefing
envelope (§4, §12 — the signature interaction), and the drawing canvas with
its tools and stroke capture (§9 as amended by decision 0009). Ends with the owner's real-phone check,
because touch behaviour cannot be trusted from a desktop browser.

- `8` todo: Client: briefing and drawing
  - `8.1` todo: Client connection: reconnect with backoff, apply `state` and `private`, countdowns from absolute deadlines and the clock offset (§14)
  - `8.2` todo: Host start button, enabled at ≥3 players (§7)
  - `8.3` todo: Briefing envelope: press and hold reveals category + word, or category + "You are the faker!"; hides on release; identical when not held (§4)
    - `8.3.1` todo: Pointer down/up/cancel and lost-focus all hide it; no text selection or long-press menu
    - `8.3.2` todo: The envelope stays reachable during drawing (§4)
    - `8.3.3` todo: Outside the held envelope no screen renders the word, and before unmask none renders the role — draw, waiting, slideshow and browse screens show the category only; unmask and guess screens may show the faker (public from 7.1) but not the word until it enters public state (7.2) (§4)
  - `8.4` todo: Canvas: fixed 4:3 aspect, pointer events, no scrolling or zooming while drawing (§9)
  - `8.5` todo: Tools: about 8 colors, 2–3 brush sizes, eraser, undo, clear with confirmation (§9); each tool maps onto the stroke model (0009)
  - `8.6` todo: Capture strokes: points quantized to the logical grid (2.10), eraser as background-color strokes, undo pops the last stroke, clear empties the list; the canvas draws through the shared renderer (2.11); submit on Done or at the deadline (0009)
  - `8.7` todo: Done early and a waiting screen until the draw phase ends (§4)
  - `8.9` todo: Host's briefing continue: the 0004 button (immediate continue, fill from the server deadline); any other tap on the host's screen sends a throttled `host:hold`, with envelope presses treated per 0.8.8; 10.5 reuses the component for round results
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
