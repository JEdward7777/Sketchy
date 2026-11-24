/**
 * Stage 2.10.1 — stroke codec and validator, decision 0009 (amends SPEC §9):
 * palette colors, brush sizes, integer points on the fixed 4:3 grid, no cap
 * on strokes or points, only the platform safety limit (0009 item 4) derived
 * from harness/reference/budget.md.
 */
import { describe, expect, it } from 'vitest';
import {
  appendStroke,
  clearStrokes,
  decodeStrokes,
  encodeStrokes,
  undoStroke,
  withinSafetyLimit,
  type Stroke,
} from '../../src/shared/stroke-codec';
import {
  BRUSH_SIZES,
  ERASER_COLOR,
  GRID_H,
  GRID_W,
  MEASURED_WORST_BYTES_PER_SECOND,
  PALETTE,
  STORAGE_VALUE_LIMIT_BYTES,
  STROKES_MAX_BYTES,
  WS_MESSAGE_LIMIT_BYTES,
  BACKGROUND_COLOR,
} from '../../src/shared/stroke-format';
import { CUSTOM_TIMER_BOUNDS, TIMER_PRESETS } from '../../src/shared/timers';
import { seededRng } from '../helpers/seeded-rng';

function randomStrokes(seed: number, count: number, maxPoints: number): Stroke[] {
  const rng = seededRng(seed);
  return Array.from({ length: count }, () => ({
    color: rng.int(PALETTE.length),
    size: rng.int(BRUSH_SIZES.length),
    points: Array.from({ length: 1 + rng.int(maxPoints) }, () => [rng.int(GRID_W), rng.int(GRID_H)] as const),
  }));
}

describe('format constants', () => {
  it('the grid is 4:3 and integer', () => {
    expect(GRID_W * 3).toBe(GRID_H * 4);
    expect(Number.isInteger(GRID_H)).toBe(true);
  });

  it('about 8 ink colors plus the eraser, which is the background color; 2–3 sizes (§9)', () => {
    expect(PALETTE[ERASER_COLOR]).toBe(BACKGROUND_COLOR);
    expect(PALETTE.length - 1).toBe(8);
    expect(new Set(PALETTE).size).toBe(PALETTE.length);
    expect(BRUSH_SIZES.length).toBeGreaterThanOrEqual(2);
    expect(BRUSH_SIZES.length).toBeLessThanOrEqual(3);
  });
});

describe('encode / decode', () => {
  it('round-trips through JSON, seeded random drawings included', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const strokes = randomStrokes(seed, 1 + (seed % 7), 50);
      const wire: unknown = JSON.parse(JSON.stringify(encodeStrokes(strokes)));
      const back = decodeStrokes(wire);
      expect(back).toEqual({ ok: true, strokes });
    }
  });

  it('uses the flat point form', () => {
    const s: Stroke = { color: 1, size: 2, points: [[0, 0], [GRID_W - 1, GRID_H - 1]] };
    expect(JSON.stringify(encodeStrokes([s]))).toBe(`[{"c":1,"s":2,"p":[0,0,${GRID_W - 1},${GRID_H - 1}]}]`);
  });

  it('accepts an empty drawing, a dot, and the eraser', () => {
    expect(decodeStrokes([])).toEqual({ ok: true, strokes: [] });
    expect(decodeStrokes([{ c: ERASER_COLOR, s: 0, p: [5, 5] }])).toEqual({
      ok: true,
      strokes: [{ color: ERASER_COLOR, size: 0, points: [[5, 5]] }],
    });
  });

  it('has no cap on strokes or points', () => {
    const many = randomStrokes(9, 2000, 1);
    const long = [{ color: 1, size: 0, points: Array.from({ length: 50_000 }, (_, i) => [i % GRID_W, i % GRID_H] as const) }];
    expect(decodeStrokes(encodeStrokes(many)).ok).toBe(true);
    expect(decodeStrokes(encodeStrokes(long)).ok).toBe(true);
  });

  it.each<[string, unknown]>([
    ['not an array', { c: 0, s: 0, p: [0, 0] }],
    ['null', null],
    ['a stroke that is not an object', [[1, 0, [0, 0]]]],
    ['unknown color', [{ c: PALETTE.length, s: 0, p: [0, 0] }]],
    ['negative color', [{ c: -1, s: 0, p: [0, 0] }]],
    ['string color', [{ c: '#ff0000', s: 0, p: [0, 0] }]],
    ['unknown size', [{ c: 0, s: BRUSH_SIZES.length, p: [0, 0] }]],
    ['fractional size', [{ c: 0, s: 0.5, p: [0, 0] }]],
    ['x at the grid width', [{ c: 0, s: 0, p: [GRID_W, 0] }]],
    ['y at the grid height', [{ c: 0, s: 0, p: [0, GRID_H] }]],
    ['negative coordinate', [{ c: 0, s: 0, p: [-1, 0] }]],
    ['non-integer coordinate', [{ c: 0, s: 0, p: [1.5, 2] }]],
    ['string coordinate', [{ c: 0, s: 0, p: ['1', 2] }]],
    ['odd point list', [{ c: 0, s: 0, p: [1, 2, 3] }]],
    ['empty point list', [{ c: 0, s: 0, p: [] }]],
    ['nested points', [{ c: 0, s: 0, p: [[1, 2]] }]],
    ['missing key', [{ c: 0, p: [1, 2] }]],
    ['extra key', [{ c: 0, s: 0, p: [1, 2], x: 1 }]],
    ['one bad stroke after good ones', [{ c: 0, s: 0, p: [1, 2] }, { c: 0, s: 0, p: [1, 2] }, { c: 99, s: 0, p: [1, 2] }]],
  ])('rejects %s', (_name, value) => {
    const r = decodeStrokes(value);
    expect(r.ok).toBe(false);
  });

  it('never throws on hostile JSON, and never echoes large untrusted values', () => {
    const payloads = [
      '[{"c":{"toString":1},"s":0,"p":[0,0]}]',
      '[{"c":0,"s":[{"toString":1}],"p":[0,0]}]',
      '[{"c":0,"s":0,"p":[{"toString":1,"valueOf":1},0]}]',
      '[{"c":0,"s":0,"p":[0,{"toString":1,"valueOf":1}]}]',
      `[{"c":[${'1,'.repeat(500_000)}1],"s":0,"p":[0,0]}]`, // a ~1 MB array as the color
      `[{"c":0,"s":0,"p":[0,0],"${'k'.repeat(1_000_000)}":1}]`, // a 1 MB key
      `[{"c":"${'x'.repeat(1_000_000)}","s":0,"p":[0,0]}]`, // a 1 MB string
    ];
    for (const raw of payloads) {
      const value: unknown = JSON.parse(raw);
      let r: ReturnType<typeof decodeStrokes> | undefined;
      expect(() => (r = decodeStrokes(value)), raw.slice(0, 60)).not.toThrow();
      expect(r?.ok).toBe(false);
      expect(r?.ok === false && r.error.length).toBeLessThan(200);
    }
  });

  it('names the failing stroke', () => {
    const r = decodeStrokes([{ c: 0, s: 0, p: [1, 2] }, { c: 0, s: 0, p: [GRID_W, 0] }]);
    expect(r.ok === false && r.error).toMatch(/^stroke 1: point 0/);
  });
});

describe('platform safety limit (0009 item 4, budget.md)', () => {
  it('is half the storage-value limit, so below both platform limits', () => {
    expect(STROKES_MAX_BYTES).toBe(STORAGE_VALUE_LIMIT_BYTES / 2);
    expect(STROKES_MAX_BYTES).toBeLessThan(STORAGE_VALUE_LIMIT_BYTES);
    expect(STROKES_MAX_BYTES).toBeLessThan(WS_MESSAGE_LIMIT_BYTES);
    expect(withinSafetyLimit(STROKES_MAX_BYTES)).toBe(true);
    expect(withinSafetyLimit(STROKES_MAX_BYTES + 1)).toBe(false);
  });

  it('is well above an honest full-timer scribble at the longest preset and the Custom maximum', () => {
    const relaxed = (TIMER_PRESETS.relaxed.drawMs / 1000) * MEASURED_WORST_BYTES_PER_SECOND;
    const customMax = (CUSTOM_TIMER_BOUNDS.drawMs.max / 1000) * MEASURED_WORST_BYTES_PER_SECOND;
    expect(relaxed).toBeCloseTo(208_864, 6); // the measured row itself
    expect(STROKES_MAX_BYTES / customMax).toBeGreaterThan(9); // 4e6 / (180 × 208,864 / 90) ≈ 9.58
  });
});

describe('undo and clear on the stroke list (0009 item 1)', () => {
  const [a, b, c] = randomStrokes(3, 3, 5) as [Stroke, Stroke, Stroke];

  it('undo removes the last stroke; undo on empty is empty', () => {
    expect(undoStroke([a, b, c])).toEqual([a, b]);
    expect(undoStroke([])).toEqual([]);
  });

  it('clear empties the list, leaving nothing to undo', () => {
    expect(clearStrokes()).toEqual([]);
    expect(undoStroke(clearStrokes())).toEqual([]);
  });

  it('append then undo is the original list, and inputs are not mutated', () => {
    const list = Object.freeze([a, b]);
    expect(undoStroke(appendStroke(list, c))).toEqual([a, b]);
    expect(list).toEqual([a, b]);
  });
});
