/**
 * Stage 2.3 — guess normalization and auto-accept, SPEC §4 "Guess
 * normalization (auto-accept)", with `alt` entries from data/words.json.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { guessMatches, normalizeGuess, pluralEquivalent, type WordEntry } from '../../src/shared/guess';

const words = JSON.parse(readFileSync(new URL('../../data/words.json', import.meta.url), 'utf8')) as {
  difficulties: Record<string, WordEntry[]>;
};
const all = Object.values(words.difficulties).flat();
const entry = (word: string): WordEntry => {
  const e = all.find((w) => w.word === word);
  if (!e) throw new Error(`${word} is not in data/words.json`);
  return e;
};

describe('normalizeGuess (§4: lowercase, trim, collapse whitespace, strip punctuation)', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeGuess('  Ice   CREAM\tcone \n')).toBe('ice cream cone');
  });

  it('strips punctuation: dashes, underscores and slashes separate words, the rest is deleted', () => {
    expect(normalizeGuess('Sock!')).toBe('sock');
    expect(normalizeGuess('"umbrella."')).toBe('umbrella');
    expect(normalizeGuess('yo-yo')).toBe('yo yo');
    expect(normalizeGuess('flip\u2014flop')).toBe('flip flop'); // em dash
    expect(normalizeGuess('hot_dog/bun')).toBe('hot dog bun');
    expect(normalizeGuess("it's a cat?!")).toBe('its a cat');
  });

  it('strips accents', () => {
    expect(normalizeGuess('Café')).toBe('cafe');
  });

  it('lowercases after compatibility decomposition, which can produce capitals', () => {
    expect(normalizeGuess('𝐒ock')).toBe('sock'); // U+1D412 MATHEMATICAL BOLD CAPITAL S
    expect(normalizeGuess('ℂactus')).toBe('cactus'); // U+2102 DOUBLE-STRUCK CAPITAL C
    expect(normalizeGuess('ＳＯＣＫ')).toBe('sock'); // fullwidth
  });

  it('a guess of only punctuation or spaces normalizes to empty', () => {
    expect(normalizeGuess(' ?! ')).toBe('');
  });
});

describe("pluralEquivalent (§4's own examples)", () => {
  it.each([
    ['sock', 'socks'],
    ['box', 'boxes'],
    ['berry', 'berries'],
  ])('%s = %s, both ways', (a, b) => {
    expect(pluralEquivalent(a, b)).toBe(true);
    expect(pluralEquivalent(b, a)).toBe(true);
  });

  it('-es only after s, x, z, ch, sh or o', () => {
    for (const [a, b] of [['glass', 'glasses'], ['bench', 'benches'], ['brush', 'brushes'], ['potato', 'potatoes'], ['quiz', 'quizes']]) {
      expect(pluralEquivalent(a!, b!), `${a}/${b}`).toBe(true);
    }
    for (const [a, b] of [['hat', 'hates'], ['cop', 'copes'], ['car', 'cares'], ['ski', 'skies']]) {
      expect(pluralEquivalent(a!, b!), `${a}/${b}`).toBe(false);
    }
  });

  it('does not stretch to unrelated words', () => {
    expect(pluralEquivalent('sock', 'sox')).toBe(false);
    expect(pluralEquivalent('berry', 'berr')).toBe(false);
    expect(pluralEquivalent('cat', 'cart')).toBe(false);
    expect(pluralEquivalent('', 's')).toBe(false);
  });
});

describe('guessMatches against data/words.json', () => {
  it('accepts the word under normalization and plural tolerance', () => {
    expect(guessMatches(' SOCKS. ', entry('sock'))).toBe(true);
    expect(guessMatches('Ice cream cones', entry('ice cream cone'))).toBe(true);
    expect(guessMatches('easter-egg hunt', entry('Easter egg hunt'))).toBe(true);
    expect(guessMatches('Easter Egg Hunts!', entry('Easter egg hunt'))).toBe(true);
    expect(guessMatches('halloween', entry('Halloween'))).toBe(true);
  });

  it.each([
    ['sneaker', 'tennis shoes'],
    ['flip-flop', 'flip flop'],
    ['flip-flop', 'Sandals'],
    ['hot dog', 'hotdog'],
    ['yo-yo', 'yoyo'],
    ['donut', 'doughnuts'],
    ['police officer', 'cop'],
    ['autumn', 'Fall'],
    ['veterinarian', 'vet'],
    ['surprised', 'surprise'],
  ])('%s accepts its alt %s', (word, guess) => {
    expect(entry(word).alt?.length).toBeGreaterThan(0);
    expect(guessMatches(guess, entry(word))).toBe(true);
  });

  it('the word itself and every alt in the file are accepted for their entry', () => {
    for (const e of all) {
      expect(guessMatches(e.word, e), e.word).toBe(true);
      for (const a of e.alt ?? []) expect(guessMatches(a, e), `${e.word} / ${a}`).toBe(true);
    }
  });

  it('rejects -es forms that are other words (hat/hates, cop/copes, race car/race cares, ski/skies)', () => {
    expect(guessMatches('hates', entry('hat'))).toBe(false);
    expect(guessMatches('copes', entry('police officer'))).toBe(false);
    expect(guessMatches('race cares', entry('race car'))).toBe(false);
    expect(guessMatches('skies', { word: 'ski' })).toBe(false); // the file has "skis"; "ski" is synthetic
    expect(guessMatches('skies', entry('skis'))).toBe(false);
    expect(guessMatches('ski', entry('skis'))).toBe(true);
    expect(guessMatches('race cars', entry('race car'))).toBe(true);
  });

  it('rejects wrong and empty guesses', () => {
    expect(guessMatches('shoe horn', entry('sneaker'))).toBe(false);
    expect(guessMatches('', entry('sock'))).toBe(false);
    expect(guessMatches('...', entry('sock'))).toBe(false);
    expect(guessMatches('hot', entry('hot dog'))).toBe(false);
  });
});
