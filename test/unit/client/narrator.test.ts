import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BANKS } from '../../../src/client/narrator/phrases';
import { DRAW_LAST_MS, baseline, drawLastAt, eventFor, fakerCaught, lineFor, narrate, PhrasePicker, type NarrationEvent } from '../../../src/client/narrator/picker';
import { SCORING_ROWS } from '../../../src/client/game/rules-content';
import { chooseVoice, NARRATOR_KEY, narratorOn, setNarratorOn, type VoiceLike } from '../../../src/client/narrator/settings';
import { SPEECH_MARGIN_MS, SpeakingSignal, speechBudgetMs } from '../../../src/client/narrator/timing';
import { NARRATION_CAP_MS } from '../../../src/shared/core/rules';
import type { PrivateView, PublicPhase, PublicRound, PublicState } from '../../../src/shared/core/views';
import { seededRng } from '../../helpers/seeded-rng';
import { lobbyState, mapStorage, player } from './fixtures';

const WORD = 'umbrella';
const players = [player('p1', { name: 'Maya' }), player('p2', { name: 'Theo' }), player('p3', { name: 'Ana' }), player('p4', { name: 'Kai' })];

function round(over: Partial<PublicRound> = {}): PublicRound {
  return { no: 1, roster: ['p1', 'p2', 'p3', 'p4'], category: 'Weather gear', done: [], cards: null, votes: {}, locked: [], faker: null, guess: null, judged: [], result: null, ...over };
}

function at(phase: PublicPhase, over: Partial<PublicState> = {}): PublicState {
  return lobbyState(players, { phase, round: round(), progress: { completed: 0, total: 4 }, ...over });
}

const result = { word: WORD, correct: false, verdict: 'judged' as const, accepts: 1, rejects: 2, points: {}, tally: {}, faker: { undetected: 0, guess: 0, framing: 0 } };

/** One public state per moment of a round, in order. */
const ROUND: readonly PublicState[] = [
  lobbyState(players),
  at({ name: 'dealing' }, { round: round({ category: null }) }),
  at({ name: 'briefing', continueAt: 9e12, fillFrom: 9e12, hostSpeaking: false }),
  at({ name: 'draw', endsAt: 9e12, closesAt: 9e12 }),
  at({ name: 'slideshow', startsAt: 0, perSlideMs: 3500, endsAt: 9e12 }, { round: round({ cards: ['p1', 'p2', 'p3', 'p4'] }) }),
  at({ name: 'browse', endsAt: 9e12 }, { round: round({ cards: ['p1', 'p2', 'p3', 'p4'], votes: { p1: 'p2' } }) }),
  at({ name: 'unmask', endsAt: 9e12 }, { round: round({ votes: { p1: 'p2', p3: 'p2', p4: 'p1', p2: 'p1' }, faker: 'p2' }) }),
  at({ name: 'guess', endsAt: 9e12 }, { round: round({ faker: 'p2' }) }),
  at({ name: 'judging', endsAt: 9e12 }, { round: round({ faker: 'p2', guess: 'parasol' }) }),
  at({ name: 'results', continueAt: 9e12, fillFrom: 9e12, hostSpeaking: false }, { round: round({ faker: 'p2', guess: 'parasol', result }), players: players.map((p, i) => ({ ...p, score: i })) }),
];

/** Each device's private view of the round: p2 is the faker, the others hold the word. */
function privateFor(id: string): PrivateView {
  return {
    you: { id, token: `t-${id}` },
    round: id === 'p2' ? { no: 1, category: 'Weather gear', role: 'faker' } : { no: 1, category: 'Weather gear', role: 'agent', word: WORD },
  };
}

/** Every line of a whole round, with `extra` merged into each state (to prove extra fields are ignored). */
function playLines(seed: number, extra: object = {}): (string | null)[] {
  const picker = new PhrasePicker(seededRng(seed).next);
  let prev: PublicState | null = null;
  const out: (string | null)[] = [];
  for (const s of ROUND) {
    const next = { ...s, ...extra } as PublicState;
    out.push(narrate(prev, next, picker));
    prev = baseline(prev, next);
  }
  return out;
}

describe('PhrasePicker (12.1.1 no-repeat shuffle)', () => {
  it('plays every line of a bank once before any repeats', () => {
    const p = new PhrasePicker(seededRng(7).next);
    for (let deal = 0; deal < 5; deal++) {
      const seen = Array.from({ length: 6 }, () => p.next('b', 6));
      expect(new Set(seen).size).toBe(6);
    }
  });

  it('never plays the same line twice in a row, across redeals too', () => {
    for (let seed = 1; seed < 200; seed++) {
      const p = new PhrasePicker(seededRng(seed).next);
      let last = -1;
      for (let i = 0; i < 30; i++) {
        const n = p.next('b', 3);
        expect(n).not.toBe(last);
        last = n;
      }
    }
  });

  it('keeps banks apart and copes with a one-line bank', () => {
    const p = new PhrasePicker(seededRng(3).next);
    expect(p.next('one', 1)).toBe(0);
    const a = Array.from({ length: 4 }, () => p.next('a', 4));
    const b = Array.from({ length: 4 }, () => p.next('b', 4));
    expect(new Set(a).size).toBe(4);
    expect(new Set(b).size).toBe(4);
  });

  it('every bank has variety, and every line finishes well inside the server cap', () => {
    const vars = { agent: 'Maximiliana Smith', category: 'Things at the beach', seconds: '120', faker: 'Maximiliana Smith', guess: 'x'.repeat(40), word: 'photosynthesis', leader: 'Ana, Kai and Maya', points: '12 points' };
    for (const [name, lines] of Object.entries(BANKS)) {
      expect(lines.length, name).toBeGreaterThanOrEqual(3);
      for (const line of lines) {
        const text = line(vars);
        expect(speechBudgetMs(text), `${name}: ${text}`).toBeLessThan(NARRATION_CAP_MS * 0.6);
        expect(text).not.toMatch(/undefined|\$\{/);
      }
    }
    // Round results speak a verdict and the standings together: every pair still fits under the cap.
    for (const verdict of [...BANKS.verdictRight, ...BANKS.verdictWrong, ...BANKS.verdictNone]) {
      for (const standing of [...BANKS.standings, ...BANKS.standingsTied]) {
        const text = `${verdict(vars)} ${standing(vars)}`;
        expect(speechBudgetMs(text), text).toBeLessThan(NARRATION_CAP_MS);
      }
    }
  });
});

describe('eventFor (12.1.1 phase transitions)', () => {
  it('names each moment of a round, skipping the dealing beat', () => {
    const events: (NarrationEvent | null)[] = [];
    let prev: PublicState | null = null;
    for (const s of ROUND) {
      events.push(eventFor(prev, s));
      prev = baseline(prev, s);
    }
    expect(events).toEqual([null, null, 'gameStart', 'drawStart', 'slideshow', 'browse', 'unmask', 'guess', 'judging', 'results']);
  });

  it('a later briefing, final results, Play again, scrubbed, pause and resume', () => {
    const results = ROUND.at(-1)!;
    const briefing2 = at({ name: 'briefing', continueAt: 1, fillFrom: 1, hostSpeaking: false }, { round: round({ no: 2 }) });
    expect(eventFor(results, briefing2)).toBe('briefing');
    const fin = at({ name: 'final', standings: [] });
    expect(eventFor(results, fin)).toBe('final');
    expect(eventFor(fin, lobbyState(players))).toBe('lobbyReturn');
    const scrubbed = at({ name: 'scrubbed', endsAt: 1 });
    expect(eventFor(ROUND[3]!, scrubbed)).toBe('scrubbed');
    expect(eventFor(scrubbed, { ...briefing2 })).toBe('briefing');
    const draw = ROUND[3]!;
    const paused = { ...draw, paused: { since: 5 } };
    expect(eventFor(draw, paused)).toBe('paused');
    expect(eventFor(paused, draw)).toBe('resumed');
    // A phase change wins over a lifted pause (host:end from a pause goes straight to final results).
    expect(eventFor(paused, fin)).toBe('final');
  });

  it('says nothing for the first state a device sees, or for a state that changes no phase', () => {
    expect(eventFor(null, ROUND[3]!)).toBeNull();
    expect(eventFor(ROUND[5]!, { ...ROUND[5]!, round: round({ votes: { p1: 'p3' } }) })).toBeNull();
  });
});

describe('lines from public state only (12.1.1)', () => {
  it('the same public state gives the same line whether this device is the faker or an agent', () => {
    for (let seed = 1; seed < 40; seed++) {
      const asFaker = playLines(seed, { private: privateFor('p2'), you: privateFor('p2').you, view: privateFor('p2') });
      const asAgent = playLines(seed, { private: privateFor('p1'), you: privateFor('p1').you, view: privateFor('p1') });
      expect(asFaker).toEqual(asAgent);
      expect(asFaker).toEqual(playLines(seed));
    }
  });

  it('never says the word before round.result, nor names the faker by role before unmask', () => {
    const resultsAt = ROUND.length - 1;
    for (let seed = 1; seed < 60; seed++) {
      const lines = playLines(seed);
      lines.forEach((line, i) => {
        if (i < resultsAt) expect(line ?? '').not.toMatch(new RegExp(WORD, 'i'));
      });
      expect(lines[resultsAt]).toMatch(new RegExp(WORD, 'i'));
      // Unmask names round.faker.
      expect(lines[6]).toContain('Theo');
    }
  });

  it('lines that need the faker or the result say nothing without them', () => {
    const p = new PhrasePicker(seededRng(1).next);
    expect(lineFor('unmask', at({ name: 'unmask', endsAt: 1 }), p)).toBeNull();
    expect(lineFor('guess', at({ name: 'guess', endsAt: 1 }), p)).toBeNull();
    expect(lineFor('judging', at({ name: 'judging', endsAt: 1 }, { round: round({ faker: 'p2' }) }), p)).toBeNull();
    expect(lineFor('results', at({ name: 'results', continueAt: 1, fillFrom: 1, hostSpeaking: false }), p)).toBeNull();
  });

  it('picks caught or escaped from the public votes, and ties in the lead', () => {
    expect(fakerCaught(ROUND[6]!)).toBe(true);
    expect(fakerCaught(at({ name: 'unmask', endsAt: 1 }, { round: round({ faker: 'p2', votes: { p1: 'p3', p3: 'p4', p4: 'p3' } }) }))).toBe(false);
    // Counted votes only (§5 countedVotes): a self-vote or a vote for someone without a card is dropped.
    const counted = round({ faker: 'p2', cards: ['p1', 'p2', 'p3'], votes: { p1: 'p2', p3: 'p3', p4: 'p4', p2: 'p4' } });
    expect(fakerCaught(at({ name: 'unmask', endsAt: 1 }, { round: counted }))).toBe(true);
    const tied = at({ name: 'final', standings: [] }, { players: players.map((p) => ({ ...p, score: p.id === 'p4' ? 1 : 3 })) });
    const line = lineFor('final', tied, new PhrasePicker(seededRng(2).next))!;
    expect(line).toContain('Maya, Theo and Ana');
    expect(line).toContain('3 points');
  });

  it('times the draw’s "ten seconds" from the public deadline, not while paused or on a short draw', () => {
    const draw = at({ name: 'draw', endsAt: 100_000, closesAt: 103_000 });
    expect(drawLastAt(draw)).toBe(100_000 - DRAW_LAST_MS);
    expect(drawLastAt({ ...draw, paused: { since: 1 } })).toBeNull();
    const short = { ...draw, settings: { ...draw.settings, timers: 'custom' as const, custom: { drawMs: 15_000, perSlideMs: 1000, voteMs: 5000, guessMs: 5000 } } };
    expect(drawLastAt(short)).toBeNull();
    expect(drawLastAt(ROUND[2]!)).toBeNull();
  });

  it('the picker modules never touch the private view', () => {
    for (const f of ['picker.ts', 'phrases.ts']) {
      const code = readFileSync(new URL(`../../../src/client/narrator/${f}`, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/Private|RoomSnapshot|\bsnap\b|net\/connection|\.view\b/);
    }
  });
});

describe('speaking signal (12.1.4)', () => {
  afterEach(() => vi.useRealTimers());

  function harness(canSend = true) {
    vi.useFakeTimers();
    const sent: boolean[] = [];
    const allow = { now: canSend };
    const signal = new SpeakingSignal({
      canSend: () => allow.now,
      send: (s) => sent.push(s),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
    return { sent, signal, allow };
  }

  it('sends start, then stop when the line ends', () => {
    const { sent, signal } = harness();
    signal.begin(1, 4000);
    expect(sent).toEqual([true]);
    signal.end(1);
    expect(sent).toEqual([true, false]);
    vi.advanceTimersByTime(10_000);
    expect(sent).toEqual([true, false]);
  });

  it('a stalled line counts as stopped at its budget', () => {
    const { sent, signal } = harness();
    signal.begin(1, 4000);
    vi.advanceTimersByTime(3999);
    expect(sent).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([true, false]);
    expect(signal.speaking).toBe(false);
  });

  it('a line cut off by a newer one closes its own start first, and its late end does not stop the newer one', () => {
    const { sent, signal, allow } = harness();
    signal.begin(1, 4000);
    signal.begin(2, 4000);
    signal.end(1);
    expect(sent).toEqual([true, false, true]);
    vi.advanceTimersByTime(4000);
    expect(sent).toEqual([true, false, true, false]);
    // A stale start is closed even when the newer line may not send (the phase moved on).
    signal.begin(3, 4000);
    allow.now = false;
    signal.begin(4, 4000);
    expect(sent).toEqual([true, false, true, false, true, false]);
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([true, false, true, false, true, false]);
  });

  it('sends nothing where it may not (not the host, or a phase the room ignores), and stops only what it started', () => {
    const { sent, signal, allow } = harness(false);
    signal.begin(1, 4000);
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([]);
    allow.now = true;
    signal.begin(2, 4000);
    allow.now = false;
    signal.stop();
    expect(sent).toEqual([true, false]);
  });

  it('budgets grow with the line and never pass the server cap', () => {
    expect(speechBudgetMs('Go.')).toBeGreaterThanOrEqual(SPEECH_MARGIN_MS);
    expect(speechBudgetMs('Pencils down. Let us review the evidence.')).toBeGreaterThan(speechBudgetMs('Go.'));
    expect(speechBudgetMs('word '.repeat(500))).toBe(NARRATION_CAP_MS);
    expect(speechBudgetMs('one two three four five', 2)).toBeLessThan(speechBudgetMs('one two three four five', 1));
  });
});

describe('narrator settings (12.1.2, 12.1.3)', () => {
  it('on by default for the host only; an explicit choice wins', () => {
    const s = mapStorage();
    expect(narratorOn(s, true)).toBe(true);
    expect(narratorOn(s, false)).toBe(false);
    setNarratorOn(s, false);
    expect(s.map.get(NARRATOR_KEY)).toBe('off');
    expect(narratorOn(s, true)).toBe(false);
    setNarratorOn(s, true);
    expect(narratorOn(s, false)).toBe(true);
  });

  it('storage that is missing or throws means the default, and setting never throws', () => {
    const broken = { ...mapStorage(), getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
    expect(narratorOn(null, true)).toBe(true);
    expect(narratorOn(broken, true)).toBe(true);
    expect(narratorOn(broken, false)).toBe(false);
    expect(() => setNarratorOn(broken, true)).not.toThrow();
    expect(() => setNarratorOn(null, true)).not.toThrow();
  });

  it('chooses a clear English voice', () => {
    const v = (name: string, lang: string, extra: Partial<VoiceLike> = {}): VoiceLike => ({ name, lang, localService: true, default: false, ...extra });
    expect(chooseVoice([v('Thomas', 'fr-FR'), v('Zarvox', 'en-US'), v('Samantha', 'en-US'), v('Alex', 'en-US')])?.name).toBe('Samantha');
    expect(chooseVoice([v('Google Deutsch', 'de-DE'), v('Google US English', 'en-US', { localService: false })])?.name).toBe('Google US English');
    expect(chooseVoice([v('Zarvox', 'en-US'), v('Some voice', 'en-GB', { default: true })])?.name).toBe('Some voice');
    expect(chooseVoice([v('Thomas', 'fr-FR')])).toBeNull();
    expect(chooseVoice([])).toBeNull();
  });
});

describe('rules sheet (12.2)', () => {
  it('the scoring table is SPEC.md §5, row for row', () => {
    const spec = readFileSync(new URL('../../../SPEC.md', import.meta.url), 'utf8');
    const section = spec.slice(spec.indexOf('## 5. Scoring'), spec.indexOf('Not included'));
    const rows = section
      .split('\n')
      .filter((l) => l.startsWith('|') && !l.includes('---') && !l.includes('| Who |'))
      .map((l) => l.split('|').slice(1, -1).map((c) => c.replace(/\*\*/g, '').trim()));
    expect(rows.length).toBe(4);
    expect(SCORING_ROWS.map(([who, earns]) => [who, earns])).toEqual(rows);
  });
});
