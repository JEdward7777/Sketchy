# 0009 — Drawings travel as strokes, not images

- **Date:** 2026-11-22
- **Status:** accepted
- **Stage:** 0.7
- **Amends:** `SPEC.md` §9 — replaces "exports a compressed image (WebP/PNG,
  scaled to ~600 px wide)" with stroke data.

## Decision
1. The client records each stroke: a palette color, a brush size from the
   set, and points quantized to integers on a fixed logical grid matching
   the 4:3 canvas. The eraser is a stroke in the fixed background color.
   Undo removes the last stroke; clear empties the list. Optional point
   simplification may drop only points within half a grid unit of the
   simplified polyline (stage 2.10.2).
2. Every client, and the big screen, draws strokes with one shared pure
   renderer, so a drawing is crisp at any size.
3. The server validates structure: palette colors, allowed sizes,
   coordinates in range, well-formed lists.
4. **No gameplay cap on strokes or points.** The only size guard is a
   platform safety limit: a submission is rejected only if it exceeds the
   WebSocket message or DO storage limits verified in phase 1, set well
   above an honest full-timer scribble at the longest preset. If those
   limits prove too small for honest play, submissions are chunked, never
   truncated.
5. Drawings still never ride in the broadcast `state` and go out once per
   client per round (0006).
6. **"Save my drawing":** from the results screens any player can render a
   drawing to a PNG on their own device and download or share it.

## Why
The owner proposed it and approved it (2026-11-22), and ruled out a stroke
cap: even a full-timer scribble is far fewer data points than a high-res
image's pixels. Strokes are expected to be smaller than raster for line
sketches (an estimate; phase 1 measures it), are resolution-independent for
the big screen, avoid per-browser canvas-encoding differences, can be
validated by the server, and map directly onto undo and clear. "Save my
drawing" is the owner's request.

## Rejected
- Raster WebP/PNG export per `SPEC.md` §9: larger, cannot be validated,
  encoder quirks differ by browser.
- A cap on strokes or points: rejected by the owner.

## Revisit if
Phase-1 measurements show stroke payloads exceed the platform limits for
honest play, or the renderer's output differs visibly across devices.
