/**
 * Stage 2.8 — the Mixed-difficulty bag (SPEC §6, decision 0007 item 3) and
 * shared final placement (0007 item 4).
 */
import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, nextDifficulty, type Difficulty } from '../../src/shared/difficulty-bag';
import { placements } from '../../src/shared/placement';
import { rngFromSeed, type RngState } from '../../src/shared/rng';

describe('nextDifficulty', () => {
  it('a fixed setting returns itself and leaves bag and RNG untouched', () => {
    const st = rngFromSeed(1);
    for (const d of DIFFICULTIES) {
      expect(nextDifficulty(d, ['medium'], st)).toEqual({ difficulty: d, bag: ['medium'], state: st });
    }
  });

  it('Mixed takes the next bag entry without drawing randomness', () => {
    const st = rngFromSeed(1);
    expect(nextDifficulty('mixed', ['abstract', 'concrete'], st)).toEqual({
      difficulty: 'abstract',
      bag: ['concrete'],
      state: st,
    });
  });

  it('Mixed: every bag of three holds each difficulty once, and the bag refills when empty', () => {
    let bag: readonly Difficulty[] = [];
    let st: RngState = rngFromSeed(42);
    const orders = new Set<string>();
    for (let b = 0; b < 200; b++) {
      const got: Difficulty[] = [];
      for (let i = 0; i < DIFFICULTIES.length; i++) {
        const r = nextDifficulty('mixed', bag, st);
        got.push(r.difficulty);
        bag = r.bag;
        st = r.state;
      }
      expect(bag).toEqual([]);
      expect([...got].sort()).toEqual([...DIFFICULTIES].sort());
      orders.add(got.join(','));
    }
    expect(orders.size).toBe(6); // all 3! orders occur: not a fixed rotation
  });
});

describe('placements (shared placement 1, 1, 3)', () => {
  it('ties share a place and the next place skips', () => {
    const r = placements([
      { id: 'c', score: 5 },
      { id: 'a', score: 9 },
      { id: 'b', score: 9 },
      { id: 'd', score: 2 },
    ]);
    expect(r.map((p) => [p.id, p.place])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 3],
      ['d', 4],
    ]);
  });

  it('everyone tied is first; empty input is empty', () => {
    expect(placements([{ id: 'x', score: 0 }, { id: 'y', score: 0 }]).map((p) => p.place)).toEqual([1, 1]);
    expect(placements([])).toEqual([]);
  });

  it('a three-way tie below first: 1, 2, 2, 2, 5', () => {
    const r = placements([10, 7, 7, 7, 1].map((score, i) => ({ id: `p${i}`, score })));
    expect(r.map((p) => p.place)).toEqual([1, 2, 2, 2, 5]);
  });
});
