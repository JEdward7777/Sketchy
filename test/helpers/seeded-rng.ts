import { rngFromSeed, rngNext, type RngState } from '../../src/shared/rng';

/**
 * A mutable convenience wrapper over the game's pure RNG (`src/shared/rng`,
 * stage 2.1), so a randomized test can draw inputs without threading state
 * and replays exactly from its seed. Same seed, same sequence as the game's
 * `rngNext` (asserted in test/unit/rng.test.ts).
 */
export interface TestRng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  pick<T>(items: readonly T[]): T;
}

export function seededRng(seed: number): TestRng {
  let state: RngState = rngFromSeed(seed);
  const next = (): number => {
    const r = rngNext(state);
    state = r.state;
    return r.value;
  };
  const int = (n: number): number => Math.floor(next() * n);
  return {
    next,
    int,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('pick from empty list');
      return items[int(items.length)]!;
    },
  };
}
