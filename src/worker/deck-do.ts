import { DurableObject } from 'cloudflare:workers';
import wordsJson from '../../data/words.json';
import { drawNext, isOrder, parseWordList, shuffledOrder, type DeckPosition, type RandomInt, type WordList } from '../shared/deck';
import { DIFFICULTIES, type Difficulty } from '../shared/difficulty-bag';
import type { WordEntry } from '../shared/guess';
import { randomBelow } from './random';

/** What `deal` answers. `repeat` is true only when every word of the difficulty was excluded (decision 0028). */
export interface DealtWord {
  readonly entry: WordEntry;
  readonly repeat: boolean;
}

interface PosRow {
  pos: number;
  shuffles: number;
  [key: string]: SqlStorageValue;
}

interface OrderRow {
  ord: string;
  [key: string]: SqlStorageValue;
}

/** Where shuffle swaps get their randomness: the CSPRNG, or a test's scripted source. */
let randomInt: RandomInt = randomBelow;

/** Test seam, like `setClockForTests`: a scripted `[0, n)` source for the shuffle, or null to restore the CSPRNG. */
export function setDeckRandomForTests(f: RandomInt | null): void {
  randomInt = f ?? randomBelow;
}

/**
 * The singleton global word deck (`SPEC.md` §6, §13), addressed by
 * `DECK_NAME` (`./words`). Per difficulty, SQLite holds the current
 * shuffle's order (`deck_order`, written once per reshuffle) and the next
 * position in it (`deck_pos`, written once per deal); the order is also
 * cached in memory, so a deal reads one row and writes one row.
 *
 * Each order is a Fisher–Yates shuffle drawing every swap from Web Crypto
 * (`randomBelow`, rejection-sampled), not from a seed: the order decides
 * every room's secret word, and an order derived from a 32-bit seed could
 * be recovered by brute force from a few words a player has seen. The
 * words are bundled from `data/words.json` and checked once per instance
 * (`parseWordList`); a bad file fails every deal loudly rather than dealing
 * from a broken list. A stored order whose length no longer matches the
 * list (words.json changed) is replaced by a fresh shuffle at the next deal.
 *
 * `deal` has no `await`, so two rooms' calls never interleave: each sees
 * the position the previous one wrote, and two rooms never get the same
 * word within one shuffle.
 */
export class DeckDO extends DurableObject<Env> {
  private readonly words: WordList;
  /** The stored order per difficulty, once read or written by this instance (only this instance writes it). */
  private readonly orders = new Map<Difficulty, readonly number[] | null>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    try {
      this.words = parseWordList(wordsJson);
    } catch {
      // The detail names words, and the room logs a failed deal's message;
      // the unit leg's words.json check reports the detail instead.
      throw new Error('data/words.json failed its check');
    }
    const sql = ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS deck_pos (difficulty TEXT PRIMARY KEY, pos INTEGER NOT NULL, shuffles INTEGER NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS deck_order (difficulty TEXT PRIMARY KEY, ord TEXT NOT NULL)`);
  }

  /**
   * The next word of `difficulty`, skipping `exclude` (the room's words
   * already dealt this game, §6). When the shuffle runs out it reshuffles.
   * When every word of the difficulty is excluded it deals the next word
   * anyway with `repeat: true`, so a room never waits on a deck that
   * cannot answer (decision 0028).
   */
  deal(difficulty: Difficulty, exclude: readonly string[]): DealtWord {
    if (!(DIFFICULTIES as readonly unknown[]).includes(difficulty)) throw new RangeError('deal: unknown difficulty');
    if (!Array.isArray(exclude) || !exclude.every((w) => typeof w === 'string')) throw new TypeError('deal: exclude must be a list of words');
    const words = this.words[difficulty];
    const sql = this.ctx.storage.sql;
    const row = sql.exec<PosRow>(`SELECT pos, shuffles FROM deck_pos WHERE difficulty = ?`, difficulty).toArray()[0];
    const at: DeckPosition = row ? { pos: Math.min(Math.max(row.pos, 0), words.length), shuffles: row.shuffles } : { pos: 0, shuffles: 0 };
    const drawn = drawNext(words, at, this.order(difficulty, words.length), new Set(exclude), () => shuffledOrder(words.length, randomInt));
    if (drawn.reshuffled) {
      sql.exec(
        `INSERT INTO deck_order (difficulty, ord) VALUES (?, ?)
         ON CONFLICT (difficulty) DO UPDATE SET ord = excluded.ord`,
        difficulty,
        JSON.stringify(drawn.reshuffled),
      );
      this.orders.set(difficulty, drawn.reshuffled);
    }
    sql.exec(
      `INSERT INTO deck_pos (difficulty, pos, shuffles) VALUES (?, ?, ?)
       ON CONFLICT (difficulty) DO UPDATE SET pos = excluded.pos, shuffles = excluded.shuffles`,
      difficulty,
      drawn.next.pos,
      drawn.next.shuffles,
    );
    const e = words[drawn.index]!;
    return { entry: e.alt ? { word: e.word, category: e.category, alt: [...e.alt] } : { word: e.word, category: e.category }, repeat: drawn.repeat };
  }

  /** The current order, from memory or storage; null when there is none, or it is not a permutation of `count` words (words.json changed). */
  private order(difficulty: Difficulty, count: number): readonly number[] | null {
    if (!this.orders.has(difficulty)) {
      const row = this.ctx.storage.sql.exec<OrderRow>(`SELECT ord FROM deck_order WHERE difficulty = ?`, difficulty).toArray()[0];
      let ord: unknown = null;
      if (row) {
        try {
          ord = JSON.parse(row.ord);
        } catch {
          ord = null;
        }
      }
      this.orders.set(difficulty, isOrder(ord, count) ? ord : null);
    }
    return this.orders.get(difficulty) ?? null;
  }
}
