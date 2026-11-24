/**
 * Slideshow timing (stage 2.4, `SPEC.md` §4 phase 3, §8, §14).
 *
 * The room sends one absolute start time; every phone derives which card is
 * showing from `start + i × perSlide`, so no per-slide messages are needed
 * (harness/AGENTS.md §5). The slideshow is two full passes over `n` cards:
 * slide `i` (0-based over both passes) is card `i mod n` in pass
 * `floor(i / n)`.
 *
 * `n` counts every card, "went dark" cards included, and the card set is
 * fixed when the slideshow starts (decision 0007 item 7). Times are epoch
 * milliseconds; `perSlide` is milliseconds.
 */

export const SLIDESHOW_PASSES = 2;

export type SlidePosition =
  | { readonly status: 'before' }
  /** `card` is the index into the round's card order; `pass` is 0 or 1. */
  | { readonly status: 'showing'; readonly card: number; readonly pass: number }
  | { readonly status: 'ended' };

function checkArgs(perSlide: number, n: number): void {
  if (!(perSlide > 0) || !Number.isFinite(perSlide)) throw new RangeError(`perSlide must be positive, got ${perSlide}`);
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`n must be a non-negative integer, got ${n}`);
}

/** When the second pass ends: `start + n × 2 × perSlide` (§8). */
export function slideshowEnd(start: number, perSlide: number, n: number): number {
  checkArgs(perSlide, n);
  return start + n * SLIDESHOW_PASSES * perSlide;
}

/**
 * Which card is on screen at `now`. A slide's interval includes its start
 * and excludes its end, so at exactly `slideshowEnd` the slideshow has
 * `ended`. A phone whose offset-corrected clock reads before `start` gets
 * `before`.
 */
export function slideIndex(now: number, start: number, perSlide: number, n: number): SlidePosition {
  const end = slideshowEnd(start, perSlide, n);
  if (now < start) return { status: 'before' };
  if (now >= end) return { status: 'ended' };
  const i = Math.floor((now - start) / perSlide);
  return { status: 'showing', card: i % n, pass: Math.floor(i / n) };
}
