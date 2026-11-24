/**
 * Round difficulty (stage 2.8, `SPEC.md` §6, decision 0007 item 3).
 *
 * The host picks Concrete, Medium, Abstract or Mixed. Mixed draws from a
 * shuffled bag holding each difficulty once; each round takes the next, and
 * the bag refills and reshuffles when empty. Over any run of whole bags every
 * difficulty comes up equally often, yet the order stays unpredictable.
 */

import { shuffle, type RngState } from './rng';

export const DIFFICULTIES = ['concrete', 'medium', 'abstract'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export type DifficultySetting = Difficulty | 'mixed';

export interface DifficultyDraw {
  readonly difficulty: Difficulty;
  /** What is left in the bag; store it for the next round. */
  readonly bag: readonly Difficulty[];
  readonly state: RngState;
}

/**
 * The difficulty for the next round. For a fixed setting the bag and RNG are
 * returned unchanged; for Mixed the next bag entry is taken, refilling with a
 * fresh shuffle of all three first when the bag is empty.
 */
export function nextDifficulty(
  setting: DifficultySetting,
  bag: readonly Difficulty[],
  state: RngState,
): DifficultyDraw {
  if (setting !== 'mixed') return { difficulty: setting, bag, state };
  let current = bag;
  let st = state;
  if (current.length === 0) {
    const r = shuffle(st, DIFFICULTIES);
    current = r.value;
    st = r.state;
  }
  return { difficulty: current[0]!, bag: current.slice(1), state: st };
}
