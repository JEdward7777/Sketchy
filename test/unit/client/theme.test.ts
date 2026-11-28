import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAYER_COLORS, SPY_ICONS } from '../../../src/shared/core/rules';
import { PLAYER_COLOR_LABELS, playerColorVar } from '../../../src/client/theme/player-colors';

const tokens = readFileSync(resolve(import.meta.dirname, '../../../src/client/theme/tokens.css'), 'utf8');
const icons = readFileSync(resolve(import.meta.dirname, '../../../src/client/components/SpyIcon.tsx'), 'utf8');

describe('theme tokens (stage 4.9.1)', () => {
  it('declares exactly one CSS color per PLAYER_COLORS id', () => {
    const declared = [...tokens.matchAll(/--player-([a-z]+):\s*#[0-9a-f]{6};/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...PLAYER_COLORS].sort());
  });

  it('maps every color id to its token and labels it', () => {
    for (const c of PLAYER_COLORS) {
      expect(playerColorVar(c)).toBe(`var(--player-${c})`);
      expect(PLAYER_COLOR_LABELS[c]).toBeTruthy();
    }
    expect(playerColorVar('chartreuse')).toBe('var(--offline)');
  });

  it('draws every spy icon', () => {
    for (const i of SPY_ICONS) expect(icons, i).toMatch(new RegExp(`^  ${i}: \\(`, 'm'));
  });
});

/** Token values per theme: the light `:root` block, then the dark media block over it. */
function themes(): { light: Record<string, string>; dark: Record<string, string> } {
  const darkStart = tokens.indexOf('@media (prefers-color-scheme: dark)');
  const darkEnd = tokens.indexOf('@media (prefers-reduced-motion');
  const read = (css: string) =>
    Object.fromEntries([...css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1]!, m[2]!]));
  const light = read(tokens.slice(0, darkStart));
  return { light, dark: { ...light, ...read(tokens.slice(darkStart, darkEnd)) } };
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** WCAG 2 contrast ratio. */
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Foreground/background token pairs the stylesheet uses for text (styles.css). */
const TEXT_PAIRS: readonly [string, string][] = [
  ['ink', 'paper'], ['ink', 'surface'], ['ink', 'surface-2'],
  ['ink-soft', 'paper'], ['ink-soft', 'surface'], ['ink-soft', 'surface-2'],
  ['accent-ink', 'accent'], ['accent-2-ink', 'accent-2'], ['accent-text', 'paper'],
  ['danger', 'paper'], ['danger', 'surface'], ['danger', 'warn-bg'], ['warn', 'warn-bg'],
  ['offline', 'surface'], ['offline', 'surface-2'],
  // Round screens (game.css): the envelope, its letter and stamp, the countdown, the done tags.
  ['envelope-ink', 'envelope'], ['stamp', 'envelope'], ['letter-ink', 'letter'], ['letter-soft', 'letter'],
  ['paper', 'ink'], ['ok', 'surface-2'], ['ink-soft', 'surface-2'], ['warn', 'warn-bg'],
  ['accent-2-ink', 'accent-2'], ['accent-ink', 'accent'],
  // Evidence screens (evidence.css): card tag, hints, went-dark card, lock stamp, suspects.
  ['ink', 'surface-2'], ['ink-soft', 'surface-2'], ['paper', 'ink'], ['accent-ink', 'accent'], ['danger', 'surface'], ['ink', 'surface'],
  // Round-end screens (results.css): the unmask stamp, word reveal, scoreboard gains, podium blocks.
  ['accent-ink', 'accent'], ['envelope-ink', 'envelope'], ['ok', 'surface-2'], ['ink-soft', 'surface'],
  // Art pass (art.css): the letter's "Eyes only" band, the Declassified stamp, the lobby's big-screen link.
  ['letter', 'stamp'], ['accent-2-ink', 'accent-2'], ['ink', 'paper'],
  // Big-screen display (display.css): kicker stamp, room code label, the "Filed" stamp, the paused card.
  ['accent-text', 'paper'], ['ink-soft', 'surface'], ['ok', 'surface'], ['ink', 'surface'],
];

describe('theme contrast (WCAG AA)', () => {
  it('computes the ratio like the WCAG formula', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBe(1);
  });

  for (const [name, values] of Object.entries(themes())) {
    it(`${name}: every text pair reaches 4.5:1`, () => {
      for (const [fg, bg] of TEXT_PAIRS) {
        expect(values[fg], fg).toBeDefined();
        expect(values[bg], bg).toBeDefined();
        expect(contrast(values[fg]!, values[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${name}: spy icons on every player color and the focus ring reach 3:1 (non-text)`, () => {
      for (const c of PLAYER_COLORS) {
        expect(contrast(values['on-player']!, values[`player-${c}`]!), c).toBeGreaterThanOrEqual(3);
      }
      for (const bg of ['paper', 'surface', 'surface-2']) {
        expect(contrast(values.focus!, values[bg]!), `focus on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
