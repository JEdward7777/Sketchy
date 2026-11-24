/**
 * Stage 2.9 — timer presets (SPEC §8 table) and Custom validation, with the
 * Custom bounds of decision 0022 and the drawing-size reasoning of 0009
 * item 4 and harness/reference/budget.md.
 */
import { describe, expect, it } from 'vitest';
import { slideshowEnd } from '../../src/shared/slideshow';
import { MEASURED_WORST_BYTES_PER_SECOND, STORAGE_VALUE_LIMIT_BYTES } from '../../src/shared/stroke-format';
import {
  CUSTOM_TIMER_BOUNDS,
  DEFAULT_TIMER_PRESET,
  TIMER_PRESETS,
  timersFor,
  validateCustomTimers,
  type TimerSettings,
} from '../../src/shared/timers';

describe('presets (§8)', () => {
  it('match the §8 table, in ms', () => {
    expect(TIMER_PRESETS).toEqual({
      quick: { drawMs: 40_000, perSlideMs: 2_500, voteMs: 30_000, guessMs: 20_000 },
      normal: { drawMs: 60_000, perSlideMs: 3_500, voteMs: 45_000, guessMs: 30_000 },
      relaxed: { drawMs: 90_000, perSlideMs: 5_000, voteMs: 60_000, guessMs: 45_000 },
    });
    expect(DEFAULT_TIMER_PRESET).toBe('normal');
  });

  it('every preset is itself a valid Custom set', () => {
    for (const p of Object.values(TIMER_PRESETS)) expect(validateCustomTimers({ ...p })).toEqual({ ok: true, timers: p });
  });

  it('timersFor returns the preset, or the given Custom set', () => {
    expect(timersFor('quick')).toBe(TIMER_PRESETS.quick);
    const custom: TimerSettings = { drawMs: 5_000, perSlideMs: 1_000, voteMs: 5_000, guessMs: 5_000 };
    expect(timersFor('custom', custom)).toBe(custom);
    expect(() => timersFor('custom')).toThrow();
  });
});

describe('Custom bounds (decision 0022)', () => {
  it('are the values the decision records', () => {
    expect(CUSTOM_TIMER_BOUNDS).toEqual({
      drawMs: { min: 5_000, max: 180_000 },
      perSlideMs: { min: 1_000, max: 10_000 },
      voteMs: { min: 5_000, max: 180_000 },
      guessMs: { min: 5_000, max: 120_000 },
    });
  });

  it('the draw maximum fits one storage value at the measured worst rate, so 6.4 need not chunk (0009 item 4)', () => {
    const fitSeconds = Math.floor(STORAGE_VALUE_LIMIT_BYTES / MEASURED_WORST_BYTES_PER_SECOND);
    expect(fitSeconds).toBe(3_447); // budget.md's "longest draw in one storage value", 240 Hz scribble
    expect(CUSTOM_TIMER_BOUNDS.drawMs.max / 1000).toBeLessThan(fitSeconds);
  });

  it('a 10-player slideshow at the longest per-slide time is 200 s (§8: players × 2 × perSlide)', () => {
    expect(slideshowEnd(0, CUSTOM_TIMER_BOUNDS.perSlideMs.max, 10) / 1000).toBe(200);
  });
});

describe('validateCustomTimers', () => {
  const ok = { drawMs: 30_000, perSlideMs: 2_000, voteMs: 20_000, guessMs: 15_000 };

  it('accepts the bounds themselves (inclusive)', () => {
    const lo = Object.fromEntries(Object.entries(CUSTOM_TIMER_BOUNDS).map(([k, b]) => [k, b.min]));
    const hi = Object.fromEntries(Object.entries(CUSTOM_TIMER_BOUNDS).map(([k, b]) => [k, b.max]));
    expect(validateCustomTimers(lo).ok).toBe(true);
    expect(validateCustomTimers(hi).ok).toBe(true);
    expect(validateCustomTimers(ok)).toEqual({ ok: true, timers: ok });
  });

  it.each<[string, unknown]>([
    ['not an object', 30],
    ['null', null],
    ['an array', [1, 2, 3, 4]],
    ['a missing timer', { drawMs: 30_000, perSlideMs: 2_000, voteMs: 20_000 }],
    ['an unknown key', { ...ok, bonusMs: 1 }],
    ['below a minimum', { ...ok, drawMs: 4_999 }],
    ['above a maximum', { ...ok, perSlideMs: 10_001 }],
    ['a fraction of a ms', { ...ok, voteMs: 20_000.5 }],
    ['a string', { ...ok, guessMs: '15000' }],
    ['NaN', { ...ok, guessMs: Number.NaN }],
  ])('rejects %s', (_name, value) => {
    expect(validateCustomTimers(value).ok).toBe(false);
  });

  it('does not echo unknown (untrusted, possibly huge) keys', () => {
    const r = validateCustomTimers({ ...ok, ['k'.repeat(1_000_000)]: 1 });
    expect(r).toEqual({ ok: false, errors: ['1 unknown timer key(s)'] });
  });

  it('reports every problem, not just the first', () => {
    const r = validateCustomTimers({ drawMs: 1, perSlideMs: 1, voteMs: 1, guessMs: 1 });
    expect(r.ok === false && r.errors.length).toBe(4);
  });
});
