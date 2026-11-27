#!/usr/bin/env node
/**
 * Stages 1.7.1 and 7.10: how many bytes a second of drawing costs, and so
 * how long a drawing fits in one WebSocket message and one Durable Object
 * storage value (decision 0009), and how it compares with the stroke safety
 * limit `STROKES_MAX_BYTES` (decision 0031).
 *
 *   node scripts/measure-strokes.mjs
 *
 * The sampled drawings are encoded with the real codec
 * (src/shared/stroke-codec.ts, stage 2.10: `encodeStrokes`, flat
 * `"p":[x,y,x,y,...]`), checked with `validateWireStrokes` as the room
 * does at intake, and measured as the room sees them: the `draw:done`
 * frame a client sends, the stored row, and the `drawing` frame each
 * socket receives (stage 6.5). A `simplified` column runs
 * `simplifyStroke` (stage 2.10.2) first, which the client may do; the
 * room does not require it. Every pointer sample is kept otherwise (no
 * duplicate removal), so the unsimplified numbers are an upper bound for a
 * given sampling rate.
 *
 * The 1.7.1 provisional format (nested `[[x, y], ...]` points) is still
 * printed for comparison with the first table in
 * harness/reference/budget.md. Deterministic: the generator is seeded, so a
 * rerun prints the same numbers.
 *
 * The codec, grid, palette, brush sizes and limits come from src/shared,
 * the modules the game uses, so the measurement and the game cannot drift
 * apart. Those modules import each other without file extensions, which
 * Node cannot resolve, so they are bundled in memory with esbuild (already
 * a dev dependency through Vite) and imported from a data: URL.
 */

import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: `export * from './src/shared/stroke-format'; export * from './src/shared/stroke-codec'; export * from './src/shared/stroke-simplify';`,
    resolveDir: new URL('..', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const shared = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const {
  BRUSH_SIZES,
  GRID_H,
  GRID_W,
  PALETTE,
  STORAGE_VALUE_LIMIT_BYTES,
  STROKES_MAX_BYTES,
  WS_MESSAGE_LIMIT_BYTES,
  encodeStrokes,
  simplifyStroke,
  validateWireStrokes,
} = shared;

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

const nestedBytes = (strokes) => Buffer.byteLength(`${ENVELOPE}${JSON.stringify(strokes)}}`);
const asStrokes = (strokes) => strokes.map((s) => ({ color: s.c, size: s.s, points: s.p }));
/** The `draw:done` frame, the stored row and the delivered `drawing` frame for one drawing, via the real codec. */
function codecBytes(strokes) {
  const wire = encodeStrokes(strokes);
  const frame = JSON.stringify({ type: 'draw:done', strokes: wire });
  const checked = validateWireStrokes(JSON.parse(frame).strokes);
  if (!checked.ok) throw new Error(`the codec refused its own output: ${checked.error}`);
  const stored = JSON.stringify(checked.strokes);
  const delivered = `{"type":"drawing","roundNo":999,"playerId":"p10","strokes":${stored}}`;
  return { frame: Buffer.byteLength(frame), stored: Buffer.byteLength(stored), delivered: Buffer.byteLength(delivered) };
}

const rows = [];
for (const rate of RATES) {
  for (const [name, gen] of [
    ['sketch', sketch],
    ['scribble', scribble],
  ]) {
    const { strokes, penDown } = gen(mulberry32(20261123 + rate), rate, DRAW_SECONDS);
    const points = strokes.reduce((n, s) => n + s.p.length, 0);
    const codec = codecBytes(asStrokes(strokes));
    const simplified = asStrokes(strokes).map((s) => simplifyStroke(s));
    const kept = simplified.reduce((n, s) => n + s.points.length, 0);
    const perSec = codec.frame / DRAW_SECONDS;
    rows.push({
      name,
      rate,
      strokes: strokes.length,
      points,
      penDownPct: Math.round((penDown / DRAW_SECONDS) * 100),
      nested: nestedBytes(strokes),
      ...codec,
      simplified: codecBytes(simplified).frame,
      keptPct: Math.round((kept / points) * 100),
      bytesPerPoint: (codec.frame / points).toFixed(2),
      perSec: Math.round(perSec),
      fitsLimitSec: Math.floor(STROKES_MAX_BYTES / perSec),
      fitsMessageSec: Math.floor(WS_MESSAGE_LIMIT / perSec),
      fitsValueSec: Math.floor(STORAGE_VALUE_LIMIT / perSec),
    });
  }
}

console.log(`grid ${GRID_W}x${GRID_H}, draw ${DRAW_SECONDS} s (Relaxed), every sample kept unless simplified`);
console.log(`limits: STROKES_MAX_BYTES ${STROKES_MAX_BYTES} B, message ${WS_MESSAGE_LIMIT} B, storage value ${STORAGE_VALUE_LIMIT} B\n`);
console.log(
  '| drawing | samples/s | strokes | points | pen down | 1.7.1 nested | draw:done frame | stored row | drawing frame | simplified frame (points kept) | bytes/point | bytes/s of drawing | max draw s under STROKES_MAX_BYTES | in one message | in one value |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(
    `| ${r.name} | ${r.rate} | ${r.strokes} | ${r.points} | ${r.penDownPct}% | ${r.nested} | ${r.frame} | ${r.stored} | ${r.delivered} | ${r.simplified} (${r.keptPct}%) | ${r.bytesPerPoint} | ${r.perSec} | ${r.fitsLimitSec} | ${r.fitsMessageSec} | ${r.fitsValueSec} |`,
  );
}
