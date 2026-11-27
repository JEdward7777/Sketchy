import { describe, expect, it } from 'vitest';
import type { PublicRound, PublicRoundResult } from '../../../src/shared/core/views';
import {
  canJudge,
  gainedText,
  guessErrorText,
  judgeCount,
  judgesOf,
  ordinal,
  podium,
  resultsContinueLabel,
  scoreRows,
  verdictOf,
  voteLines,
  votesOnFaker,
  winnerLine,
} from '../../../src/client/game/results-model';
import { fillFraction } from '../../../src/client/game/countdown';
import { HOLD_REARM_MS, RESULTS_BEAT_MS } from '../../../src/shared/core/rules';
import { player } from './fixtures';

function round(over: Partial<PublicRound> = {}): PublicRound {
  return {
    no: 1,
    roster: ['a', 'b', 'c', 'd'],
    category: 'Animals',
    done: ['a', 'b', 'c', 'd'],
    cards: ['a', 'b', 'c', 'd'],
    votes: {},
    locked: [],
    faker: 'c',
    guess: null,
    judged: [],
    result: null,
    ...over,
  };
}

function result(over: Partial<PublicRoundResult> = {}): PublicRoundResult {
  return { word: 'otter', correct: false, verdict: 'judged', accepts: 0, rejects: 0, points: {}, tally: {}, faker: { undetected: 0, guess: 0, framing: 0 }, ...over };
}

describe('unmask: who voted for whom (10.1)', () => {
  it('lists every roster player in roster order, marking votes on the faker and the faker itself', () => {
    const r = round({ votes: { a: 'c', b: 'a', c: 'b' } });
    expect(voteLines(r)).toEqual([
      { voter: 'a', target: 'c', voterIsFaker: false, caught: true },
      { voter: 'b', target: 'a', voterIsFaker: false, caught: false },
      { voter: 'c', target: 'b', voterIsFaker: true, caught: false },
      { voter: 'd', target: null, voterIsFaker: false, caught: false },
    ]);
    expect(votesOnFaker(r)).toBe(1);
  });

  it('a missing faker (before unmask) catches nobody', () => {
    expect(votesOnFaker(round({ faker: null, votes: { a: 'b' } }))).toBe(0);
  });
});

describe('judging (10.3, decision 0013)', () => {
  it('judges are roster non-fakers; each judges once', () => {
    const r = round({ judged: ['a'] });
    expect(judgesOf(r)).toEqual(['a', 'b', 'd']);
    expect(canJudge(r, 'a')).toBe(false);
    expect(canJudge(r, 'b')).toBe(true);
    expect(canJudge(r, 'c')).toBe(false);
    expect(canJudge(r, 'z')).toBe(false);
  });

  it('counts connected judges plus anyone who judged before dropping', () => {
    const r = round({ judged: ['a', 'b'] });
    const online = (id: string) => id !== 'b' && id !== 'd';
    expect(judgeCount(r, online)).toEqual({ judged: 2, of: 2 });
    expect(judgeCount(round(), () => true)).toEqual({ judged: 0, of: 3 });
  });
});

describe('verdict (10.3, 10.4)', () => {
  it('names each outcome; a tie (0–0 included) goes to the faker', () => {
    expect(verdictOf(result({ verdict: 'auto', correct: true })).kind).toBe('auto');
    expect(verdictOf(result({ verdict: 'none' })).kind).toBe('none');
    const tie = verdictOf(result({ correct: true, accepts: 1, rejects: 1 }));
    expect(tie.kind).toBe('accepted');
    expect(tie.detail).toContain('tie goes to the faker');
    expect(verdictOf(result({ correct: true, accepts: 0, rejects: 0 })).detail).toContain('0–0');
    expect(verdictOf(result({ correct: true, accepts: 2, rejects: 1 })).detail).toBe('Accepted 2–1.');
    const no = verdictOf(result({ correct: false, accepts: 1, rejects: 2 }));
    expect(no.kind).toBe('rejected');
    expect(no.detail).toContain('1–2');
  });

  it('never puts the word in the verdict text (0026 item 5: it shows only from result.word)', () => {
    for (const v of ['auto', 'judged', 'none'] as const) {
      const t = verdictOf(result({ verdict: v, word: 'otter' }));
      expect(`${t.title} ${t.detail}`).not.toMatch(/otter/i);
    }
  });
});

describe('scoreboard (10.4, §5, 0007 item 4)', () => {
  it('orders by score with shared places, ties in room order, removed players last and unplaced', () => {
    const players = [
      player('a', { score: 2 }),
      player('b', { score: 5 }),
      player('c', { score: 2 }),
      player('d', { score: 9, removed: true }),
      player('e', { score: 1 }),
    ];
    const rows = scoreRows(players, { a: 1, b: 3, c: 0 });
    expect(rows.map((r) => [r.id, r.place, r.gained])).toEqual([
      ['b', 1, 3],
      ['a', 2, 1],
      ['c', 2, 0],
      ['e', 4, null],
      ['d', 0, null],
    ]);
    expect(rows.at(-1)!.removed).toBe(true);
  });

  it('shows gains as +n and nothing for a player who sat out', () => {
    expect(gainedText(0)).toBe('+0');
    expect(gainedText(3)).toBe('+3');
    expect(gainedText(null)).toBe('');
  });

  it('labels the host continue: the last round goes to the podium', () => {
    expect(resultsContinueLabel({ completed: 3, total: 6 })).toBe('Next round');
    expect(resultsContinueLabel({ completed: 6, total: 6 })).toBe('Final results');
    expect(resultsContinueLabel(null)).toBe('Next round');
  });
});

describe('final podium (10.6, 0007 item 4)', () => {
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
  });

  it('puts shared places on one step and leaves a skipped place empty (1, 1, 3)', () => {
    const p = podium([
      { id: 'a', score: 5, place: 1 },
      { id: 'b', score: 5, place: 1 },
      { id: 'c', score: 3, place: 3 },
      { id: 'd', score: 1, place: 4 },
      { id: 'e', score: 1, place: 4 },
    ]);
    expect(p.steps.map((s) => s.map((e) => e.id))).toEqual([['a', 'b'], [], ['c']]);
    expect(p.steps[0]!.map((e) => e.label)).toEqual(['Tied 1st', 'Tied 1st']);
    expect(p.steps[2]![0]!.label).toBe('3rd');
    expect(p.rest.map((e) => [e.id, e.label])).toEqual([
      ['d', 'Tied 4th'],
      ['e', 'Tied 4th'],
    ]);
  });

  it('a plain 1, 2, 3 with nobody below', () => {
    const p = podium([
      { id: 'a', score: 3, place: 1 },
      { id: 'b', score: 2, place: 2 },
      { id: 'c', score: 1, place: 3 },
    ]);
    expect(p.steps.map((s) => s.map((e) => e.label))).toEqual([['1st'], ['2nd'], ['3rd']]);
    expect(p.rest).toEqual([]);
  });

  it('names the winner, or every agent sharing first', () => {
    const players = [player('a'), player('b'), player('c')];
    expect(winnerLine([{ id: 'a', place: 1 }, { id: 'b', place: 2 }], players)).toBe('Agent A takes the case!');
    expect(winnerLine([{ id: 'a', place: 1 }, { id: 'b', place: 1 }, { id: 'c', place: 1 }], players)).toBe('A dead heat: A, B and C share the top spot');
    expect(winnerLine([], players)).toBe('Mission complete');
  });
});

describe('guess and judging refusals', () => {
  it('explain the round-end codes in the spy voice, and leave the rest to the generic text', () => {
    for (const c of ['not_faker', 'bad_guess', 'not_judge', 'already_judged', 'paused'] as const) expect(guessErrorText(c)).toBeTruthy();
    expect(guessErrorText('room_full')).toBeNull();
  });
});

describe('the results continue fill (10.5.1, decision 0004)', () => {
  it('fills over RESULTS_BEAT_MS from fillFrom, and a hold (fillFrom pushed by HOLD_REARM_MS) empties it until then', () => {
    const start = 100_000;
    const continueAt = start + RESULTS_BEAT_MS;
    expect(fillFraction(start, continueAt, start + RESULTS_BEAT_MS / 2, null)).toBe(0.5);
    // A tap at +2 s: the room moves fillFrom to tap + HOLD_REARM_MS and continueAt by the same beat.
    const held = start + 2_000 + HOLD_REARM_MS;
    expect(fillFraction(held, held + RESULTS_BEAT_MS, start + 3_000, null)).toBe(0);
    expect(fillFraction(held, held + RESULTS_BEAT_MS, held + RESULTS_BEAT_MS / 4, null)).toBe(0.25);
    // Paused results freeze the fill where it stood.
    expect(fillFraction(start, continueAt, start + 99_999, { since: start + RESULTS_BEAT_MS / 4 })).toBe(0.25);
  });
});
