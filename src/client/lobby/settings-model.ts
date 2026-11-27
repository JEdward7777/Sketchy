/**
 * The host settings panel's form logic (stage 4.6, `SPEC.md` §6–8,
 * decisions 0018, 0022, 0023). The host types Custom timers in seconds;
 * the room stores integer milliseconds within `CUSTOM_TIMER_BOUNDS`.
 */

import type { DifficultySetting } from '../../shared/difficulty-bag';
import { CYCLES_MAX, CYCLES_MIN } from '../../shared/game-length';
import type { SettingsPatch } from '../../shared/protocol';
import {
  CUSTOM_TIMER_BOUNDS,
  TIMER_PRESETS,
  validateCustomTimers,
  type TimerChoice,
  type TimerSettings,
} from '../../shared/timers';
import type { PublicSettings } from '../../shared/core/views';

export const DIFFICULTY_OPTIONS: readonly { value: DifficultySetting; label: string }[] = [
  { value: 'mixed', label: 'Mixed' },
  { value: 'concrete', label: 'Concrete' },
  { value: 'medium', label: 'Medium' },
  { value: 'abstract', label: 'Abstract' },
];

export const TIMER_OPTIONS: readonly { value: TimerChoice; label: string }[] = [
  { value: 'quick', label: 'Quick' },
  { value: 'normal', label: 'Normal' },
  { value: 'relaxed', label: 'Relaxed' },
  { value: 'custom', label: 'Custom' },
];

export const CYCLE_OPTIONS: readonly number[] = Array.from({ length: CYCLES_MAX - CYCLES_MIN + 1 }, (_, i) => CYCLES_MIN + i);

export type TimerKey = keyof TimerSettings;
export const TIMER_FIELDS: readonly { key: TimerKey; label: string }[] = [
  { key: 'drawMs', label: 'Draw' },
  { key: 'perSlideMs', label: 'Per slide' },
  { key: 'voteMs', label: 'Vote' },
  { key: 'guessMs', label: 'Guess' },
];

/** Seconds as the form shows them: `2.5`, `60`. */
export function msToSecondsText(ms: number): string {
  return String(Math.round(ms / 100) / 10);
}

/** The draft the Custom form starts from: the stored Custom set, else the preset in force. */
export function customDraft(settings: PublicSettings): Record<TimerKey, string> {
  const base = settings.custom ?? TIMER_PRESETS[settings.timers === 'custom' ? 'normal' : settings.timers];
  return {
    drawMs: msToSecondsText(base.drawMs),
    perSlideMs: msToSecondsText(base.perSlideMs),
    voteMs: msToSecondsText(base.voteMs),
    guessMs: msToSecondsText(base.guessMs),
  };
}

/** Bounds in seconds for a field's hint, e.g. "5–180 s". */
export function boundsText(key: TimerKey): string {
  const { min, max } = CUSTOM_TIMER_BOUNDS[key];
  return `${msToSecondsText(min)}–${msToSecondsText(max)} s`;
}

export type DraftResult =
  | { readonly ok: true; readonly timers: TimerSettings }
  | { readonly ok: false; readonly fields: ReadonlySet<TimerKey> };

/**
 * Parse a seconds draft into a valid Custom set (decision 0022 bounds), or
 * name every field that is not a number within its bounds. Seconds are
 * rounded to whole milliseconds; the room wants integers.
 */
export function parseCustomDraft(draft: Readonly<Record<TimerKey, string>>): DraftResult {
  const bad = new Set<TimerKey>();
  const ms: Partial<Record<TimerKey, number>> = {};
  for (const { key } of TIMER_FIELDS) {
    const text = draft[key].trim();
    const seconds = text === '' ? NaN : Number(text);
    const value = Math.round(seconds * 1000);
    const { min, max } = CUSTOM_TIMER_BOUNDS[key];
    if (!Number.isFinite(seconds) || value < min || value > max) bad.add(key);
    else ms[key] = value;
  }
  if (bad.size > 0) return { ok: false, fields: bad };
  const checked = validateCustomTimers(ms);
  if (!checked.ok) return { ok: false, fields: new Set(TIMER_FIELDS.map((f) => f.key)) };
  return { ok: true, timers: checked.timers };
}

/**
 * The patch for picking a timer choice. Custom with no stored set sends the
 * draft's values too, because the room refuses Custom without values
 * (`bad_settings`).
 */
export function timerChoicePatch(choice: TimerChoice, settings: PublicSettings): SettingsPatch {
  if (choice !== 'custom' || settings.custom !== null) return { timers: choice };
  const draft = parseCustomDraft(customDraft(settings));
  return draft.ok ? { timers: 'custom', custom: draft.timers } : { timers: 'custom' };
}

/** The timers in force, for the read-only summary. */
export function timersInForce(settings: PublicSettings): TimerSettings {
  if (settings.timers === 'custom') return settings.custom ?? TIMER_PRESETS.normal;
  return TIMER_PRESETS[settings.timers];
}

export function timersSummary(settings: PublicSettings): string {
  const t = timersInForce(settings);
  const s = (ms: number) => `${msToSecondsText(ms)} s`;
  return `draw ${s(t.drawMs)} · slide ${s(t.perSlideMs)} · vote ${s(t.voteMs)} · guess ${s(t.guessMs)}`;
}
