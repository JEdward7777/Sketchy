/**
 * The drawing format's fixed parameters (decision 0009, amends `SPEC.md`
 * §9): one logical 4:3 grid, the palette and the brush sizes, plus the
 * platform safety limit on a submission's size.
 *
 * This module is also imported by `scripts/measure-strokes.mjs` (node strips
 * the types), so the measurements in harness/reference/budget.md use the
 * same grid and palette as the codec. Keep it free of imports and of syntax
 * that type stripping cannot erase (no enums, namespaces or parameter
 * properties).
 */

/** Logical grid width; every point is an integer in `[0, GRID_W)`. */
export const GRID_W = 800;
/** Logical grid height, 4:3 with `GRID_W` (§9 "fixed-aspect canvas (e.g. 4:3)"). */
export const GRID_H = (GRID_W * 3) / 4;

/** The canvas background; the eraser draws in this color (0009 item 1). */
export const BACKGROUND_COLOR = '#ffffff';

/**
 * Stroke colors by index. Index `ERASER_COLOR` is the background, so an
 * eraser stroke is an ordinary stroke in that color; the other eight are the
 * ink colors (§9 "about 8 colors").
 */
export const PALETTE = [
  BACKGROUND_COLOR, // eraser
  '#1f1f1f', // ink black
  '#e53935', // red
  '#fb8c00', // orange
  '#fdd835', // yellow
  '#43a047', // green
  '#1e88e5', // blue
  '#8e24aa', // purple
  '#8d6e63', // brown
] as const;
export const ERASER_COLOR = 0;

/** Brush line widths in grid units, by index (§9 "2–3 brush sizes"). */
export const BRUSH_SIZES = [4, 10, 24] as const;

/** Limits from harness/reference/budget.md (Cloudflare docs, checked 2026-11-23). */
export const WS_MESSAGE_LIMIT_BYTES = 32 * 1024 * 1024; // "32 MiB (33,554,432 bytes)", received messages
/** "Key and value combined cannot exceed 8 MB"; MB read as 10^6 bytes, the smaller reading. */
export const STORAGE_VALUE_LIMIT_BYTES = 8 * 1000 * 1000;

/**
 * Platform safety limit (decision 0009 item 4): a `draw:submit` frame longer
 * than this many bytes is rejected. It is the only size guard; there is no
 * cap on strokes or points.
 *
 * Set by memory, not storage (decision 0031): the room's 128 MB isolate
 * holds the raw frame, its parse and the stored copy at once, and delivery
 * sends a drawing to every socket. It is far below
 * `STORAGE_VALUE_LIMIT_BYTES` (one row per drawing, no chunking) and
 * `WS_MESSAGE_LIMIT_BYTES`. test/unit/stroke-codec.test.ts checks that it
 * stays above an honest full-timer scribble at the longest Custom draw time
 * (decision 0022): `180 × MEASURED_WORST_BYTES_PER_SECOND ≈ 417,773` bytes.
 */
export const STROKES_MAX_BYTES = 1_000_000;

/**
 * The worst measured drawing rate, from budget.md's stage 1.7.1 table: the
 * 240 samples/s scribble, 208,864 JSON bytes (nested points, every sample
 * kept) over the 90 s Relaxed draw. The codec's flat points are smaller for
 * the same drawing (165,664 bytes in the same row), so this is an upper bound.
 */
export const MEASURED_WORST_BYTES_PER_SECOND = 208_864 / 90;
