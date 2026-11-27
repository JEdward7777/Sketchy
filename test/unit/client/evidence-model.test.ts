import { describe, expect, it } from 'vitest';
import {
  MAX_DPR,
  SWIPE_MIN_PX,
  backingSize,
  canVoteFor,
  cardContent,
  lockCount,
  lockPending,
  showVoteError,
  myVote,
  slideView,
  stepCard,
  swipeStep,
  voteErrorText,
  voteTargets,
  votesFor,
  type VoteRound,
} from '../../../src/client/game/evidence-model';
import { serverClock } from '../../../src/client/game/countdown';
import { slideIndex } from '../../../src/shared/slideshow';
import type { Stroke } from '../../../src/shared/stroke-codec';

const T = { startsAt: 10_000, perSlideMs: 2_000 };

describe('slide model (9.2)', () => {
  it('follows slideIndex over two passes, with progress within the slide', () => {
    // 3 cards: slides 0..5, slide i from 10 000 + i × 2 000.
    expect(slideView(T, 3, 10_000, null)).toMatchObject({ status: 'showing', card: 0, pass: 0, slide: 0, total: 6, within: 0, untilNext: 2_000 });
    expect(slideView(T, 3, 13_500, null)).toMatchObject({ card: 1, pass: 0, slide: 1, within: 0.75, untilNext: 500 });
    expect(slideView(T, 3, 16_000, null)).toMatchObject({ card: 0, pass: 1, slide: 3 });
    expect(slideView(T, 3, 21_999, null)).toMatchObject({ card: 2, pass: 1, slide: 5 });
  });

  it('agrees with the shared slideIndex at every sampled instant', () => {
    for (let now = 9_000; now < 23_500; now += 137) {
      const pos = slideIndex(now, T.startsAt, T.perSlideMs, 4);
      const v = slideView(T, 4, now, null);
      if (pos.status === 'showing') expect([v.card, v.pass], String(now)).toEqual([pos.card, pos.pass]);
      else expect(v.status).toBe(pos.status);
    }
  });

  it('holds the first slide before the start and the last after the end', () => {
    expect(slideView(T, 3, 9_400, null)).toMatchObject({ status: 'before', slide: 0, card: 0, within: 0, untilNext: 600 });
    expect(slideView(T, 3, 22_000, null)).toMatchObject({ status: 'ended', slide: 5, card: 2, pass: 1, within: 1, untilNext: Infinity });
  });

  it('freezes at paused.since (0011) and asks for no re-render', () => {
    const v = slideView(T, 3, 99_999, { since: 13_000 });
    expect(v).toMatchObject({ slide: 1, card: 1, within: 0.5, untilNext: Infinity });
  });

  it('two devices with different clocks but measured offsets show the same slide', () => {
    const server = 15_100;
    const fast = { offset: -4_000, rtt: 30 }; // device clock 4 s ahead
    const slow = { offset: 2_500, rtt: 30 };
    const a = slideView(T, 3, serverClock(server + 4_000, fast), null);
    const b = slideView(T, 3, serverClock(server - 2_500, slow), null);
    expect(a.slide).toBe(b.slide);
    expect(a.slide).toBe(2);
  });

  it('copes with no cards', () => {
    expect(slideView(T, 0, 12_000, null)).toMatchObject({ total: 0, status: 'ended' });
  });
});

describe('card content (9.1, 9.3)', () => {
  const strokes: Stroke[] = [{ color: 1, size: 0, points: [[1, 2]] }];
  const buf = { roundNo: 4, byPlayer: { p1: strokes } };
  it('shows the buffered strokes, a placeholder until they arrive, and went dark for no drawing', () => {
    const round = { no: 4, done: ['p1', 'p2'] };
    expect(cardContent(round, 'p1', buf)).toEqual({ kind: 'drawing', strokes });
    expect(cardContent(round, 'p2', buf)).toEqual({ kind: 'loading' });
    expect(cardContent(round, 'p3', buf)).toEqual({ kind: 'dark' });
    expect(cardContent(round, 'p1', null)).toEqual({ kind: 'loading' });
  });
  it('never shows another round’s drawing', () => {
    expect(cardContent({ no: 5, done: ['p1'] }, 'p1', buf)).toEqual({ kind: 'loading' });
  });
});

describe('vote logic (9.4, 9.5)', () => {
  const round: VoteRound = {
    roster: ['p1', 'p2', 'p3', 'p4'],
    cards: ['p3', 'p1', 'p4', 'p2'],
    votes: { p1: 'p3', p2: 'p3', p4: 'p1' },
    locked: ['p2'],
  };

  it('offers every card holder but yourself, in card order (0015)', () => {
    expect(voteTargets(round, 'p1')).toEqual(['p3', 'p4', 'p2']);
    expect(canVoteFor(round, 'p1', 'p1')).toBe(false);
    expect(canVoteFor(round, 'p1', 'p4')).toBe(true);
    expect(canVoteFor(round, 'p1', 'p9')).toBe(false);
  });

  it('a locked vote is final; a player off the roster cannot vote', () => {
    expect(myVote(round, 'p2')).toEqual({ canVote: true, target: 'p3', locked: true });
    expect(canVoteFor(round, 'p2', 'p4')).toBe(false);
    expect(myVote(round, 'p3')).toEqual({ canVote: true, target: null, locked: false });
    expect(myVote(round, 'p7').canVote).toBe(false);
    expect(canVoteFor(round, 'p7', 'p1')).toBe(false);
  });

  it('lists the live chips on each drawing in roster order, marking locks', () => {
    expect(votesFor(round, 'p3')).toEqual([{ voter: 'p1', locked: false }, { voter: 'p2', locked: true }]);
    expect(votesFor(round, 'p1')).toEqual([{ voter: 'p4', locked: false }]);
    expect(votesFor(round, 'p2')).toEqual([]);
    expect(lockCount(round, () => true)).toEqual({ locked: 1, of: 4 });
    // p3 and p4 dropped; p2 locked before dropping still counts.
    expect(lockCount(round, (id) => id === 'p1')).toEqual({ locked: 1, of: 2 });
  });

  it('keeps a sent lock pending until the state or an error answers it, and hides a double-tap vote_locked', () => {
    expect(lockPending(null, false, 0)).toBe(false);
    expect(lockPending({ errorN: 3 }, false, 3)).toBe(true);
    expect(lockPending({ errorN: 3 }, true, 3)).toBe(false);
    expect(lockPending({ errorN: 3 }, false, 4)).toBe(false);
    expect(showVoteError('vote_locked', true)).toBe(false);
    expect(showVoteError('vote_locked', false)).toBe(true);
    expect(showVoteError('no_vote', true)).toBe(true);
  });

  it('explains every voting refusal and leaves others to the generic text', () => {
    for (const c of ['bad_target', 'vote_locked', 'no_vote', 'paused', 'wrong_phase', 'not_in_round'] as const) expect(voteErrorText(c)).toBeTruthy();
    expect(voteErrorText('room_full')).toBeNull();
  });
});

describe('browse navigation (9.6)', () => {
  it('wraps both ways', () => {
    expect(stepCard(0, 1, 3)).toBe(1);
    expect(stepCard(2, 1, 3)).toBe(0);
    expect(stepCard(0, -1, 3)).toBe(2);
    expect(stepCard(1, -4, 3)).toBe(0);
    expect(stepCard(0, 1, 0)).toBe(0);
  });

  it('reads a sideways swipe as a step, and ignores short or vertical drags', () => {
    expect(swipeStep(-SWIPE_MIN_PX, 0)).toBe(1);
    expect(swipeStep(SWIPE_MIN_PX + 10, 5)).toBe(-1);
    expect(swipeStep(SWIPE_MIN_PX - 1, 0)).toBe(0);
    expect(swipeStep(60, 80)).toBe(0);
  });
});

describe('canvas backing store (9.1)', () => {
  it('is the layout size in device pixels, DPR capped, never zero', () => {
    expect(backingSize(300, 225, 2)).toEqual({ w: 600, h: 450 });
    expect(backingSize(300.4, 225.2, 1.5)).toEqual({ w: 451, h: 338 });
    expect(backingSize(100, 75, 5)).toEqual({ w: 100 * MAX_DPR, h: 75 * MAX_DPR });
    expect(backingSize(0, 0, 0)).toEqual({ w: 1, h: 1 });
  });
});
