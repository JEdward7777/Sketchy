/**
 * Optional point simplification (stage 2.10.2, decision 0009 item 1): it may
 * drop only points within half a grid unit of the simplified polyline.
 *
 * Ramer–Douglas–Peucker with tolerance `SIMPLIFY_TOLERANCE`, measuring
 * distance to the segment (not the infinite line) between the two kept
 * endpoints. A point is dropped only when every point between those
 * endpoints is within the tolerance of that segment, and the segment is part
 * of the output, so every dropped point lies within the tolerance of the
 * simplified polyline.
 *
 * The output is a subsequence of the input: kept points are unchanged
 * integers, and the first and last points are always kept.
 */

import type { Point, Stroke } from './stroke-codec';

/** Half a grid unit (0009 item 1). */
export const SIMPLIFY_TOLERANCE = 0.5;

/** Distance from `p` to the segment `a`–`b`. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from `p` to the nearest segment of `polyline` (or its only point). */
export function distanceToPolyline(p: Point, polyline: readonly Point[]): number {
  if (polyline.length === 1) return Math.hypot(p[0] - polyline[0]![0], p[1] - polyline[0]![1]);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < polyline.length; i++) {
    best = Math.min(best, distanceToSegment(p, polyline[i - 1]!, polyline[i]!));
  }
  return best;
}

/** The simplified points. Iterative, so a long stroke cannot overflow the stack. */
export function simplifyPoints(points: readonly Point[], tolerance = SIMPLIFY_TOLERANCE): Point[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = -1;
    let worstDist = tolerance;
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(points[i]!, points[first]!, points[last]!);
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst !== -1) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

export function simplifyStroke(stroke: Stroke, tolerance = SIMPLIFY_TOLERANCE): Stroke {
  return { ...stroke, points: simplifyPoints(stroke.points, tolerance) };
}
