import { readdirSync, readFileSync } from 'node:fs';
import { join as joinPath, resolve } from 'node:path';

/**
 * The DOM word check's allowances, shared by the evidence (phase 9) and
 * results (phase 10) legs: a string that is just the word always leaks;
 * one that merely contains it may be interface text that happens to hold
 * the word, which `isWholeLiteral` recognizes from the client source.
 */

/** Every client source file, concatenated, for the whole-literal allowance below. */
const CLIENT_SOURCE = readdirSync(resolve(import.meta.dirname, '../../src/client'), { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
  .map((e) => readFileSync(joinPath(e.parentPath, e.name), 'utf8'))
  .join('\n');

/** Accepted answers per word (`alt`), from the deck file. */
export const ALTS = new Map<string, string[]>();
{
  const deck = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../data/words.json'), 'utf8')) as { difficulties: Record<string, { word: string; alt?: string[] }[]> };
  for (const list of Object.values(deck.difficulties)) for (const e of list) ALTS.set(e.word, e.alt ?? []);
}

export const bare = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A DOM string that is nothing but the word (any case, punctuation, a plural, or an accepted alt): always a leak. */
export function isBareWord(s: string, word: string): boolean {
  const b = bare(s);
  const w = bare(word);
  return b === w || b === `${w}s` || b === `${w}es` || (ALTS.get(word) ?? []).some((a) => b === bare(a));
}

/**
 * A whole literal in the client source: the trimmed string quoted (`'…'`, `"…"`, a template), or a whole JSX
 * text run (right after a `>` or `}` and ending the line or before `<`/`{`). A word that only coincides with
 * interface text ("change") passes this way; a word interpolated from data never does.
 */
export function isWholeLiteral(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(['"\`])${esc}\\1|[>}]\\s*${esc}\\s*(\\n|<|\\{)`).test(CLIENT_SOURCE);
}

