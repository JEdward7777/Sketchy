/**
 * Timer settings (stage 2.9, `SPEC.md` §8): the three presets and the
 * bounds for Custom, which §8 leaves as "any". The Custom bounds are
 * decision 0022. All durations are milliseconds, like every deadline the
 * room stores.
 *
 * The guess timer is also the judging timer (decision 0013 item 1). The
 * vote timer runs after the slideshow's second pass (§8).
 */

export interface TimerSettings {
  readonly drawMs: number;
  readonly perSlideMs: number;
  /** Free browse, after the slideshow (§4 phase 4). */
  readonly voteMs: number;
  readonly guessMs: number;
}

export type TimerPreset = 'quick' | 'normal' | 'relaxed';
export type TimerChoice = TimerPreset | 'custom';

const s = (seconds: number): number => seconds * 1000;

/** The §8 table. */
export const TIMER_PRESETS: Readonly<Record<TimerPreset, TimerSettings>> = {
  quick: { drawMs: s(40), perSlideMs: s(2.5), voteMs: s(30), guessMs: s(20) },
  normal: { drawMs: s(60), perSlideMs: s(3.5), voteMs: s(45), guessMs: s(30) },
  relaxed: { drawMs: s(90), perSlideMs: s(5), voteMs: s(60), guessMs: s(45) },
};

/** §8: "Normal (default)". */
export const DEFAULT_TIMER_PRESET: TimerPreset = 'normal';

export interface Bounds {
  readonly min: number;
  readonly max: number;
}

/**
 * Inclusive Custom bounds per timer (decision 0022, which gives the reasons).
 * The minimums are short enough for the E2E leg's short Custom preset; the
 * draw maximum is twice Relaxed's 90 s.
 */
export const CUSTOM_TIMER_BOUNDS: Readonly<Record<keyof TimerSettings, Bounds>> = {
  drawMs: { min: s(5), max: 2 * TIMER_PRESETS.relaxed.drawMs },
  perSlideMs: { min: s(1), max: 2 * TIMER_PRESETS.relaxed.perSlideMs },
  voteMs: { min: s(5), max: 3 * TIMER_PRESETS.relaxed.voteMs },
  guessMs: { min: s(5), max: s(120) },
};

const KEYS = ['drawMs', 'perSlideMs', 'voteMs', 'guessMs'] as const;

export type CustomTimersResult =
  | { readonly ok: true; readonly timers: TimerSettings }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Validate a Custom timer set from a host (untrusted): an object with
 * exactly the four keys, each an integer number of milliseconds within its
 * `CUSTOM_TIMER_BOUNDS`. Every problem is reported, not just the first.
 */
export function validateCustomTimers(value: unknown): CustomTimersResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['custom timers must be an object'] };
  }
  const record = value as Record<string, unknown>;
  const errors: string[] = [];
  // Unknown keys are counted, not echoed: they are untrusted and may be arbitrarily long.
  const unknown = Object.keys(record).filter((key) => !(KEYS as readonly string[]).includes(key)).length;
  if (unknown > 0) errors.push(`${unknown} unknown timer key(s)`);
  for (const key of KEYS) {
    const v = record[key];
    const { min, max } = CUSTOM_TIMER_BOUNDS[key];
    if (typeof v !== 'number' || !Number.isInteger(v)) errors.push(`${key}: must be an integer number of ms`);
    else if (v < min || v > max) errors.push(`${key}: must be between ${min} and ${max} ms`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    timers: { drawMs: record.drawMs, perSlideMs: record.perSlideMs, voteMs: record.voteMs, guessMs: record.guessMs } as TimerSettings,
  };
}

/** The timers in force for a choice; Custom needs a validated set. */
export function timersFor(choice: TimerChoice, custom?: TimerSettings): TimerSettings {
  if (choice !== 'custom') return TIMER_PRESETS[choice];
  if (!custom) throw new Error('timersFor: custom choice without custom timers');
  return custom;
}
