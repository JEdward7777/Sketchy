#!/usr/bin/env node
/**
 * Stage 1.7.1: how many bytes a second of drawing costs in the provisional
 * stroke format (decision 0009), and so how long a drawing fits in one
 * WebSocket message and one Durable Object storage value.
 *
 *   node scripts/measure-strokes.mjs
 *
 * Provisional format (the real codec is stage 2.10; stage 7.10 re-measures):
 *   [{"c": colorIndex, "s": sizeIndex, "p": [[x, y], ...]}, ...]
 * integer points on a GRID_W x GRID_H logical grid (4:3), plain JSON, every
 * pointer sample kept (no simplification, no duplicate removal), so the
 * numbers are an upper bound for a given sampling rate. A flat variant
 * ("p": [x, y, x, y, ...]) is measured alongside for comparison; the codec
 * (src/shared/stroke-codec.ts) uses the flat form.
 *
 * Results are recorded in harness/reference/budget.md. Deterministic: the
 * generator is seeded, so a rerun prints the same numbers.
 *
 * The grid, palette, brush sizes and platform limits come from
 * src/shared/stroke-format.ts, the module the codec and renderer use, so the
 * measurement and the game cannot drift apart. Node imports the .ts file
 * directly by stripping its types, with no flag on the node version in
 * harness/reference/verification.md's baseline.
 */

import {
  BRUSH_SIZES,
  GRID_H,
  GRID_W,
  PALETTE,
  STORAGE_VALUE_LIMIT_BYTES,
  WS_MESSAGE_LIMIT_BYTES,
} from '../src/shared/stroke-format.ts';

// Assumptions, all stated as parameters.
const COLORS = PALETTE.length; // SPEC §9: "about 8 colors", plus the eraser (background color) at index 0
const SIZES = BRUSH_SIZES.length; // SPEC §9: "2-3 brush sizes"
const RATES = [60, 120, 240]; // pointer samples per second while the pen is down
const DRAW_SECONDS = 90; // Relaxed preset draw timer, SPEC §8 (the longest preset)

// Limits from harness/reference/budget.md (Cloudflare docs, checked 2026-11-23).
const WS_MESSAGE_LIMIT = WS_MESSAGE_LIMIT_BYTES; // "32 MiB (33,554,432 bytes)", received messages
const STORAGE_VALUE_LIMIT = STORAGE_VALUE_LIMIT_BYTES; // "Key and value combined cannot exceed 8 MB"; MB read as 10^6, the smaller reading
const ENVELOPE = '{"type":"draw:submit","strokes":'; // message wrapper overhead, + "}"

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const q = (x, max) => clamp(Math.round(x), 0, max - 1);

/**
 * Sample one stroke: a point moving with smoothly turning heading at `speed`
 * grid units per second for `seconds`, sampled `rate` times a second.
 */
function stroke(rand, rate, seconds, speed, turn) {
  let x = rand() * GRID_W;
  let y = rand() * GRID_H;
  let heading = rand() * Math.PI * 2;
  const n = Math.max(2, Math.round(seconds * rate));
  const p = [];
  for (let i = 0; i < n; i++) {
    p.push([q(x, GRID_W), q(y, GRID_H)]);
    heading += (rand() - 0.5) * turn;
    x += (Math.cos(heading) * speed) / rate;
    y += (Math.sin(heading) * speed) / rate;
    // Bounce off the edges so a long scribble stays on the canvas.
    if (x < 0 || x >= GRID_W) heading = Math.PI - heading;
    if (y < 0 || y >= GRID_H) heading = -heading;
    x = clamp(x, 0, GRID_W - 1);
    y = clamp(y, 0, GRID_H - 1);
  }
  return { c: Math.floor(rand() * COLORS), s: Math.floor(rand() * SIZES), p };
}

/**
 * A realistic sketch: strokes of 0.3-2 s at 150-500 units/s with gentle
 * turning, separated by 0.2-1.5 s pen-up pauses, until `seconds` elapse.
 */
function sketch(rand, rate, seconds) {
  const strokes = [];
  let t = 0;
  let penDown = 0;
  while (t < seconds) {
    const len = Math.min(0.3 + rand() * 1.7, seconds - t);
    strokes.push(stroke(rand, rate, len, 150 + rand() * 350, 0.6));
    t += len;
    penDown += len;
    t += 0.2 + rand() * 1.3;
  }
  return { strokes, penDown };
}

/**
 * Honest continuous scribbling: the pen never rests except a brief lift
 * every 2 s, moving fast (800-1200 units/s) and turning sharply all over the
 * canvas, so most coordinates have three digits.
 */
function scribble(rand, rate, seconds) {
  const strokes = [];
  for (let t = 0; t < seconds; t += 2) {
    strokes.push(stroke(rand, rate, Math.min(2, seconds - t), 800 + rand() * 400, 2.5));
  }
  return { strokes, penDown: seconds };
}

const flat = (strokes) => strokes.map((s) => ({ c: s.c, s: s.s, p: s.p.flat() }));
const bytes = (strokes) => Buffer.byteLength(`${ENVELOPE}${JSON.stringify(strokes)}}`);

const rows = [];
for (const rate of RATES) {
  for (const [name, gen] of [
    ['sketch', sketch],
    ['scribble', scribble],
  ]) {
    const { strokes, penDown } = gen(mulberry32(20261123 + rate), rate, DRAW_SECONDS);
    const points = strokes.reduce((n, s) => n + s.p.length, 0);
    const nested = bytes(strokes);
    const flatBytes = bytes(flat(strokes));
    const perSec = nested / DRAW_SECONDS;
    rows.push({
      name,
      rate,
      strokes: strokes.length,
      points,
      penDownPct: Math.round((penDown / DRAW_SECONDS) * 100),
      nested,
      flat: flatBytes,
      bytesPerPoint: (nested / points).toFixed(2),
      perSec: Math.round(perSec),
      fitsMessageSec: Math.floor(WS_MESSAGE_LIMIT / perSec),
      fitsValueSec: Math.floor(STORAGE_VALUE_LIMIT / perSec),
    });
  }
}

console.log(`grid ${GRID_W}x${GRID_H}, draw ${DRAW_SECONDS} s (Relaxed), every sample kept`);
console.log(`limits: message ${WS_MESSAGE_LIMIT} B, storage value ${STORAGE_VALUE_LIMIT} B\n`);
console.log(
  '| drawing | samples/s | strokes | points | pen down | JSON bytes (nested) | JSON bytes (flat) | bytes/point | bytes/s of drawing | max draw s in one message | max draw s in one value |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(
    `| ${r.name} | ${r.rate} | ${r.strokes} | ${r.points} | ${r.penDownPct}% | ${r.nested} | ${r.flat} | ${r.bytesPerPoint} | ${r.perSec} | ${r.fitsMessageSec} | ${r.fitsValueSec} |`,
  );
}
