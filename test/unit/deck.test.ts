/**
 * Phase 5 — the deck's pure parts (`src/shared/deck.ts`): the words.json
 * check (5.5), the seeded order, and `drawNext` (5.2, decision 0028).
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawNext, isOrder, parseWordList, shuffledOrder, type DeckPosition, type RandomInt } from '../../src/shared/deck';
import { rngFromSeed, rngInt } from '../../src/shared/rng';
import { randomBelow } from '../../src/worker/random';
import { DIFFICULTIES } from '../../src/shared/difficulty-bag';
import { normalizeGuess, type WordEntry } from '../../src/shared/guess';

/** A reproducible `[0, n)` source for tests only: the deck itself never uses a seeded generator. */
function scripted(seed: number): RandomInt {
  let st = rngFromSeed(seed);
  return (n) => {
    const r = rngInt(st, n);
    st = r.state;
    return r.value;
  };
}

const raw = JSON.parse(readFileSync(new URL('../../data/words.json', import.meta.url), 'utf8')) as {
  difficulties: Record<string, { word: string; category?: string }[]>;
};

describe('data/words.json (5.5)', () => {
  it('passes parseWordList, keeping every entry of every difficulty', () => {
    const list = parseWordList(raw);
    for (const d of DIFFICULTIES) {
      // Counts come from the file itself, so expanding the list needs no test change.
      expect(raw.difficulties[d]!.length).toBeGreaterThan(0);
      expect(list[d]).toHaveLength(raw.difficulties[d]!.length);
    }
    expect(Object.keys(raw.difficulties).sort()).toEqual([...DIFFICULTIES].sort());
  });

  it('every word is unique across the whole file, after guess normalization', () => {
    const all = Object.values(raw.difficulties).flat().map((e) => normalizeGuess(e.word));
    expect(new Set(all).size).toBe(all.length);
  });

  it('every entry has a non-empty category', () => {
    for (const e of Object.values(raw.difficulties).flat()) expect(e.category?.trim()).toBeTruthy();
  });
});

describe('parseWordList refuses a broken list', () => {
  const ok = { word: 'sock', category: 'Clothing' };
  const base = () => ({ concrete: [ok], medium: [{ word: 'beach', category: 'Places' }], abstract: [{ word: 'love', category: 'Feelings' }] });

  it('accepts a minimal good list', () => {
    expect(parseWordList({ difficulties: base() }).concrete).toEqual([ok]);
  });

  it('a word repeated in another difficulty, even with other case or punctuation', () => {
    expect(() => parseWordList({ difficulties: { ...base(), abstract: [{ word: 'Sock!', category: 'Feelings' }] } })).toThrow(/duplicates "sock" \(concrete\[0\]\)/);
  });

  it('the very same word in two entries, across difficulties or within one', () => {
    expect(() => parseWordList({ difficulties: { ...base(), abstract: [{ word: 'sock', category: 'Feelings' }] } })).toThrow(/word "sock" of "sock" \(abstract\[0\]\) duplicates "sock" \(concrete\[0\]\)/);
    expect(() => parseWordList({ difficulties: { ...base(), concrete: [ok, { ...ok }] } })).toThrow(/\(concrete\[1\]\) duplicates "sock" \(concrete\[0\]\)/);
  });

  it('an entry without a category', () => {
    expect(() => parseWordList({ difficulties: { ...base(), medium: [{ word: 'beach' }] } })).toThrow(/"beach" has no category/);
  });

  it('an empty or missing difficulty', () => {
    expect(() => parseWordList({ difficulties: { ...base(), abstract: [] } })).toThrow(/"abstract" is missing or empty/);
    const { medium: _, ...noMedium } = base();
    expect(() => parseWordList({ difficulties: noMedium })).toThrow(/"medium" is missing or empty/);
  });

  it('a word or alt that normalizes to nothing', () => {
    expect(() => parseWordList({ difficulties: { ...base(), concrete: [{ word: '?!', category: 'C' }] } })).toThrow(/word "\?!" of "\?!" normalizes to nothing/);
    expect(() => parseWordList({ difficulties: { ...base(), concrete: [{ ...ok, alt: ['--'] }] } })).toThrow(/alt "--" of "sock" normalizes to nothing/);
  });

  it('an alt equal to another entry\'s word or alt, after normalization', () => {
    expect(() => parseWordList({ difficulties: { ...base(), concrete: [{ ...ok, alt: ['Beach'] }] } })).toThrow(/alt "Beach" of "sock" \(concrete\[0\]\) duplicates "beach" \(medium\[0\]\)/);
    const twoAlts = { ...base(), concrete: [{ ...ok, alt: ['stocking'] }], medium: [{ word: 'beach', category: 'Places', alt: ['Stocking!'] }] };
    expect(() => parseWordList({ difficulties: twoAlts })).toThrow(/alt "Stocking!" of "beach" \(medium\[0\]\) duplicates "sock" \(concrete\[0\]\)/);
    // Repeating its own word as an alt is harmless and allowed.
    expect(() => parseWordList({ difficulties: { ...base(), concrete: [{ ...ok, alt: ['Sock'] }] } })).not.toThrow();
  });

  it('a malformed alt and an unknown difficulty', () => {
    expect(() => parseWordList({ difficulties: { ...base(), concrete: [{ ...ok, alt: [3] }] } })).toThrow(/malformed alt/);
    expect(() => parseWordList({ difficulties: { ...base(), mixed: [ok] } })).toThrow(/unknown difficulties: mixed/);
  });
});

describe('shuffledOrder (5.2)', () => {
  it('is a permutation drawing one randomInt per swap, n, n − 1, …, 2', () => {
    const asked: number[] = [];
    const ord = shuffledOrder(50, (n) => (asked.push(n), n - 1));
    expect([...ord].sort((x, y) => x - y)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(asked).toEqual(Array.from({ length: 49 }, (_, i) => 50 - i));
  });

  it('follows its random source: the same script gives the same order, another a different one', () => {
    expect(shuffledOrder(50, scripted(1234))).toEqual(shuffledOrder(50, scripted(1234)));
    expect(shuffledOrder(50, scripted(1235))).not.toEqual(shuffledOrder(50, scripted(1234)));
  });

  it('refuses a source that answers out of range', () => {
    expect(() => shuffledOrder(5, (n) => n)).toThrow(RangeError);
  });

  it('isOrder accepts only a permutation of the right length', () => {
    expect(isOrder([2, 0, 1], 3)).toBe(true);
    expect(isOrder([2, 0, 0], 3)).toBe(false);
    expect(isOrder([0, 1], 3)).toBe(false);
    expect(isOrder([0, 1, 3], 3)).toBe(false);
    expect(isOrder('[0,1,2]', 3)).toBe(false);
  });
});

describe('randomBelow (the deck\'s CSPRNG source)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stays in range', () => {
    for (const n of [1, 2, 3, 80, 200]) for (let i = 0; i < 200; i++) {
      const v = randomBelow(n);
      expect(Number.isInteger(v) && v >= 0 && v < n).toBe(true);
    }
  });

  it('rejects a draw at or above the largest multiple of n, instead of folding it with modulo', () => {
    const draws = [0xffffffff, 5];
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(a: T): T => {
      (a as unknown as Uint32Array)[0] = draws.shift()!;
      return a;
    });
    // 2^32 − 1 is the one value ≥ floor(2^32 / 3) × 3; 5 mod 3 = 2.
    expect(randomBelow(3)).toBe(2);
    expect(draws).toEqual([]);
  });
});

const WORDS: WordEntry[] = Array.from({ length: 5 }, (_, i) => ({ word: `w${i}`, category: 'C' }));
const ORDER = [3, 1, 4, 0, 2];
const NEXT = [2, 0, 4, 1, 3];
const at = (pos: number, shuffles = 1): DeckPosition => ({ pos, shuffles });
const wordAt = (o: readonly number[], p: number) => WORDS[o[p]!]!.word;

describe('drawNext (5.2, 0028)', () => {
  it('deals the order, every word once, then reshuffles with a fresh order', () => {
    let pos = at(0);
    const got: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = drawNext(WORDS, pos, ORDER, new Set(), () => { throw new Error('no reshuffle expected'); });
      expect(d.reshuffled).toBeNull();
      got.push(WORDS[d.index]!.word);
      pos = d.next;
    }
    expect(got).toEqual(ORDER.map((i) => WORDS[i]!.word));
    expect(pos).toEqual(at(5));
    const d = drawNext(WORDS, pos, ORDER, new Set(), () => NEXT);
    expect(d).toMatchObject({ index: NEXT[0], reshuffled: NEXT, next: at(1, 2) });
  });

  it('shuffles first when there is no order, or one that no longer fits the list', () => {
    expect(drawNext(WORDS, at(0, 0), null, new Set(), () => NEXT)).toMatchObject({ index: NEXT[0], reshuffled: NEXT, next: at(1, 1) });
    expect(drawNext(WORDS, at(1), [1, 0], new Set(), () => NEXT)).toMatchObject({ index: NEXT[0], reshuffled: NEXT, next: at(1, 2) });
  });

  it('skips excluded words, using them up for this shuffle', () => {
    const d = drawNext(WORDS, at(0), ORDER, new Set([wordAt(ORDER, 0)]), () => NEXT);
    expect(d).toMatchObject({ index: ORDER[1], repeat: false, next: at(2), reshuffled: null });
  });

  it('reshuffles past an excluded tail and finds the one word left', () => {
    // Only the word at position 0 is allowed, and the deck stands at position 1.
    const allowed = wordAt(ORDER, 0);
    const exclude = new Set(WORDS.map((w) => w.word).filter((w) => w !== allowed));
    const d = drawNext(WORDS, at(1), ORDER, exclude, () => NEXT);
    expect(WORDS[d.index]!.word).toBe(allowed);
    expect(d).toMatchObject({ repeat: false, next: at(NEXT.indexOf(ORDER[0]!) + 1, 2), reshuffled: NEXT });
  });

  it('with every word excluded deals the next one flagged repeat, never looping (0028)', () => {
    const all = new Set(WORDS.map((w) => w.word));
    const d = drawNext(WORDS, at(2), ORDER, all, () => NEXT);
    expect(d).toMatchObject({ index: ORDER[2], repeat: true, next: at(3) });
    expect(drawNext(WORDS, at(5), ORDER, all, () => NEXT)).toMatchObject({ index: NEXT[0], repeat: true, next: at(1, 2) });
  });
});
