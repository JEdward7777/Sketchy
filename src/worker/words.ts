/**
 * Where `RoomDO` gets a round's word (the `dealWord` effect, `SPEC.md` §6):
 * the singleton `DeckDO`, over RPC (phase 5, stages 5.1–5.3).
 *
 * The room awaits the call outside its load → reduce → persist step and
 * feeds the answer back as a fresh `wordDealt` event (protocol.md "The
 * adapter as built"), so nothing here runs inside the room's critical
 * section.
 */

import type { Difficulty } from '../shared/difficulty-bag';
import type { DealtWord } from './deck-do';

export type { DealtWord } from './deck-do';

/** The one global deck's Durable Object name (§6: shared by every game everywhere). */
export const DECK_NAME = 'global';

export interface WordSource {
  /**
   * The next word of `difficulty`, skipping `exclude` (the words already
   * dealt this game). `repeat` is true when every word of the difficulty
   * was excluded and one was dealt anyway (decision 0028). May reject (the
   * RPC can fail); the room then retries from its alarm (observation O-07).
   */
  deal(difficulty: Difficulty, exclude: readonly string[]): Promise<DealtWord>;
}

/** The real source: `DeckDO` under `DECK_NAME`. */
export function deckWordSource(env: Env): WordSource {
  return {
    async deal(difficulty, exclude) {
      const { entry, repeat } = await env.DECK.getByName(DECK_NAME).deal(difficulty, [...exclude]);
      return { entry: entry.alt ? { word: entry.word, category: entry.category, alt: [...entry.alt] } : { word: entry.word, category: entry.category }, repeat };
    },
  };
}

let override: WordSource | null = null;

export function wordSource(env: Env): WordSource {
  return override ?? deckWordSource(env);
}

/** Test seam, like `setClockForTests`: a scripted or failing source, or null to restore the deck. */
export function setWordSourceForTests(s: WordSource | null): void {
  override = s;
}
