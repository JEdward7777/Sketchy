import { describe, expect, it } from 'vitest';
import { fillFraction, formatSeconds, secondsShown, serverClock, timeLeft } from '../../../src/client/game/countdown';
import { DRAW_RESEND_MAX_MS, DRAW_RESEND_MS, UNSYNCED_SUBMIT_DELAY_MS, autoSubmitDue, draftKey, dropDraft, loadDraft, resendDelay, resendDue, saveDraft, sentAgain } from '../../../src/client/game/draw-model';
import { CLOSED, FAKER_LINE, envelopeLetter, envelopeReducer, isOpen, type EnvelopeEvent } from '../../../src/client/game/envelope-model';
import { HOLD_THROTTLE_MS, HoldThrottle } from '../../../src/client/game/hold-throttle';
import { bufferDrawing } from '../../../src/client/net/drawing-buffer';
import { DRAW_SUBMIT_GRACE_MS } from '../../../src/shared/core/rules';
import { mapStorage } from './fixtures';

describe('countdowns from absolute deadlines (8.1)', () => {
  it('converts the device clock to server time with the measured offset', () => {
    expect(serverClock(1_000, { offset: 250, rtt: 40 })).toBe(1_250);
    expect(serverClock(1_000, { offset: -900, rtt: 40 })).toBe(100);
    expect(serverClock(1_000, null)).toBe(1_000);
  });

  it('counts down to the deadline and never below zero', () => {
    expect(timeLeft(10_000, 4_000, null)).toBe(6_000);
    expect(timeLeft(10_000, 12_000, null)).toBe(0);
  });

  it('freezes at deadline − since while paused (0011)', () => {
    expect(timeLeft(10_000, 99_999, { since: 7_500 })).toBe(2_500);
    expect(fillFraction(0, 8_000, 99_999, { since: 2_000 })).toBe(0.25);
  });

  it('shows whole seconds rounded up, and minutes from 60 s', () => {
    expect(secondsShown(0)).toBe(0);
    expect(secondsShown(1)).toBe(1);
    expect(secondsShown(1_000)).toBe(1);
    expect(secondsShown(1_001)).toBe(2);
    expect(secondsShown(-5)).toBe(0);
    expect(formatSeconds(59_000)).toBe('59');
    expect(formatSeconds(60_000)).toBe('1:00');
    expect(formatSeconds(125_000)).toBe('2:05');
  });

  it('fills the host continue from fillFrom to continueAt (0004 rule 1)', () => {
    expect(fillFraction(1_000, 9_000, 0, null)).toBe(0);
    expect(fillFraction(1_000, 9_000, 1_000, null)).toBe(0);
    expect(fillFraction(1_000, 9_000, 5_000, null)).toBe(0.5);
    expect(fillFraction(1_000, 9_000, 20_000, null)).toBe(1);
    expect(fillFraction(5_000, 5_000, 4_999, null)).toBe(0);
    expect(fillFraction(5_000, 5_000, 5_000, null)).toBe(1);
  });
});

describe('auto-submit at the deadline and resending (8.6)', () => {
  it('is due from endsAt on, with no upper bound (the room refuses late ones), never while paused', () => {
    expect(autoSubmitDue(9_999, 10_000, null, true)).toBe(false);
    expect(autoSubmitDue(10_000, 10_000, null, true)).toBe(true);
    expect(autoSubmitDue(10_000 + 60_000, 10_000, null, true)).toBe(true);
    expect(autoSubmitDue(10_500, 10_000, { since: 9_000 }, true)).toBe(false);
  });

  it('without a measured clock waits UNSYNCED_SUBMIT_DELAY_MS more, still inside the submit grace', () => {
    expect(UNSYNCED_SUBMIT_DELAY_MS).toBeLessThan(DRAW_SUBMIT_GRACE_MS);
    expect(autoSubmitDue(10_000 + UNSYNCED_SUBMIT_DELAY_MS - 1, 10_000, null, false)).toBe(false);
    expect(autoSubmitDue(10_000 + UNSYNCED_SUBMIT_DELAY_MS, 10_000, null, false)).toBe(true);
  });

  it('an unconfirmed drawing is resent at once on a new socket, or after a backoff on the same one', () => {
    const pending = { at: 1_000, socket: 2, tries: 0 };
    expect(resendDue(pending, 1_001, 2, 0)).toBe(false);
    expect(resendDue(pending, 1_000 + DRAW_RESEND_MS - 1, 2, 0)).toBe(false);
    expect(resendDue(pending, 1_000 + DRAW_RESEND_MS, 2, 0)).toBe(true);
    expect(resendDue(pending, 1_001, 3, 0)).toBe(true);
    // A new socket goes at once even with bytes buffered (they are the new socket's own).
    expect(resendDue(pending, 1_001, 3, 500)).toBe(true);
    // Never sent at all (socket was down): the first open socket sends it.
    expect(resendDue({ at: 1_000, socket: -1, tries: 0 }, 1_001, 1, 0)).toBe(true);
  });

  it('never resends on the same socket while it still holds unsent bytes (slow, not lost)', () => {
    expect(resendDue({ at: 0, socket: 1, tries: 0 }, 60_000, 1, 1)).toBe(false);
    expect(resendDue({ at: 0, socket: 1, tries: 0 }, 60_000, 1, 0)).toBe(true);
  });

  it('backs off 4 → 8 → 16 s on the same socket, and starts over on a new one', () => {
    expect([0, 1, 2, 3, 9].map(resendDelay)).toEqual([4_000, 8_000, 16_000, 16_000, 16_000]);
    expect(DRAW_RESEND_MAX_MS).toBe(4 * DRAW_RESEND_MS);
    let p = { at: 0, socket: 1, tries: 0 };
    p = sentAgain(p, 4_000, 1);
    expect(p).toEqual({ at: 4_000, socket: 1, tries: 1 });
    expect(resendDue(p, 4_000 + 7_999, 1, 0)).toBe(false);
    expect(resendDue(p, 4_000 + 8_000, 1, 0)).toBe(true);
    p = sentAgain(p, 12_000, 1);
    expect(resendDue(p, 12_000 + 15_999, 1, 0)).toBe(false);
    expect(sentAgain(p, 13_000, 2)).toEqual({ at: 13_000, socket: 2, tries: 0 });
  });
});

describe('drafts in session storage (8.6)', () => {
  const strokes = [{ color: 2, size: 1, points: [[1, 2], [3, 4]] as [number, number][] }];
  it('round-trips the drawing for its round and drops other rounds', () => {
    const s = mapStorage();
    saveDraft(s, 'abcd', 3, [{ color: 1, size: 0, points: [[0, 0]] }]);
    saveDraft(s, 'ABCD', 4, strokes);
    s.setItem('sketchy:token:ABCD', 'keep');
    expect(loadDraft(s, 'ABCD', 4)).toEqual(strokes);
    expect(s.map.has(draftKey('ABCD', 3))).toBe(false);
    expect(s.map.get('sketchy:token:ABCD')).toBe('keep');
    dropDraft(s, 'ABCD', 4);
    expect(loadDraft(s, 'ABCD', 4)).toEqual([]);
  });

  it('ignores a corrupt draft and storage that throws', () => {
    const s = mapStorage();
    s.setItem(draftKey('ABCD', 1), '{not json');
    expect(loadDraft(s, 'ABCD', 1)).toEqual([]);
    s.setItem(draftKey('ABCD', 1), JSON.stringify([{ c: 99, s: 0, p: [0, 0] }]));
    expect(loadDraft(s, 'ABCD', 1)).toEqual([]);
    const broken = { ...mapStorage(), setItem: () => { throw new Error('full'); } };
    expect(() => saveDraft(broken, 'ABCD', 1, strokes)).not.toThrow();
    expect(loadDraft(null, 'ABCD', 1)).toEqual([]);
  });
});

describe('the envelope (8.3, 8.3.1)', () => {
  const run = (events: EnvelopeEvent[]) => events.reduce(envelopeReducer, CLOSED);

  it('is closed until pressed, open while held, closed on release', () => {
    expect(isOpen(CLOSED)).toBe(false);
    expect(isOpen(run([{ type: 'press', pointerId: 1 }]))).toBe(true);
    expect(isOpen(run([{ type: 'press', pointerId: 1 }, { type: 'release', pointerId: 1 }]))).toBe(false);
  });

  it('only the holding pointer opens or closes it; a second finger changes nothing', () => {
    const s = run([{ type: 'press', pointerId: 1 }, { type: 'press', pointerId: 2 }, { type: 'release', pointerId: 2 }]);
    expect(isOpen(s)).toBe(true);
    expect(isOpen(envelopeReducer(s, { type: 'release', pointerId: 1 }))).toBe(false);
    expect(isOpen(run([{ type: 'release', pointerId: 7 }]))).toBe(false);
  });

  it('a cancel (pointer cancel, blur, page hidden) closes it whatever holds it', () => {
    expect(isOpen(run([{ type: 'press', pointerId: 1 }, { type: 'cancel' }]))).toBe(false);
    expect(isOpen(run([{ type: 'keyDown' }, { type: 'cancel' }]))).toBe(false);
    expect(isOpen(run([{ type: 'press', pointerId: 1 }, { type: 'keyDown' }, { type: 'cancel' }]))).toBe(false);
  });

  it('the keyboard can hold it', () => {
    expect(isOpen(run([{ type: 'keyDown' }]))).toBe(true);
    expect(isOpen(run([{ type: 'keyDown' }, { type: 'keyUp' }]))).toBe(false);
  });

  it('the letter: category + word, or category + "You are the faker!" (§4)', () => {
    const agent = envelopeLetter({ no: 1, category: 'Food', role: 'agent', word: 'taco' });
    expect(agent).toMatchObject({ category: 'Food', line: 'taco' });
    const faker = envelopeLetter({ no: 1, category: 'Food', role: 'faker' });
    expect(faker).toMatchObject({ category: 'Food', line: FAKER_LINE });
    expect(FAKER_LINE).toBe('You are the faker!');
    expect(JSON.stringify(faker)).not.toContain('taco');
  });
});

describe('host hold throttle (0004 rule 3, "Revisit if")', () => {
  function harness() {
    let clock = 0;
    const sent: number[] = [];
    let timers: { fn: () => void; at: number; id: number }[] = [];
    let id = 0;
    const t = new HoldThrottle({
      send: () => sent.push(clock),
      now: () => clock,
      setTimer: (fn, ms) => {
        timers.push({ fn, at: clock + ms, id: ++id });
        return id;
      },
      clearTimer: (h) => {
        timers = timers.filter((x) => x.id !== h);
      },
    });
    const advance = (ms: number) => {
      const end = clock + ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((x) => x !== due);
        clock = due.at;
        due.fn();
      }
      clock = end;
    };
    return { t, sent, advance, pending: () => timers.length };
  }

  it('sends the first tap at once', () => {
    const h = harness();
    h.t.tap();
    expect(h.sent).toEqual([0]);
  });

  it('folds taps inside the window into one trailing hold at its end', () => {
    const h = harness();
    h.t.tap();
    h.advance(500);
    h.t.tap();
    h.advance(500);
    h.t.tap();
    expect(h.sent).toEqual([0]);
    h.advance(HOLD_THROTTLE_MS);
    expect(h.sent).toEqual([0, HOLD_THROTTLE_MS]);
  });

  it('a tap after the window goes at once', () => {
    const h = harness();
    h.t.tap();
    h.advance(HOLD_THROTTLE_MS);
    h.t.tap();
    expect(h.sent).toEqual([0, HOLD_THROTTLE_MS]);
  });

  it('dispose drops a pending trailing hold', () => {
    const h = harness();
    h.t.tap();
    h.t.tap();
    expect(h.pending()).toBe(1);
    h.t.dispose();
    h.advance(10 * HOLD_THROTTLE_MS);
    expect(h.sent).toEqual([0]);
  });
});

describe('drawing buffer (protocol.md "Drawings")', () => {
  const frame = (roundNo: number, playerId: string, p: number[]) => ({ type: 'drawing', roundNo, playerId, strokes: [{ c: 1, s: 0, p }] });

  it('keys by (roundNo, playerId) and decodes the strokes', () => {
    let b = bufferDrawing(null, frame(2, 'p1', [1, 2]));
    b = bufferDrawing(b, frame(2, 'p2', [3, 4]));
    expect(b?.roundNo).toBe(2);
    expect(b?.byPlayer).toEqual({
      p1: [{ color: 1, size: 0, points: [[1, 2]] }],
      p2: [{ color: 1, size: 0, points: [[3, 4]] }],
    });
  });

  it('a repeat replaces, never adds', () => {
    let b = bufferDrawing(null, frame(2, 'p1', [1, 2]));
    b = bufferDrawing(b, frame(2, 'p1', [5, 6]));
    expect(Object.keys(b!.byPlayer)).toEqual(['p1']);
    expect(b!.byPlayer.p1![0]!.points).toEqual([[5, 6]]);
  });

  it('a later round starts over; an earlier round is ignored', () => {
    const b2 = bufferDrawing(null, frame(2, 'p1', [1, 2]));
    const b3 = bufferDrawing(b2, frame(3, 'p2', [1, 2]));
    expect(b3).toEqual({ roundNo: 3, byPlayer: { p2: [{ color: 1, size: 0, points: [[1, 2]] }] } });
    expect(bufferDrawing(b3, frame(2, 'p9', [1, 2]))).toBe(b3);
  });

  it('ignores a malformed frame', () => {
    const b = bufferDrawing(null, frame(1, 'p1', [1, 2]));
    expect(bufferDrawing(b, { roundNo: 1, playerId: 'p2', strokes: [{ c: 99, s: 0, p: [0, 0] }] })).toBe(b);
    expect(bufferDrawing(b, { roundNo: '1', playerId: 'p2', strokes: [] })).toBe(b);
    expect(bufferDrawing(b, { roundNo: 1, playerId: 7, strokes: [] })).toBe(b);
  });
});
