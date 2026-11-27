/**
 * Where `RoomDO` gets a round's word (the `dealWord` effect, `SPEC.md` §6).
 *
 * TEMPORARY STUB (phase 4). The real source is the singleton `DeckDO`
 * (phase 5, stages 5.1–5.3): a seeded global shuffle per difficulty over
 * `data/words.json`. Until then `stubWordSource` picks uniformly from a small
 * fixed list copied from that file. Phase 5 replaces `stubWordSource` behind
 * the same `WordSource` interface; nothing in the room adapter should need
 * to change.
 *
 * The pick uses Web Crypto: the word is secret until the guess resolves, so
 * it must not be predictable from anything a client sees.
 */

import type { Difficulty } from '../shared/difficulty-bag';
import type { WordEntry } from '../shared/guess';

export interface WordSource {
  /**
   * The next word of `difficulty`, skipping `exclude` (the words already
   * dealt this game). May reject (phase 5's DeckDO call can fail); the room
   * then retries from its alarm (observation O-07).
   */
  deal(difficulty: Difficulty, exclude: readonly string[]): Promise<WordEntry>;
}

/** Copied from `data/words.json`. Small on purpose: this list is a stub, not the deck. */
const STUB_WORDS: Readonly<Record<Difficulty, readonly WordEntry[]>> = {
  concrete: [
    { word: 'sock', category: 'Clothing' },
    { word: 'hat', category: 'Clothing' },
    { word: 'pizza', category: 'Food' },
    { word: 'banana', category: 'Food' },
    { word: 'giraffe', category: 'Animals' },
    { word: 'octopus', category: 'Animals' },
    { word: 'toaster', category: 'Around the House' },
    { word: 'umbrella', category: 'Around the House' },
    { word: 'kite', category: 'Toys & Games' },
    { word: 'rocket', category: 'Vehicles' },
    { word: 'cactus', category: 'Nature' },
    { word: 'volcano', category: 'Nature' },
  ],
  medium: [
    { word: 'beach', category: 'Places' },
    { word: 'library', category: 'Places' },
    { word: 'birthday', category: 'Events & Holidays' },
    { word: 'wedding', category: 'Events & Holidays' },
    { word: 'camping', category: 'Activities' },
    { word: 'fishing', category: 'Activities' },
    { word: 'winter', category: 'Weather & Seasons' },
    { word: 'summer', category: 'Weather & Seasons' },
    { word: 'doctor', category: 'Jobs' },
    { word: 'firefighter', category: 'Jobs' },
    { word: 'music', category: 'Sounds & Senses' },
    { word: 'echo', category: 'Sounds & Senses' },
  ],
  abstract: [
    { word: 'love', category: 'Feelings' },
    { word: 'time', category: 'Ideas' },
    { word: 'freedom', category: 'Ideas' },
    { word: 'kind', category: 'Qualities' },
    { word: 'strong', category: 'Qualities' },
    { word: 'growth', category: 'Big Concepts' },
    { word: 'change', category: 'Big Concepts' },
  ],
};

/** An index below `n`; the modulo bias is below `n / 2^32`, harmless for a stub list. */
function randomIndex(n: number): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! % n;
}

/**
 * Known stub limit: once every word of a difficulty has been dealt in one
 * game, it ignores `exclude`, the reducer asks again (§6 "skip it"), and the
 * room's bounded re-deal falls back to the retry alarm, so the round stays
 * in `dealing`. A game needs more rounds of one difficulty than the list
 * holds (7 abstract) to hit it. Phase 5's deck reshuffles instead.
 */
export const stubWordSource: WordSource = {
  async deal(difficulty, exclude) {
    const all = STUB_WORDS[difficulty];
    const fresh = all.filter((w) => !exclude.includes(w.word));
    const pool = fresh.length > 0 ? fresh : all;
    return pool[randomIndex(pool.length)]!;
  },
};

let source: WordSource = stubWordSource;

export function wordSource(): WordSource {
  return source;
}

/** Test seam, like `setClockForTests`: a scripted or failing source, or null to restore the stub. */
export function setWordSourceForTests(s: WordSource | null): void {
  source = s ?? stubWordSource;
}
