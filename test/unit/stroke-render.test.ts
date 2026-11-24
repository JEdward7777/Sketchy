/**
 * Stage 2.11.1 — the shared stroke renderer (decision 0009 item 2): a
 * deterministic sequence of context calls for a given stroke list and target
 * size, with undo and clear (0009 item 1) reflected exactly.
 */
import { describe, expect, it } from 'vitest';
import { clearStrokes, undoStroke, type Stroke } from '../../src/shared/stroke-codec';
import { BACKGROUND_COLOR, BRUSH_SIZES, ERASER_COLOR, GRID_H, GRID_W, PALETTE } from '../../src/shared/stroke-format';
import { gridTransform, renderStrokes, type DrawContext } from '../../src/shared/stroke-render';
import { seededRng } from '../helpers/seeded-rng';

// Type-level check: a browser canvas context is a DrawContext (this file
// compiles under tsconfig.tools.json, which has the DOM library).
const _domContextFits = (ctx: CanvasRenderingContext2D): DrawContext => ctx;
void _domContextFits;

type Call = [string, ...unknown[]];

/** Records every property write and method call, in order. */
function recordingContext(): { ctx: DrawContext; calls: Call[] } {
  const calls: Call[] = [];
  const props: Record<string, unknown> = {};
  const ctx = {} as DrawContext;
  for (const p of ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin']) {
    Object.defineProperty(ctx, p, {
      get: () => props[p],
      set: (v: unknown) => {
        props[p] = v;
        calls.push([`set ${p}`, v]);
      },
    });
  }
  for (const m of ['fillRect', 'beginPath', 'moveTo', 'lineTo', 'arc', 'stroke', 'fill']) {
    (ctx as unknown as Record<string, unknown>)[m] = (...args: unknown[]) => calls.push([m, ...args]);
  }
  return { ctx, calls };
}

function render(strokes: readonly Stroke[], w: number, h: number): Call[] {
  const { ctx, calls } = recordingContext();
  renderStrokes(ctx, strokes, w, h);
  return calls;
}

function randomStrokes(seed: number, count: number): Stroke[] {
  const rng = seededRng(seed);
  return Array.from({ length: count }, () => ({
    color: rng.int(PALETTE.length),
    size: rng.int(BRUSH_SIZES.length),
    points: Array.from({ length: 1 + rng.int(6) }, () => [rng.int(GRID_W), rng.int(GRID_H)] as const),
  }));
}

/** Calls before the first stroke: background fill and line style. */
const PREAMBLE = (w: number, h: number): Call[] => [
  ['set fillStyle', BACKGROUND_COLOR],
  ['fillRect', 0, 0, w, h],
  ['set lineCap', 'round'],
  ['set lineJoin', 'round'],
];

describe('renderStrokes', () => {
  it('draws a polyline and a dot with exactly these calls', () => {
    const strokes: Stroke[] = [
      { color: 2, size: 1, points: [[0, 0], [400, 300], [799, 599]] },
      { color: ERASER_COLOR, size: 2, points: [[100, 50]] },
    ];
    const scale = 400 / GRID_W; // 400 × 300 target: half size
    expect(render(strokes, 400, 300)).toEqual([
      ...PREAMBLE(400, 300),
      ['set strokeStyle', PALETTE[2]],
      ['set lineWidth', BRUSH_SIZES[1] * scale],
      ['beginPath'],
      ['moveTo', 0, 0],
      ['lineTo', 200, 150],
      ['lineTo', 799 * scale, 599 * scale],
      ['stroke'],
      ['set fillStyle', BACKGROUND_COLOR], // eraser = background color
      ['beginPath'],
      ['arc', 50, 25, (BRUSH_SIZES[2] * scale) / 2, 0, Math.PI * 2],
      ['fill'],
    ]);
  });

  it('a stroke of repeated identical points (a tap) is a dot, not a zero-length line', () => {
    const tap: Stroke = { color: 3, size: 0, points: [[5, 5], [5, 5]] };
    expect(render([tap], 800, 600)).toEqual([
      ...PREAMBLE(800, 600),
      ['set fillStyle', PALETTE[3]],
      ['beginPath'],
      ['arc', 5, 5, BRUSH_SIZES[0] / 2, 0, Math.PI * 2],
      ['fill'],
    ]);
    expect(render([{ ...tap, points: [[5, 5], [5, 5], [5, 5], [5, 5]] }], 800, 600)).toEqual(render([tap], 800, 600));
  });

  it('a non-4:3 target ends by repainting its margin bands with the background', () => {
    // Wide: a horizontal margin on each side. A thick stroke at x = 0 would spill into it.
    const wide = gridTransform(1000, 300);
    const edge: Stroke = { color: 1, size: 2, points: [[0, 0], [0, GRID_H - 1]] };
    expect(render([edge], 1000, 300).slice(-3)).toEqual([
      ['set fillStyle', BACKGROUND_COLOR],
      ['fillRect', 0, 0, wide.offsetX, 300],
      ['fillRect', 1000 - wide.offsetX, 0, wide.offsetX, 300],
    ]);
    // Tall: a vertical margin above and below.
    const tall = gridTransform(400, 600);
    expect(render([edge], 400, 600).slice(-3)).toEqual([
      ['set fillStyle', BACKGROUND_COLOR],
      ['fillRect', 0, 0, 400, tall.offsetY],
      ['fillRect', 0, 600 - tall.offsetY, 400, tall.offsetY],
    ]);
    // 4:3: no margin, so the last call is the stroke itself.
    expect(render([edge], 800, 600).at(-1)).toEqual(['stroke']);
  });

  it('is deterministic for a given stroke list and target size', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const strokes = randomStrokes(seed, 12);
      expect(render(strokes, 640, 480)).toEqual(render(strokes, 640, 480));
    }
  });

  it('scales with the target size and centres a non-4:3 target', () => {
    expect(gridTransform(1600, 1200)).toEqual({ scale: 2, offsetX: 0, offsetY: 0 });
    // A wide target: height binds, the grid is centred horizontally.
    expect(gridTransform(1000, 300)).toEqual({ scale: 300 / GRID_H, offsetX: (1000 - GRID_W * (300 / GRID_H)) / 2, offsetY: 0 });
    const calls = render([{ color: 1, size: 0, points: [[0, 0], [10, 0]] }], 1000, 300);
    expect(calls).toContainEqual(['moveTo', (1000 - GRID_W * (300 / GRID_H)) / 2, 0]);
    expect(() => gridTransform(0, 10)).toThrow(RangeError);
  });

  it('undo is exact: rendering the undone list equals the full render minus the last stroke', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const strokes = randomStrokes(seed, 8);
      const full = render(strokes, 800, 600);
      const undone = render(undoStroke(strokes), 800, 600);
      const lastOnly = render(strokes.slice(-1), 800, 600).slice(PREAMBLE(800, 600).length);
      expect(full).toEqual([...undone, ...lastOnly]);
    }
  });

  it('clear is exact: rendering the cleared list is the background alone, like an empty drawing', () => {
    expect(render(clearStrokes(), 800, 600)).toEqual(PREAMBLE(800, 600));
    expect(render([], 320, 240)).toEqual(PREAMBLE(320, 240));
  });

  it('carries no state between calls on the same context', () => {
    const { ctx, calls } = recordingContext();
    const strokes = randomStrokes(4, 5);
    renderStrokes(ctx, strokes, 800, 600);
    const first = calls.splice(0);
    renderStrokes(ctx, undoStroke(strokes), 800, 600);
    expect(calls).toEqual(render(undoStroke(strokes), 800, 600));
    expect(first).toEqual(render(strokes, 800, 600));
  });
});
