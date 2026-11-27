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
  validateWireStrokes,
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
    ['array-like points', JSON.parse('[{"c":0,"s":0,"p":{"0":1,"1":1,"length":2}}]')],
    ['a __proto__ key', JSON.parse('[{"c":0,"s":0,"p":[1,2],"__proto__":{"x":1}}]')],
    ['an infinite coordinate', JSON.parse('[{"c":0,"s":0,"p":[1e400,2]}]')],
  ])('rejects %s', (_name, value) => {
    expect(decodeStrokes(value).ok).toBe(false);
    expect(validateWireStrokes(value).ok).toBe(false);
  });

  it('accepts -0 and stores it as 0', () => {
    const r = validateWireStrokes(JSON.parse('[{"c":0,"s":0,"p":[-0,2]}]'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.stringify(r.strokes)).toBe('[{"c":0,"s":0,"p":[0,2]}]');
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

describe('validateWireStrokes: in place, for the server (phase 6 review)', () => {
  it('reuses the parsed point arrays: no per-point allocation, no second copy', () => {
    const frame = `[{"c":1,"s":0,"p":[${'1,1,'.repeat(200_000).slice(0, -1)}]},{"c":2,"s":1,"p":[5,6]}]`;
    const parsed = JSON.parse(frame) as { p: number[] }[];
    const r = validateWireStrokes(parsed);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.strokes[0]!.p).toBe(parsed[0]!.p);
    expect(r.strokes[1]!.p).toBe(parsed[1]!.p);
    // Never longer than the input it was parsed from.
    expect(JSON.stringify(r.strokes)).toBe(frame);
  });

  it('re-encodes no longer than its input, whatever the number spelling', () => {
    const frame = '[{"p":[1.0,1e2,7.00,0],"s":2,"c":3}]';
    const r = validateWireStrokes(JSON.parse(frame));
    expect(r.ok && JSON.stringify(r.strokes)).toBe('[{"c":3,"s":2,"p":[1,100,7,0]}]');
    expect(JSON.stringify(r.ok && r.strokes).length).toBeLessThanOrEqual(frame.length);
  });

  it('refuses what decodeStrokes refuses, with the same message', () => {
    for (const bad of ['x', [null], [{ c: 9, s: 0, p: [1, 1] }], [{ c: 1, s: 0, p: [1, 600] }], [{ c: 1, s: 0, p: [1] }]]) {
      const a = validateWireStrokes(bad);
      const b = decodeStrokes(bad);
      expect(a.ok).toBe(false);
      expect(a).toEqual(b);
    }
  });
});

describe('platform safety limit (0009 item 4, budget.md)', () => {
  it('is 1 MB (decision 0031), below both platform limits', () => {
    expect(STROKES_MAX_BYTES).toBe(1_000_000);
    expect(STROKES_MAX_BYTES).toBeLessThan(STORAGE_VALUE_LIMIT_BYTES / 2);
    expect(STROKES_MAX_BYTES).toBeLessThan(WS_MESSAGE_LIMIT_BYTES);
    expect(withinSafetyLimit(STROKES_MAX_BYTES)).toBe(true);
    expect(withinSafetyLimit(STROKES_MAX_BYTES + 1)).toBe(false);
  });

  it('is well above an honest full-timer scribble at the longest preset and the Custom maximum', () => {
    const relaxed = (TIMER_PRESETS.relaxed.drawMs / 1000) * MEASURED_WORST_BYTES_PER_SECOND;
    const customMax = (CUSTOM_TIMER_BOUNDS.drawMs.max / 1000) * MEASURED_WORST_BYTES_PER_SECOND;
    expect(relaxed).toBeCloseTo(208_864, 6); // the measured row itself
    expect(STROKES_MAX_BYTES / customMax).toBeGreaterThan(2.3); // 1e6 / (180 × 208,864 / 90) ≈ 2.39
    expect(STROKES_MAX_BYTES / relaxed).toBeGreaterThan(4.7); // 1e6 / 208,864 ≈ 4.79
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
