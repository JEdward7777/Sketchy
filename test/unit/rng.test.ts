/**
 * Stage 2.1 — the game's seeded RNG (`src/shared/rng`), used for the faker
 * pick (decision 0020 item 1), slideshow order (0007 item 2), the Mixed bag
 * (0007 item 3) and room codes (SPEC §14).
 */
import { describe, expect, it } from 'vitest';
import {
  isRngState,
  rngFromSeed,
  rngInt,
  rngNext,
  rngPick,
  shuffle,
  type RngState,
} from '../../src/shared/rng';
import { seededRng } from '../helpers/seeded-rng';

/** mulberry32 exactly as in scripts/measure-strokes.mjs, as a reference. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawMany(state: RngState, count: number): { values: number[]; state: RngState } {
  const values: number[] = [];
  let st = state;
  for (let i = 0; i < count; i++) {
    const r = rngNext(st);
    values.push(r.value);
    st = r.state;
  }
  return { values, state: st };
}

describe('rngNext', () => {
  it('is mulberry32: matches the reference sequence for several seeds', () => {
    for (const seed of [0, 1, 42, 20261123, 0xffffffff]) {
      const ref = mulberry32(seed);
      const { values } = drawMany(rngFromSeed(seed), 50);
      expect(values).toEqual(Array.from({ length: 50 }, () => ref()));
    }
  });

  it('is pure: the same state gives the same value, and the input is not mutated', () => {
    const s = rngFromSeed(7);
    const frozen = Object.freeze({ ...s });
    const a = rngNext(frozen);
    const b = rngNext(frozen);
    expect(a).toEqual(b);
    expect(frozen).toEqual(s);
    expect(a.state).not.toEqual(s);
  });

  it('state survives a JSON round trip (storage / hibernation) and replays exactly', () => {
    const { state } = drawMany(rngFromSeed(99), 17);
    const restored: unknown = JSON.parse(JSON.stringify(state));
    expect(isRngState(restored)).toBe(true);
    expect(drawMany(restored as RngState, 30).values).toEqual(drawMany(state, 30).values);
  });

  it('values lie in [0, 1)', () => {
    for (const v of drawMany(rngFromSeed(5), 2000).values) {
      expect(v >= 0 && v < 1).toBe(true);
    }
  });
});

describe('rngFromSeed and isRngState', () => {
  it('reduces any integer seed modulo 2^32', () => {
    expect(rngFromSeed(2 ** 32 + 5)).toEqual(rngFromSeed(5));
    expect(rngFromSeed(-1)).toEqual({ s: 2 ** 32 - 1 });
  });

  it('rejects non-integer seeds', () => {
    for (const bad of [0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => rngFromSeed(bad)).toThrow(RangeError);
    }
  });

  it('rejects malformed stored states', () => {
    for (const bad of [null, 3, {}, { s: -1 }, { s: 2 ** 32 }, { s: 1.5 }, { s: '1' }]) {
      expect(isRngState(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('rngInt and rngPick', () => {
  it('rngInt stays in range and hits every value', () => {
    let st = rngFromSeed(11);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const r = rngInt(st, 7);
      st = r.state;
      expect(Number.isInteger(r.value) && r.value >= 0 && r.value < 7).toBe(true);
      seen.add(r.value);
    }
    expect(seen.size).toBe(7);
  });

  it('rngInt rejects a non-positive or non-integer bound', () => {
    for (const bad of [0, -3, 2.5]) expect(() => rngInt(rngFromSeed(1), bad)).toThrow(RangeError);
  });

  it('rngPick rejects an empty list', () => {
    expect(() => rngPick(rngFromSeed(1), [])).toThrow(RangeError);
  });
});

describe('shuffle', () => {
  it('returns a permutation and leaves the input untouched', () => {
    const input = Object.freeze(['a', 'b', 'c', 'd', 'e', 'f']);
    const r = shuffle(rngFromSeed(3), input);
    expect([...r.value].sort()).toEqual([...input].sort());
    expect(input).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('is deterministic for a seed and uses items.length - 1 draws', () => {
    const items = [1, 2, 3, 4, 5];
    const a = shuffle(rngFromSeed(8), items);
    const b = shuffle(rngFromSeed(8), items);
    expect(a).toEqual(b);
    expect(a.state).toEqual(drawMany(rngFromSeed(8), items.length - 1).state);
    expect(shuffle(rngFromSeed(8), []).state).toEqual(rngFromSeed(8));
    expect(shuffle(rngFromSeed(8), ['x']).value).toEqual(['x']);
  });

  it('reaches every ordering of three items with roughly equal frequency', () => {
    let st = rngFromSeed(2026);
    const counts = new Map<string, number>();
    const trials = 6000;
    for (let i = 0; i < trials; i++) {
      const r = shuffle(st, ['a', 'b', 'c']);
      st = r.state;
      const key = r.value.join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    // Expected trials / 6 = 1000 each; allow ±15%.
    for (const n of counts.values()) expect(Math.abs(n - trials / 6)).toBeLessThan((trials / 6) * 0.15);
  });
});

describe('test helper', () => {
  it('seededRng replays the game RNG sequence for the same seed', () => {
    const helper = seededRng(42);
    expect(Array.from({ length: 25 }, () => helper.next())).toEqual(drawMany(rngFromSeed(42), 25).values);
  });
});
