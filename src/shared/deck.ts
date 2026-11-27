/**
 * The global word deck's pure parts (phase 5, `SPEC.md` §6): checking
 * `data/words.json`, shuffling, and taking the next word. `DeckDO`
 * (`src/worker/deck-do.ts`) holds one order and one `DeckPosition` per
 * difficulty in SQLite and calls these; nothing here touches storage or
 * makes randomness of its own, so the unit leg can script the shuffle.
 */

import { DIFFICULTIES, type Difficulty } from './difficulty-bag';
import { normalizeGuess, type WordEntry } from './guess';

export type WordList = Readonly<Record<Difficulty, readonly WordEntry[]>>;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string' && s.trim() !== '');
}

/**
 * The checked word list (stage 5.5). Throws naming every problem: a
 * difficulty missing or empty, an entry without a word or category, a
 * malformed `alt`, a word or alt that normalizes to nothing, or an answer
 * (word or alt) shared by two entries anywhere in the file. Answers are
 * compared after `normalizeGuess`, because two that normalize alike could
 * not be told apart by the guess check (§4): a faker's guess would match
 * both entries.
 */
export function parseWordList(raw: unknown): WordList {
  const problems: string[] = [];
  const diffs = (raw as { difficulties?: unknown } | null)?.difficulties;
  if (typeof diffs !== 'object' || diffs === null) throw new Error('words: no "difficulties" object');
  /**
   * Normalized answer → the entry that owns it, by position (`concrete[3]`),
   * so two entries with the very same word still collide; the word is kept
   * only for the message.
   */
  const owner = new Map<string, { id: string; word: string }>();
  const claim = (answer: string, id: string, word: string, what: string) => {
    const key = normalizeGuess(answer);
    if (key === '') return void problems.push(`${what} "${answer}" of "${word}" normalizes to nothing`);
    const prior = owner.get(key);
    if (prior === undefined) owner.set(key, { id, word });
    else if (prior.id !== id) problems.push(`${what} "${answer}" of "${word}" (${id}) duplicates "${prior.word}" (${prior.id})`);
  };
  const out = {} as Record<Difficulty, WordEntry[]>;
  for (const d of DIFFICULTIES) {
    const list = (diffs as Record<string, unknown>)[d];
    out[d] = [];
    if (!Array.isArray(list) || list.length === 0) {
      problems.push(`difficulty "${d}" is missing or empty`);
      continue;
    }
    list.forEach((e: unknown, i) => {
      const { word, category, alt } = (e ?? {}) as { word?: unknown; category?: unknown; alt?: unknown };
      if (typeof word !== 'string' || word.trim() === '') return void problems.push(`${d}[${i}] has no word`);
      if (typeof category !== 'string' || category.trim() === '') problems.push(`"${word}" has no category`);
      claim(word, `${d}[${i}]`, word, 'word');
      if (alt !== undefined && !isStringArray(alt)) problems.push(`"${word}" has a malformed alt`);
      out[d].push(alt === undefined ? { word, category: category as string } : { word, category: category as string, alt: alt as string[] });
    });
  }
  // Alts after every word, so a word is reported as the owner of its own spelling.
  for (const d of DIFFICULTIES) out[d].forEach((e, i) => { if (isStringArray(e.alt)) for (const a of e.alt) claim(a, `${d}[${i}]`, e.word, 'alt'); });
  const extra = Object.keys(diffs).filter((k) => !(DIFFICULTIES as readonly string[]).includes(k));
  if (extra.length > 0) problems.push(`unknown difficulties: ${extra.join(', ')}`);
  if (problems.length > 0) throw new Error(`words: ${problems.join('; ')}`);
  return out;
}

/** A uniform integer in `[0, n)`; the deck's only source of randomness. */
export type RandomInt = (n: number) => number;

/**
 * A fresh deal order for `count` words: a permutation of `0 … count − 1`
 * by Fisher–Yates, one `randomInt` call per swap (`count − 1` calls). The
 * deck passes a CSPRNG here (`DeckDO`), never a seeded generator: an order
 * derived from a 32-bit seed could be recovered by brute force from a
 * handful of words a player has seen, revealing the words to come.
 */
export function shuffledOrder(count: number, randomInt: RandomInt): number[] {
  const out = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new RangeError(`randomInt(${i + 1}) returned ${j}`);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** True when `order` is a permutation of `0 … count − 1` (e.g. read back from storage). */
export function isOrder(order: unknown, count: number): order is number[] {
  if (!Array.isArray(order) || order.length !== count) return false;
  const seen = new Set<number>();
  for (const i of order) {
    if (!Number.isInteger(i) || i < 0 || i >= count || seen.has(i)) return false;
    seen.add(i);
  }
  return true;
}

/** Where one difficulty's deck stands: the next index into its order, and how many shuffles it has had. */
export interface DeckPosition {
  /** `0 … count`; `count` means the shuffle is used up and the next deal reshuffles. */
  readonly pos: number;
  readonly shuffles: number;
}

export interface Drawn {
  /** Index into the difficulty's word list. */
  readonly index: number;
  /**
   * True only when every word of the difficulty is in `exclude`: the deck
   * then deals its next word anyway (decision 0028) instead of finding none.
   */
  readonly repeat: boolean;
  readonly next: DeckPosition;
  /** The new order when this draw reshuffled (store it), otherwise null. */
  readonly reshuffled: readonly number[] | null;
}

/**
 * Take the next word (§6): walk `order` from `at.pos`, skipping words in
 * `exclude`; when the order runs out (or there is none, or it no longer
 * fits the list), reshuffle with `freshOrder()` and go on from the start.
 * Skipped words are used up for everyone in this shuffle, like any dealt
 * word. Unless every word is excluded, a usable word is at most
 * `(count − pos) + count` steps away (the rest of this shuffle, then one
 * whole new one), so the walk is bounded by `2 × count + 1`.
 */
export function drawNext(
  words: readonly WordEntry[],
  at: DeckPosition,
  order: readonly number[] | null,
  exclude: ReadonlySet<string>,
  freshOrder: () => readonly number[],
): Drawn {
  const count = words.length;
  if (count === 0) throw new RangeError('drawNext from an empty deck');
  const repeat = words.every((w) => exclude.has(w.word));
  let { pos, shuffles } = at;
  let current = order;
  let reshuffled: readonly number[] | null = null;
  if (!current || current.length !== count) pos = count;
  for (let step = 0; step <= 2 * count; step++) {
    if (pos >= count || !current) {
      current = reshuffled = freshOrder();
      pos = 0;
      shuffles += 1;
    }
    const index = current[pos]!;
    pos += 1;
    if (repeat || !exclude.has(words[index]!.word)) return { index, repeat, next: { pos, shuffles }, reshuffled };
  }
  throw new Error('drawNext: no word found within two shuffles');
}
