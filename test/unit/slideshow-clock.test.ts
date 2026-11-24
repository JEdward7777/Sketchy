/**
 * Stage 2.4 — `slideIndex` and the slideshow end (SPEC §8: length
 * `players × 2 × perSlide`; §14: index derived from start + n × perSlide;
 * decision 0007 item 7: `n` counts every card).
 * Stage 2.5 — clock offset from ping/pong, lowest round trip preferred (§14).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateClockOffset, serverNow, type ClockSample } from '../../src/shared/clock-offset';
import { slideIndex, slideshowEnd } from '../../src/shared/slideshow';
import { seededRng } from '../helpers/seeded-rng';

const START = 1_800_000_000_000;
const NORMAL_PER_SLIDE = 3_500; // §8 Normal: 3.5 s

describe('slideshowEnd (§8)', () => {
  it("is start + n × 2 × perSlide: §8's own example, 10 players on Normal = 70 s", () => {
    expect(slideshowEnd(START, NORMAL_PER_SLIDE, 10) - START).toBe(70_000);
  });

  it('counts went-dark cards: n is the whole card set (0007 item 7)', () => {
    const cards = ['drawn', 'dark', 'drawn', 'dark'];
    expect(slideshowEnd(START, 2_500, cards.length)).toBe(START + cards.length * 2 * 2_500);
  });

  it('rejects a non-positive perSlide or a bad n', () => {
    expect(() => slideshowEnd(START, 0, 3)).toThrow(RangeError);
    expect(() => slideshowEnd(START, 1000, -1)).toThrow(RangeError);
    expect(() => slideshowEnd(START, 1000, 2.5)).toThrow(RangeError);
  });
});

describe('slideIndex', () => {
  const n = 4;
  const at = (ms: number) => slideIndex(START + ms, START, NORMAL_PER_SLIDE, n);

  it('walks every card twice, in order, then ends', () => {
    const seen: string[] = [];
    for (let i = 0; i < 2 * n; i++) {
      const p = at(i * NORMAL_PER_SLIDE + NORMAL_PER_SLIDE / 2);
      if (p.status !== 'showing') throw new Error(`slide ${i}: ${p.status}`);
      seen.push(`${p.pass}:${p.card}`);
    }
    expect(seen).toEqual(['0:0', '0:1', '0:2', '0:3', '1:0', '1:1', '1:2', '1:3']);
  });

  it('boundaries: a slide owns its start instant, and the end instant is ended', () => {
    expect(at(0)).toEqual({ status: 'showing', card: 0, pass: 0 });
    expect(at(NORMAL_PER_SLIDE - 1)).toEqual({ status: 'showing', card: 0, pass: 0 });
    expect(at(NORMAL_PER_SLIDE)).toEqual({ status: 'showing', card: 1, pass: 0 });
    expect(at(n * NORMAL_PER_SLIDE)).toEqual({ status: 'showing', card: 0, pass: 1 });
    expect(at(2 * n * NORMAL_PER_SLIDE - 1)).toEqual({ status: 'showing', card: n - 1, pass: 1 });
    expect(at(2 * n * NORMAL_PER_SLIDE)).toEqual({ status: 'ended' });
    expect(at(-1)).toEqual({ status: 'before' });
  });

  it('no cards: the slideshow has already ended at its start', () => {
    expect(slideIndex(START, START, NORMAL_PER_SLIDE, 0)).toEqual({ status: 'ended' });
  });

  describe('driven by a fake clock', () => {
    afterEach(() => vi.useRealTimers());

    it('Date.now under fake time maps to the expected card', () => {
      vi.useFakeTimers();
      vi.setSystemTime(START);
      vi.advanceTimersByTime(5 * NORMAL_PER_SLIDE + 10);
      expect(slideIndex(Date.now(), START, NORMAL_PER_SLIDE, n)).toEqual({ status: 'showing', card: 1, pass: 1 });
    });
  });
});

describe('estimateClockOffset (§14)', () => {
  it('uses offset = serverTime − (sent + received) / 2', () => {
    expect(estimateClockOffset([{ sent: 1000, received: 1100, serverTime: 5050 }])).toEqual({
      offset: 5050 - (1000 + 1100) / 2,
      rtt: 100,
    });
  });

  it('prefers the lowest round-trip sample', () => {
    const samples: ClockSample[] = [
      { sent: 0, received: 400, serverTime: 10_300 }, // rtt 400, skewed leg
      { sent: 1000, received: 1040, serverTime: 11_020 }, // rtt 40
      { sent: 2000, received: 2200, serverTime: 12_050 }, // rtt 200
    ];
    expect(estimateClockOffset(samples)).toEqual({ offset: 11_020 - 1020, rtt: 40 });
  });

  it('on equal round trips the earlier sample wins', () => {
    const r = estimateClockOffset([
      { sent: 0, received: 50, serverTime: 100 },
      { sent: 100, received: 150, serverTime: 999 },
    ]);
    expect(r?.offset).toBe(100 - 25);
  });

  it('skips unusable samples and returns null when none are left', () => {
    expect(estimateClockOffset([])).toBeNull();
    expect(
      estimateClockOffset([
        { sent: 100, received: 50, serverTime: 0 },
        { sent: Number.NaN, received: 1, serverTime: 1 },
      ]),
    ).toBeNull();
  });

  it('with seeded asymmetric delays, the estimate stays within ± rtt / 2 of the true offset', () => {
    const rng = seededRng(14);
    const trueOffset = 123_456.5;
    for (let trial = 0; trial < 100; trial++) {
      const samples: ClockSample[] = [];
      let clientNow = 1_000 * trial;
      for (let k = 0; k < 5; k++) {
        const up = 5 + rng.int(300);
        const down = 5 + rng.int(300);
        const sent = clientNow;
        const serverTime = sent + up + trueOffset;
        samples.push({ sent, received: sent + up + down, serverTime });
        clientNow += up + down + rng.int(50);
      }
      const est = estimateClockOffset(samples)!;
      expect(est.rtt).toBe(Math.min(...samples.map((s) => s.received - s.sent)));
      expect(Math.abs(est.offset - trueOffset)).toBeLessThanOrEqual(est.rtt / 2);
    }
  });

  it('serverNow adds the offset', () => {
    expect(serverNow(1000, { offset: -250, rtt: 10 })).toBe(750);
  });
});
