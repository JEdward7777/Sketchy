/**
 * Stage 2.10.2 — optional point simplification, decision 0009 item 1: it may
 * drop only points within half a grid unit of the simplified polyline.
 *
 * No strokes recorded on a real device exist yet (the drawing client is
 * phase 8), so the "recorded-like" strokes here are pointer traces sampled
 * the way scripts/measure-strokes.mjs samples them (smoothly turning
 * movement, quantized to the grid, every sample kept), plus hand-built
 * synthetic cases.
 */
import { describe, expect, it } from 'vitest';
import type { Point } from '../../src/shared/stroke-codec';
import { GRID_H, GRID_W } from '../../src/shared/stroke-format';
import {
  distanceToPolyline,
  distanceToSegment,
  SIMPLIFY_TOLERANCE,
  simplifyPoints,
} from '../../src/shared/stroke-simplify';
import { seededRng } from '../helpers/seeded-rng';

/**
 * The property 0009 requires, plus subsequence and endpoints. Each original
 * point is checked against the simplified segment spanning it (between the
 * kept points around it), which is part of the simplified polyline, so this
 * is at least as strict as "within half a unit of the polyline" and linear.
 */
function expectValidSimplification(original: readonly Point[], simplified: readonly Point[]): void {
  expect(SIMPLIFY_TOLERANCE).toBe(0.5);
  expect(simplified[0]).toEqual(original[0]);
  expect(simplified.at(-1)).toEqual(original.at(-1));
  // Subsequence: kept points appear in order and are the original objects, unchanged.
  const keptAt: number[] = [];
  let j = 0;
  original.forEach((p, i) => {
    if (j < simplified.length && p === simplified[j]) {
      keptAt.push(i);
      j++;
    }
  });
  expect(j).toBe(simplified.length);
  let seg = 0;
  for (let i = 0; i < original.length; i++) {
    while (seg + 1 < keptAt.length - 1 && keptAt[seg + 1]! <= i) seg++;
    const a = simplified[seg]!;
    const b = simplified[Math.min(seg + 1, simplified.length - 1)]!;
    let d = distanceToSegment(original[i]!, a, b);
    if (d > SIMPLIFY_TOLERANCE) d = distanceToPolyline(original[i]!, simplified); // fall back to the definition
    expect(d).toBeLessThanOrEqual(SIMPLIFY_TOLERANCE);
  }
}

/** A pointer trace like the measurement script's: speed in grid units/s, sampled at `rate`. */
function trace(seed: number, rate: number, seconds: number, speed: number, turn: number): Point[] {
  const rng = seededRng(seed);
  let x = rng.next() * GRID_W;
  let y = rng.next() * GRID_H;
  let heading = rng.next() * Math.PI * 2;
  const out: Point[] = [];
  for (let i = 0; i < Math.max(2, Math.round(seconds * rate)); i++) {
    out.push([Math.min(GRID_W - 1, Math.max(0, Math.round(x))), Math.min(GRID_H - 1, Math.max(0, Math.round(y)))]);
    heading += (rng.next() - 0.5) * turn;
    x += (Math.cos(heading) * speed) / rate;
    y += (Math.sin(heading) * speed) / rate;
    if (x < 0 || x >= GRID_W) heading = Math.PI - heading;
    if (y < 0 || y >= GRID_H) heading = -heading;
    x = Math.min(GRID_W - 1, Math.max(0, x));
    y = Math.min(GRID_H - 1, Math.max(0, y));
  }
  return out;
}

describe('distance helpers', () => {
  it('measure to the segment, not the infinite line', () => {
    expect(distanceToSegment([5, 3], [0, 0], [10, 0])).toBe(3);
    expect(distanceToSegment([13, 4], [0, 0], [10, 0])).toBe(5); // past the end: to the endpoint
    expect(distanceToSegment([3, 4], [0, 0], [0, 0])).toBe(5); // degenerate segment
    expect(distanceToPolyline([3, 4], [[0, 0]])).toBe(5);
  });
});

describe('simplifyPoints', () => {
  it('keeps 0–2 point strokes as they are', () => {
    expect(simplifyPoints([])).toEqual([]);
    expect(simplifyPoints([[1, 1]])).toEqual([[1, 1]]);
    expect(simplifyPoints([[1, 1], [1, 1]])).toEqual([[1, 1], [1, 1]]);
  });

  it('collapses a straight line and duplicates to its endpoints', () => {
    const line: Point[] = Array.from({ length: 50 }, (_, i) => [i * 2, i] as const);
    const dup: Point[] = [[4, 4], [4, 4], [4, 4], [9, 4]];
    expect(simplifyPoints(line)).toEqual([[0, 0], [98, 49]]);
    expect(simplifyPoints(dup)).toEqual([[4, 4], [9, 4]]);
  });

  it('drops a point exactly half a unit off, keeps one just beyond', () => {
    // Integer grid points cannot sit exactly 0.5 from an axis-aligned segment,
    // so use a diagonal: (1, 0) is 1/√2 ≈ 0.707 from the segment (0,0)–(2,2).
    expect(simplifyPoints([[0, 0], [1, 0], [2, 2]])).toEqual([[0, 0], [1, 0], [2, 2]]);
    // Fractional input exercises the boundary itself (the tolerance is inclusive).
    expect(simplifyPoints([[0, 0], [5, 0.5], [10, 0]])).toEqual([[0, 0], [10, 0]]);
    expect(simplifyPoints([[0, 0], [5, 0.51], [10, 0]])).toEqual([[0, 0], [5, 0.51], [10, 0]]);
  });

  it('keeps every corner of a zigzag whose teeth exceed the tolerance', () => {
    const zig: Point[] = Array.from({ length: 21 }, (_, i) => [i * 10, i % 2 === 0 ? 0 : 5] as const);
    expect(simplifyPoints(zig)).toEqual(zig);
  });

  it('closed loop: start and end at the same point', () => {
    const loop: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const out = simplifyPoints(loop);
    expectValidSimplification(loop, out);
  });

  it.each([
    ['sketch, 60 samples/s', 60, 1.5, 300, 0.6],
    ['sketch, 240 samples/s', 240, 2, 300, 0.6],
    ['scribble, 120 samples/s', 120, 2, 1000, 2.5],
    ['scribble, 240 samples/s', 240, 2, 1000, 2.5],
    ['slow wobble, 240 samples/s', 240, 3, 40, 0.3],
  ])('pointer-like trace (%s) stays within half a unit', (_name, rate, seconds, speed, turn) => {
    for (let seed = 1; seed <= 10; seed++) {
      const original = trace(seed * 31 + rate, rate, seconds, speed, turn);
      const out = simplifyPoints(original);
      expectValidSimplification(original, out);
      expect(out.length).toBeLessThanOrEqual(original.length);
    }
  });

  it('random integer noise stays within half a unit', () => {
    const rng = seededRng(77);
    for (let trial = 0; trial < 50; trial++) {
      const pts: Point[] = Array.from({ length: 2 + rng.int(200) }, () => [rng.int(40), rng.int(30)] as const);
      expectValidSimplification(pts, simplifyPoints(pts));
    }
  });

  it('a long stroke does not overflow the stack', () => {
    const long = trace(5, 240, 400, 1000, 2.5); // 96,000 samples
    expectValidSimplification(long, simplifyPoints(long));
  });
});
