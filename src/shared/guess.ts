/**
 * The faker's guess: normalization and auto-accept matching (stage 2.3,
 * `SPEC.md` §4 "Guess normalization").
 *
 * §4: "Lowercase, trim, collapse whitespace, strip punctuation, and compare
 * with plural tolerance (`sock` = `socks`, `box` = `boxes`, `berry` =
 * `berries`). Each word entry may also list `alt` accepted spellings."
 *
 * A guess that does not match goes to the accept/reject vote (§4, decision
 * 0013); this module only decides the automatic accept.
 */

/** A word as `data/words.json` stores it. */
export interface WordEntry {
  readonly word: string;
  readonly category: string;
  readonly alt?: readonly string[];
}

/**
 * Normalize a guess or a word for comparison:
 * 1. decompose (NFKD) and drop combining marks, so `café` = `cafe` and
 *    compatibility letters fold to plain ones (`𝐒ock` → `Sock`);
 * 2. lowercase — after step 1, because NFKD can produce upper-case letters
 *    (`ℂ` → `C`);
 * 3. strip punctuation — dashes, underscores and slashes become spaces
 *    (they separate words: `flip-flop` → `flip flop`, `easter-egg hunt` →
 *    `easter egg hunt`); every other character that is not a letter, digit
 *    or whitespace is deleted (`it's` → `its`, `sock!` → `sock`);
 * 4. collapse whitespace runs to one space and trim.
 *
 * Spaces stay significant: `hot dog` and `hotdog` differ, which is why
 * `data/words.json` lists such variants as `alt` entries.
 */
export function normalizeGuess(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\p{Pd}_/\\]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * One normalized word equals another up to a regular English plural: equal,
 * or one is the other plus `s` (`sock`/`socks`), plus `es` after a sibilant
 * or `o` ending — `s`, `x`, `z`, `ch`, `sh`, `o` (`box`/`boxes`,
 * `glass`/`glasses`) — or a final `y` replaced by `ies` (`berry`/`berries`).
 * Limiting `es` to those endings keeps `hat` from accepting `hates`. Irregular plurals
 * (`mouse`/`mice`) are not covered; the judging vote (§4) handles those.
 */
const ES_PLURAL_ENDING = /(s|x|z|ch|sh|o)$/;

export function pluralEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length === 0) return false;
  if (long === `${short}s`) return true;
  if (long === `${short}es` && ES_PLURAL_ENDING.test(short)) return true;
  return short.endsWith('y') && long === `${short.slice(0, -1)}ies`;
}

/**
 * Two normalized phrases match when they have the same number of words and
 * each pair of words is plural-equivalent, so `hot dogs` = `hot dog` and
 * `easter egg hunts` = `easter egg hunt`.
 */
function phrasesMatch(a: string, b: string): boolean {
  const wa = a.split(' ');
  const wb = b.split(' ');
  if (wa.length !== wb.length) return false;
  return wa.every((w, i) => pluralEquivalent(w, wb[i]!));
}

/**
 * True when the guess is auto-accepted for `entry`: after normalization it
 * matches the word or any `alt`, with plural tolerance. An empty guess
 * (after normalization) never matches.
 */
export function guessMatches(guess: string, entry: Pick<WordEntry, 'word' | 'alt'>): boolean {
  const g = normalizeGuess(guess);
  if (g === '') return false;
  return [entry.word, ...(entry.alt ?? [])].some((answer) => {
    const n = normalizeGuess(answer);
    return n !== '' && phrasesMatch(g, n);
  });
}
