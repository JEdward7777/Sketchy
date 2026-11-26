import { describe, expect, it } from 'vitest';
import { projectPublic, reduce } from '../../../src/shared/core';
import { BRIEFING_BEAT_MS } from '../../../src/shared/core/rules';
import { mix32, rngAbsorb } from '../../../src/shared/rng';
import { RoomDriver } from '../../helpers/room';

/**
 * Fresh entropy on every `reduce` call (observation O-10, decision 0020
 * item 5): the faker generator absorbs 32 unseen bits before each call's
 * random choices, so published outputs (revealed fakers, Mixed draws) can
 * never pin it; the slideshow-order stream absorbs a separately mixed copy.
 */

/** A room in round results, ready for the continue that starts round 2. */
function inResults(): RoomDriver {
  const r = new RoomDriver(3);
  const ids = r.joinMany(5);
  r.start(ids[0]!);
  r.advance(BRIEFING_BEAT_MS);
  r.drawAll();
  r.voteAll();
  r.fireNext();
  r.intent(r.faker, { type: 'guess:submit', text: 'umbrella' });
  expect(r.phase).toBe('results');
  return r;
}

describe('entropy on every reduce call (O-10)', () => {
  it('the same state started with different entropy can pick different fakers; the same entropy picks the same one', () => {
    const r = new RoomDriver(1);
    const ids = r.joinMany(5);
    const start = { kind: 'intent', conn: 'c', player: ids[0]!, intent: { type: 'host:start' } } as const;
    const fakerWith = (e: number) => reduce(r.state, start, r.now, e).state.round!.faker;
    const fakers = new Set(Array.from({ length: 40 }, (_, i) => fakerWith(mix32(i + 1))));
    expect(fakers.size).toBeGreaterThan(1);
    expect(fakerWith(777)).toBe(fakerWith(777));
  });

  it('after a revealed round, the next faker still depends on entropy the next call brings, not only on the stored state', () => {
    const r = inResults();
    const next = { kind: 'intent', conn: 'c', player: r.state.hostId!, intent: { type: 'host:next', seq: r.state.phaseSeq } } as const;
    const fakers = new Set(Array.from({ length: 40 }, (_, i) => reduce(r.state, next, r.now, mix32(i + 100)).state.round!.faker));
    expect(fakers.size).toBeGreaterThan(1);
  });

  it('every call absorbs it, ticks included, into both streams, and the streams stay apart', () => {
    const r = new RoomDriver(5, undefined, undefined, 5); // same seed for both streams
    const a = reduce(r.state, { kind: 'tick' }, r.now, 1).state;
    const b = reduce(r.state, { kind: 'tick' }, r.now, 2).state;
    expect(a.rng).not.toEqual(b.rng);
    expect(a.orderRng).not.toEqual(b.orderRng);
    expect(a.rng).not.toEqual(a.orderRng);
    // Generators are never public (0020 item 5): entropy changes them, not public state.
    expect(JSON.stringify(projectPublic(a))).toBe(JSON.stringify(projectPublic(b)));
  });

  it('the slideshow order depends on the call entropy too', () => {
    const orders = new Set<string>();
    for (let k = 0; k < 8; k++) {
      const r = new RoomDriver(1);
      let n = 0;
      r.entropy = () => mix32(++n * 1000 + k);
      const ids = r.joinMany(5);
      r.start(ids[0]!);
      r.advance(BRIEFING_BEAT_MS);
      r.drawAll();
      orders.add(r.state.round!.cards!.join());
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('absorbing mixes with full avalanche: one flipped entropy bit flips about half the state bits', () => {
    const bits = (x: number) => x.toString(2).split('').filter((c) => c === '1').length;
    const base = rngAbsorb({ s: 0x12345678 }, 0xcafef00d).s;
    let total = 0;
    for (let i = 0; i < 32; i++) total += bits((base ^ rngAbsorb({ s: 0x12345678 }, (0xcafef00d ^ (1 << i)) >>> 0).s) >>> 0);
    expect(total / 32).toBeGreaterThan(12);
    expect(total / 32).toBeLessThan(20);
  });

  it('refuses entropy that is not an unsigned 32-bit integer', () => {
    const r = new RoomDriver(1);
    for (const bad of [-1, 2 ** 32, 1.5, Number.NaN]) expect(() => reduce(r.state, { kind: 'tick' }, r.now, bad)).toThrow(RangeError);
  });
});
