import { describe, expect, it } from 'vitest';
import { earliestDeadline, partitionDue } from '../../src/shared/deadlines';
import { seededRng } from '../helpers/seeded-rng';

describe('earliestDeadline', () => {
  it('is null for no deadlines', () => {
    expect(earliestDeadline([])).toBeNull();
  });

  it('ignores non-finite values', () => {
    expect(earliestDeadline([Number.NaN, Number.POSITIVE_INFINITY, 5])).toBe(5);
  });

  it('matches Math.min over seeded random lists', () => {
    const rng = seededRng(20261123);
    for (let i = 0; i < 200; i++) {
      const list = Array.from({ length: 1 + rng.int(8) }, () => 1_700_000_000_000 + rng.int(1e9));
      expect(earliestDeadline(list)).toBe(Math.min(...list));
    }
  });
});

describe('partitionDue', () => {
  it('treats a deadline exactly at now as due, and orders the due ones', () => {
    const list = [
      { name: 'b', dueAt: 20 },
      { name: 'a', dueAt: 10 },
      { name: 'c', dueAt: 30 },
    ];
    const { due, pending } = partitionDue(list, 20);
    expect(due.map((d) => d.name)).toEqual(['a', 'b']);
    expect(pending.map((d) => d.name)).toEqual(['c']);
  });
});
