/**
 * Which refusals a screen shows (pure, so the unit leg pins it). A screen
 * shows an error that arrives while it is mounted, and one that arrived
 * less than `FLASH_MS` before it mounted: a stale token refused during
 * "Checking your credentials…" arrives just before the join form mounts,
 * and must still be explained there. Older errors stay hidden. The
 * connection clears `error` on every phase change, so one phase's refusal
 * never shows on the next phase's screen.
 */

import type { GameError } from '../net/connection';

/** How long a refused-intent message stays up. */
export const FLASH_MS = 6000;

/** The counter a screen mounting at `now` treats as already seen. */
export function seenAtMount(error: GameError | null, now: number): number {
  if (!error) return 0;
  return now - error.at < FLASH_MS ? error.n - 1 : error.n;
}

/** How long `error` should still show at `now` (0 = not at all). */
export function flashRemaining(error: GameError, now: number): number {
  return Math.max(0, error.at + FLASH_MS - now);
}
