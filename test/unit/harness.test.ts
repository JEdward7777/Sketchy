import { afterEach, describe, expect, it, vi } from 'vitest';
import { seededRng } from '../helpers/seeded-rng';

/** The unit leg's own tools work as later phases will rely on them. */
describe('unit leg tooling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fake timers control both Date.now and timers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const fired: number[] = [];
    setTimeout(() => fired.push(Date.now()), 2_500);
    vi.advanceTimersByTime(2_499);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual([1_000_000 + 2_500]);
  });

  it('the seeded RNG replays exactly from its seed', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const c = seededRng(43);
    const seqA = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(seqA);
    for (const x of seqA) expect(x >= 0 && x < 1).toBe(true);
  });
});
