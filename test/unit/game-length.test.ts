/**
 * Stage 2.7 — faker pick, seating and game length: SPEC §7 as amended by
 * decision 0020 (random faker every round, totalRounds, cancelled rounds,
 * seating from the next round), 0018 (default 2 cycles) and 0019 (removed
 * players return).
 */
import { describe, expect, it } from 'vitest';
import {
  connectedRoster,
  CYCLES_DEFAULT,
  CYCLES_MAX,
  CYCLES_MIN,
  isGameOver,
  isValidCycles,
  pickFaker,
  recordRoundEnd,
  seatRoundRoster,
  startProgress,
  totalRounds,
  type SeatablePlayer,
} from '../../src/shared/game-length';
import { rngFromSeed, type RngState } from '../../src/shared/rng';

describe('pickFaker (2.7.1, 0020 item 1)', () => {
  it('takes only the RNG state and the connected roster', () => {
    expect(pickFaker.length).toBe(2);
  });

  it('every connected player gets picked, roughly uniformly, over seeded rounds', () => {
    const candidates = ['a', 'b', 'c', 'd', 'e'];
    let st: RngState = rngFromSeed(2020);
    const counts = new Map<string, number>();
    const rounds = 5000;
    for (let i = 0; i < rounds; i++) {
      const r = pickFaker(st, candidates);
      st = r.state;
      counts.set(r.value, (counts.get(r.value) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(candidates);
    // Expected rounds / 5 = 1000 each; allow ±15%.
    for (const n of counts.values()) expect(Math.abs(n - rounds / 5)).toBeLessThan((rounds / 5) * 0.15);
  });

  it('the same player can be picked twice in a row (no history)', () => {
    let st: RngState = rngFromSeed(1);
    let prev: string | null = null;
    let repeated = false;
    for (let i = 0; i < 50 && !repeated; i++) {
      const r = pickFaker(st, ['a', 'b', 'c']);
      st = r.state;
      repeated = r.value === prev;
      prev = r.value;
    }
    expect(repeated).toBe(true);
  });

  it('only connected roster players are candidates', () => {
    const roster = ['a', 'b', 'c', 'd'];
    const connected = new Set(['b', 'd']);
    const candidates = connectedRoster(roster, (id) => connected.has(id));
    expect(candidates).toEqual(['b', 'd']);
    let st: RngState = rngFromSeed(3);
    for (let i = 0; i < 200; i++) {
      const r = pickFaker(st, candidates);
      st = r.state;
      expect(connected.has(r.value)).toBe(true);
    }
  });

  it('throws with nobody to pick', () => {
    expect(() => pickFaker(rngFromSeed(1), [])).toThrow(RangeError);
  });
});

describe('cancelled rounds (2.7.2, §7, 0020 item 3)', () => {
  it('do not count toward the game length', () => {
    let p = startProgress(1, 3);
    p = recordRoundEnd(p, 'completed');
    p = recordRoundEnd(p, 'cancelled');
    p = recordRoundEnd(p, 'cancelled');
    expect(p.completedRounds).toBe(1);
    p = recordRoundEnd(recordRoundEnd(p, 'completed'), 'completed');
    expect(isGameOver(p)).toBe(true);
  });

  it('the next round picks a fresh faker: the pick depends only on the RNG state', () => {
    const roster = ['a', 'b', 'c', 'd'];
    const st = rngFromSeed(77);
    const cancelled = pickFaker(st, roster);
    // A re-pick from the advanced state is a fresh draw, not a carried-over faker.
    const next = pickFaker(cancelled.state, roster);
    expect(next.state).not.toEqual(cancelled.state);
    expect(pickFaker(cancelled.state, roster)).toEqual(next);
  });
});

describe('seating (2.7.3, 2.7.4; 0019, 0020 item 4)', () => {
  const room = (players: [string, boolean][]): SeatablePlayer[] =>
    players.map(([id, removed]) => ({ id, removed }));

  it('removed players are not seated and so cannot be picked', () => {
    const roster = seatRoundRoster(room([['a', false], ['b', true], ['c', false], ['d', false]]));
    expect(roster).toEqual(['a', 'c', 'd']);
    let st: RngState = rngFromSeed(4);
    for (let i = 0; i < 200; i++) {
      const r = pickFaker(st, roster);
      st = r.state;
      expect(r.value).not.toBe('b');
    }
  });

  it('a returning removed player is seated from the next round, not the current one', () => {
    let players = room([['a', false], ['b', true], ['c', false]]);
    const current = seatRoundRoster(players); // round k starts
    players = players.map((p) => (p.id === 'b' ? { ...p, removed: false } : p)); // b returns mid-round
    expect(current).toEqual(['a', 'c']); // the running round's roster is unchanged
    expect(seatRoundRoster(players)).toEqual(['a', 'b', 'c']); // round k + 1
  });

  it('a late joiner is seated from the next round', () => {
    const players = room([['a', false], ['b', false], ['c', false]]);
    const current = seatRoundRoster(players);
    const after = [...players, { id: 'late', removed: false }];
    expect(current).not.toContain('late');
    expect(seatRoundRoster(after)).toEqual(['a', 'b', 'c', 'late']);
  });

  it('disconnected players stay seated (their card goes dark) but are not faker candidates', () => {
    const roster = seatRoundRoster(room([['a', false], ['b', false], ['c', false]]));
    expect(roster).toContain('b');
    expect(connectedRoster(roster, (id) => id !== 'b')).toEqual(['a', 'c']);
  });
});

describe('game length (2.7.5; 0018, 0020 item 2)', () => {
  it('cycles are 1–3 with default 2', () => {
    expect([CYCLES_MIN, CYCLES_DEFAULT, CYCLES_MAX]).toEqual([1, 2, 3]);
    for (const ok of [1, 2, 3]) expect(isValidCycles(ok)).toBe(true);
    for (const bad of [0, 4, 1.5, '2', null]) expect(isValidCycles(bad)).toBe(false);
  });

  it('totalRounds = cycles × roster size at start', () => {
    for (const cycles of [1, 2, 3]) {
      for (const size of [3, 7, 10]) expect(totalRounds(cycles, size)).toBe(cycles * size);
    }
    expect(() => totalRounds(4, 5)).toThrow(RangeError);
    expect(() => totalRounds(2, -1)).toThrow(RangeError);
  });

  it('late joiners do not change it, and the game ends after that many completed rounds', () => {
    let p = startProgress(CYCLES_DEFAULT, 3); // 3 at host:start → 6 rounds
    const fixed = p.totalRounds;
    // A late joiner arrives: the progress record has no input for it, so the length stays.
    for (let i = 0; i < fixed - 1; i++) {
      p = recordRoundEnd(p, 'completed');
      expect(isGameOver(p)).toBe(false);
    }
    p = recordRoundEnd(p, 'completed');
    expect(p.totalRounds).toBe(CYCLES_DEFAULT * 3);
    expect(isGameOver(p)).toBe(true);
  });
});
