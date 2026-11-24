/**
 * Drawings as stroke lists (stage 2.10, decision 0009, amends `SPEC.md` §9).
 *
 * A drawing is an ordered list of strokes. Each stroke has a palette color
 * index, a brush size index and one or more integer points on the fixed
 * `GRID_W × GRID_H` grid (src/shared/stroke-format.ts). The eraser is a
 * stroke in `ERASER_COLOR`, the background. A one-point stroke is a dot.
 *
 * Wire form, inside `draw:submit` and wherever drawings are delivered:
 *
 *     [{"c": colorIndex, "s": sizeIndex, "p": [x0, y0, x1, y1, ...]}, ...]
 *
 * Points are flattened, which budget.md's stage 1.7.1 table measured at
 * 165,664 bytes against 208,864 nested for the same 240 samples/s scribble.
 *
 * Editing is defined on the list itself (0009 item 1): `undoStroke` removes
 * the last stroke and `clearStrokes` empties the list. There is no separate
 * history, so after a clear there is nothing left to undo, and the list that
 * is submitted is exactly what the canvas shows.
 *
 * There is no cap on strokes or points; the only size guard is the platform
 * safety limit `STROKES_MAX_BYTES` (0009 item 4), checked on the raw frame.
 */

import { BRUSH_SIZES, GRID_H, GRID_W, PALETTE, STROKES_MAX_BYTES } from './stroke-format';

export type Point = readonly [x: number, y: number];

export interface Stroke {
  /** Index into `PALETTE`. */
  readonly color: number;
  /** Index into `BRUSH_SIZES`. */
  readonly size: number;
  /** At least one point; integers with `0 ≤ x < GRID_W`, `0 ≤ y < GRID_H`. */
  readonly points: readonly Point[];
}

export interface WireStroke {
  readonly c: number;
  readonly s: number;
  readonly p: readonly number[];
}

export type DecodeResult =
  | { readonly ok: true; readonly strokes: Stroke[] }
  | { readonly ok: false; readonly error: string };

export function encodeStroke(stroke: Stroke): WireStroke {
  const p: number[] = [];
  for (const [x, y] of stroke.points) p.push(x, y);
  return { c: stroke.color, s: stroke.size, p };
}

export function encodeStrokes(strokes: readonly Stroke[]): WireStroke[] {
  return strokes.map(encodeStroke);
}

/**
 * A short, safe description of an untrusted value for an error message.
 * Never calls `String()` on a non-number: a parsed object such as
 * `{"toString": 1}` makes `String()` throw, and a huge array or string would
 * be copied into the message.
 */
export function describeValue(v: unknown): string {
  if (typeof v === 'number') return String(v);
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

const isIndex = (v: unknown, length: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < length;

/**
 * Validate and decode a wire stroke list (an already-parsed JSON value).
 * Rejects: a non-array; a stroke that is not an object with exactly the keys
 * `c`, `s`, `p`; an unknown color or size index; a `p` that is not an array
 * of an even, non-zero number of integers; a coordinate outside the grid.
 * The error names the first problem found, with its stroke index; it
 * describes offending values with `describeValue`, so decoding never throws
 * on any JSON value.
 */
export function decodeStrokes(value: unknown): DecodeResult {
  if (!Array.isArray(value)) return { ok: false, error: 'strokes must be an array' };
  const strokes: Stroke[] = [];
  for (let i = 0; i < value.length; i++) {
    const w: unknown = value[i];
    const at = `stroke ${i}`;
    if (typeof w !== 'object' || w === null || Array.isArray(w)) return { ok: false, error: `${at}: not an object` };
    const keys = Object.keys(w).sort().join(',');
    // The keys are not echoed: they are untrusted and may be arbitrarily long.
    if (keys !== 'c,p,s') return { ok: false, error: `${at}: expected exactly the keys c, s, p` };
    const { c, s, p } = w as Record<string, unknown>;
    if (!isIndex(c, PALETTE.length)) return { ok: false, error: `${at}: unknown color (${describeValue(c)})` };
    if (!isIndex(s, BRUSH_SIZES.length)) return { ok: false, error: `${at}: unknown size (${describeValue(s)})` };
    if (!Array.isArray(p) || p.length === 0 || p.length % 2 !== 0) {
      return { ok: false, error: `${at}: points must be a non-empty flat [x, y, ...] list` };
    }
    const points: Point[] = [];
    for (let j = 0; j < p.length; j += 2) {
      const x: unknown = p[j];
      const y: unknown = p[j + 1];
      if (!isIndex(x, GRID_W) || !isIndex(y, GRID_H)) {
        return { ok: false, error: `${at}: point ${j / 2} (${describeValue(x)}, ${describeValue(y)}) is not an integer grid point` };
      }
      points.push([x, y]);
    }
    strokes.push({ color: c, size: s, points });
  }
  return { ok: true, strokes };
}

/**
 * True when a submission of `byteLength` bytes is within the platform
 * safety limit. Check the raw frame before parsing it.
 */
export function withinSafetyLimit(byteLength: number): boolean {
  return byteLength <= STROKES_MAX_BYTES;
}

/** The list with `stroke` drawn last. */
export function appendStroke(strokes: readonly Stroke[], stroke: Stroke): Stroke[] {
  return [...strokes, stroke];
}

/** Undo: the list without its last stroke (unchanged when empty). */
export function undoStroke(strokes: readonly Stroke[]): Stroke[] {
  return strokes.slice(0, -1);
}

/** Clear: the empty list. Not undoable — §9 puts it behind a confirmation. */
export function clearStrokes(): Stroke[] {
  return [];
}
