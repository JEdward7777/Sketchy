import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPECTATOR, displayDeadline, displayHeadline, drawStatus, gridColumns, roundLine } from '../../../src/client/game/display-model';
import type { PublicRound, PublicState } from '../../../src/shared/core/views';
import { lobbyState, player } from './fixtures';

const players = [player('p1', { name: 'Ava' }), player('p2', { name: 'Bea' }), player('p3', { name: 'Cy' })];

function round(over: Partial<PublicRound> = {}): PublicRound {
  return { no: 1, roster: ['p1', 'p2', 'p3'], category: 'Food', done: [], cards: null, votes: {}, locked: [], faker: null, guess: null, judged: [], result: null, ...over };
}

function inPhase(phase: PublicState['phase'], r: PublicRound | null = round(), progress = { completed: 0, total: 3 }): PublicState {
  return lobbyState(players, { phase, round: r, progress });
}

const ALL_PHASES: PublicState['phase'][] = [
  { name: 'lobby' },
  { name: 'dealing' },
  { name: 'briefing', continueAt: 9, fillFrom: 1, hostSpeaking: false },
  { name: 'draw', endsAt: 10, closesAt: 11 },
  { name: 'scrubbed', endsAt: 12 },
  { name: 'slideshow', startsAt: 1, perSlideMs: 2, endsAt: 13 },
  { name: 'browse', endsAt: 14 },
  { name: 'unmask', endsAt: 15 },
  { name: 'guess', endsAt: 16 },
  { name: 'judging', endsAt: 17 },
  { name: 'results', continueAt: 18, fillFrom: 1, hostSpeaking: false },
  { name: 'final', standings: [{ id: 'p2', score: 3, place: 1 }] },
];

describe('big-screen display model (stage 12.4)', () => {
  it('the spectator is nobody', () => {
    expect(players.some((p) => p.id === SPECTATOR)).toBe(false);
  });

  it('has a headline for every phase, and names the faker only once public', () => {
    for (const phase of ALL_PHASES) {
      const h = displayHeadline(inPhase(phase));
      expect(h.title, phase.name).toBeTruthy();
      expect(h.kicker, phase.name).toBeTruthy();
    }
    expect(displayHeadline(inPhase({ name: 'guess', endsAt: 1 }, round({ faker: 'p2' }))).title).toBe('Bea is cracking the code');
    expect(displayHeadline(inPhase({ name: 'final', standings: [{ id: 'p2', score: 3, place: 1 }] })).title).toContain('Bea');
  });

  it('never puts the word in a headline, even on the results', () => {
    const result = { word: 'pizza', correct: false, verdict: 'none' as const, accepts: 0, rejects: 0, points: {}, tally: {}, faker: { undetected: 0, guess: 0, framing: 0 } };
    const h = displayHeadline(inPhase({ name: 'results', continueAt: 1, fillFrom: 1, hostSpeaking: false }, round({ faker: 'p1', result })));
    expect(`${h.kicker} ${h.title}`.toLowerCase()).not.toContain('pizza');
  });

  it('counts down the phase deadline, and nothing in the lobby, slideshow or final', () => {
    const at = Object.fromEntries(ALL_PHASES.map((p) => [p.name, displayDeadline(p)?.at ?? null]));
    expect(at).toEqual({ lobby: null, dealing: null, briefing: 9, draw: 10, scrubbed: 12, slideshow: null, browse: 14, unmask: 15, guess: 16, judging: 17, results: 18, final: null });
  });

  it('numbers rounds that count: the next one mid-round, the one just scored on results', () => {
    expect(roundLine(inPhase({ name: 'draw', endsAt: 1, closesAt: 2 }, round(), { completed: 1, total: 3 }))).toBe('Round 2 of 3');
    expect(roundLine(inPhase({ name: 'results', continueAt: 1, fillFrom: 1, hostSpeaking: false }, round(), { completed: 2, total: 3 }))).toBe('Round 2 of 3');
    expect(roundLine(inPhase({ name: 'scrubbed', endsAt: 1 }, round(), { completed: 3, total: 3 }))).toBe('Round 3 of 3');
    expect(roundLine(inPhase({ name: 'lobby' }, null))).toBeNull();
    expect(roundLine(lobbyState(players, { phase: { name: 'draw', endsAt: 1, closesAt: 2 }, progress: null }))).toBeNull();
  });

  it('lists who has filed a drawing, in roster order', () => {
    expect(drawStatus(inPhase({ name: 'draw', endsAt: 1, closesAt: 2 }, round({ roster: ['p3', 'p1'], done: ['p1'] })))).toEqual([
      { id: 'p3', done: false },
      { id: 'p1', done: true },
    ]);
    expect(drawStatus(inPhase({ name: 'lobby' }, null))).toEqual([]);
  });

  it('tiles drawings in the column count that makes each largest', () => {
    expect(gridColumns(1, 1200, 800)).toBe(1);
    expect(gridColumns(0, 1200, 800)).toBe(1);
    // A wide, short box: everything in one row.
    expect(gridColumns(3, 3000, 400)).toBe(3);
    // A tall, narrow box: one column.
    expect(gridColumns(3, 400, 3000)).toBe(1);
    // The 1920×1080 display's browse area with 3 cards: one row of three beats two rows.
    expect(gridColumns(3, 1100, 880, 168, 18)).toBe(3);
    // 10 cards on a 16:9 area: more than 2 columns, fewer than 10.
    const c = gridColumns(10, 1100, 800, 120, 12);
    expect(c).toBeGreaterThan(2);
    expect(c).toBeLessThan(10);
    // Never worse than any other column count.
    const size = (cols: number) => Math.min((1100 - (cols - 1) * 12) / cols, (((800 - (Math.ceil(10 / cols) - 1) * 12) / Math.ceil(10 / cols) - 120) * 4) / 3);
    for (let k = 1; k <= 10; k++) expect(size(c)).toBeGreaterThanOrEqual(size(k) - 1e-9);
  });
});

describe('big-screen display source (stage 12.4)', () => {
  const files = ['screens/display/DisplayScreen.tsx', 'screens/display/DisplayPhases.tsx', 'game/display-model.ts'];
  const src = files.map((f) => readFileSync(resolve(import.meta.dirname, '../../../src/client', f), 'utf8')).join('\n');

  it('never reads a private view or sends an intent', () => {
    expect(src).not.toMatch(/snap\.round|PrivateRound|PrivateView|\.send\(/);
  });

  it('shows a word only from round.result', () => {
    const uses = [...src.matchAll(/[\w.?]*\.word\b/g)].map((m) => m[0]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/result\.word$/);
  });
});
