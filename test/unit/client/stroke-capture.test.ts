import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL, INK_COLORS, StrokeCapture, strokeColor, toGridPoint, type Tool } from '../../../src/client/game/stroke-capture';
import { PALETTE_LABELS, SIZE_LABELS } from '../../../src/client/game/tool-labels';
import { decodeStrokes } from '../../../src/shared/stroke-codec';
import { BRUSH_SIZES, ERASER_COLOR, GRID_H, GRID_W, PALETTE } from '../../../src/shared/stroke-format';

const ink: Tool = { eraser: false, color: 2, size: 0 };
const eraser: Tool = { eraser: true, color: 2, size: 2 };

describe('toGridPoint: pointer to the logical grid (8.6, 2.10)', () => {
  // A 400×300 canvas at (10, 20): scale = 400 / GRID_W = 0.5.
  const rect = { left: 10, top: 20, width: 400, height: 300 };

  it('maps the corners and the centre of a 4:3 element', () => {
    expect(toGridPoint(10, 20, rect)).toEqual([0, 0]);
    expect(toGridPoint(10 + 200, 20 + 150, rect)).toEqual([GRID_W / 2, GRID_H / 2]);
    // The far edge is clamped onto the last grid cell.
    expect(toGridPoint(10 + 400, 20 + 300, rect)).toEqual([GRID_W - 1, GRID_H - 1]);
  });

  it('rounds to integers', () => {
    // 0.3 px / 0.5 = 0.6 → 1; 0.2 px / 0.5 = 0.4 → 0.
    expect(toGridPoint(10.3, 20.2, rect)).toEqual([1, 0]);
    const [x, y] = toGridPoint(123.456, 98.765, rect);
    expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
  });

  it('clamps a finger that slides off the canvas onto its edge', () => {
    expect(toGridPoint(-50, -50, rect)).toEqual([0, 0]);
    expect(toGridPoint(9999, 9999, rect)).toEqual([GRID_W - 1, GRID_H - 1]);
    expect(toGridPoint(Number.NaN, 30, rect)[0]).toBe(0);
  });

  it('uses the renderer letterbox when the element is not 4:3', () => {
    // 400×400: scale 0.5, grid 400×300 centred, 50 px bands top and bottom.
    const square = { left: 0, top: 0, width: 400, height: 400 };
    expect(toGridPoint(0, 50, square)).toEqual([0, 0]);
    expect(toGridPoint(200, 200, square)).toEqual([GRID_W / 2, GRID_H / 2]);
    expect(toGridPoint(200, 10, square)).toEqual([GRID_W / 2, 0]);
  });
});

describe('StrokeCapture (8.6, decision 0009)', () => {
  it('a tap is a one-point stroke (the renderer draws a dot)', () => {
    const c = new StrokeCapture();
    c.begin(ink, [5, 6]);
    expect(c.drawing).toBe(true);
    c.end();
    expect(c.strokes).toEqual([{ color: 2, size: 0, points: [[5, 6]] }]);
    expect(c.drawing).toBe(false);
  });

  it('drops a repeated point, so a still finger adds nothing', () => {
    const c = new StrokeCapture();
    c.begin(ink, [1, 1]);
    expect(c.extend([1, 1])).toBe(false);
    expect(c.extend([2, 1])).toBe(true);
    expect(c.extend([2, 1])).toBe(false);
    c.end();
    expect(c.strokes[0]!.points).toEqual([[1, 1], [2, 1]]);
  });

  it('shows the stroke in progress after the finished ones', () => {
    const c = new StrokeCapture();
    c.begin(ink, [0, 0]);
    c.extend([10, 0]);
    c.end();
    c.begin({ ...ink, color: 6 }, [3, 3]);
    c.extend([4, 9]);
    expect(c.visible.map((s) => s.color)).toEqual([2, 6]);
    expect(c.strokes).toHaveLength(1);
  });

  it('simplifies on release, keeping only points that matter (2.10.2)', () => {
    const c = new StrokeCapture();
    c.begin(ink, [0, 0]);
    for (let x = 1; x <= 100; x++) c.extend([x, 0]);
    c.end();
    expect(c.strokes[0]!.points).toEqual([[0, 0], [100, 0]]);
  });

  it('the eraser is a stroke in the background color with the chosen size', () => {
    expect(strokeColor(eraser)).toBe(ERASER_COLOR);
    expect(PALETTE[ERASER_COLOR]).toBe('#ffffff');
    const c = new StrokeCapture();
    c.begin(eraser, [7, 7]);
    c.end();
    expect(c.strokes[0]).toMatchObject({ color: ERASER_COLOR, size: 2 });
  });

  it('undo pops the last stroke; while drawing it drops the stroke in progress', () => {
    const c = new StrokeCapture();
    for (const x of [1, 2, 3]) {
      c.begin(ink, [x, x]);
      c.end();
    }
    c.undo();
    expect(c.strokes.map((s) => s.points[0])).toEqual([[1, 1], [2, 2]]);
    c.begin(ink, [9, 9]);
    c.undo();
    expect(c.drawing).toBe(false);
    expect(c.strokes).toHaveLength(2);
    c.undo();
    c.undo();
    const v = c.version;
    c.undo();
    expect(c.strokes).toEqual([]);
    expect(c.version).toBe(v);
  });

  it('clear empties the list, and nothing is left to undo', () => {
    const c = new StrokeCapture();
    c.begin(ink, [1, 1]);
    c.end();
    c.begin(ink, [2, 2]);
    c.clear();
    expect(c.strokes).toEqual([]);
    expect(c.drawing).toBe(false);
    c.undo();
    expect(c.strokes).toEqual([]);
  });

  it('bumps the version on every visible change, so the canvas repaints', () => {
    const c = new StrokeCapture();
    const seen = [c.version];
    c.begin(ink, [1, 1]);
    seen.push(c.version);
    c.extend([2, 2]);
    seen.push(c.version);
    c.end();
    seen.push(c.version);
    c.undo();
    seen.push(c.version);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('the wire list is exactly the canvas list, ends a stroke in progress, and decodes', () => {
    const c = new StrokeCapture();
    c.begin(ink, [0, 0]);
    c.extend([GRID_W - 1, GRID_H - 1]);
    c.end();
    c.begin(eraser, [4, 4]);
    c.extend([4, 40]);
    const wire = c.wire();
    expect(c.drawing).toBe(false);
    expect(wire).toEqual([
      { c: 2, s: 0, p: [0, 0, GRID_W - 1, GRID_H - 1] },
      { c: ERASER_COLOR, s: 2, p: [4, 4, 4, 40] },
    ]);
    const decoded = decodeStrokes(JSON.parse(JSON.stringify(wire)));
    expect(decoded.ok && decoded.strokes).toEqual(c.strokes);
  });

  it('refuses a tool outside the palette or sizes', () => {
    const c = new StrokeCapture();
    expect(() => c.begin({ eraser: false, color: ERASER_COLOR, size: 0 }, [0, 0])).toThrow(RangeError);
    expect(() => c.begin({ eraser: false, color: 1, size: BRUSH_SIZES.length }, [0, 0])).toThrow(RangeError);
  });

  it('starts from a restored draft', () => {
    const c = new StrokeCapture([{ color: 1, size: 1, points: [[1, 2]] }]);
    expect(c.strokes).toHaveLength(1);
  });
});

describe('tools (8.5)', () => {
  it('offers every palette color but the background as ink, eight of them (§9)', () => {
    expect(INK_COLORS).toHaveLength(PALETTE.length - 1);
    expect(INK_COLORS).toHaveLength(8);
    expect(INK_COLORS).not.toContain(ERASER_COLOR);
    expect(INK_COLORS).toContain(DEFAULT_TOOL.color);
  });

  it('names every color and size', () => {
    expect(PALETTE_LABELS).toHaveLength(PALETTE.length);
    expect(SIZE_LABELS).toHaveLength(BRUSH_SIZES.length);
  });
});
