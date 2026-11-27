import { describe, expect, it } from 'vitest';
import {
  CYCLE_OPTIONS,
  DIFFICULTY_OPTIONS,
  TIMER_FIELDS,
  boundsText,
  customDraft,
  msToSecondsText,
  parseCustomDraft,
  timerChoicePatch,
  timersInForce,
} from '../../../src/client/lobby/settings-model';
import { CYCLES_DEFAULT, CYCLES_MAX, CYCLES_MIN } from '../../../src/shared/game-length';
import { DEFAULT_DIFFICULTY } from '../../../src/shared/core/rules';
import { CUSTOM_TIMER_BOUNDS, TIMER_PRESETS } from '../../../src/shared/timers';
import type { PublicSettings } from '../../../src/shared/core/views';

const normal: PublicSettings = { difficulty: 'mixed', cycles: 2, timers: 'normal', custom: null };
const draftOf = (t: { drawMs: number; perSlideMs: number; voteMs: number; guessMs: number }) => ({
  drawMs: String(t.drawMs / 1000),
  perSlideMs: String(t.perSlideMs / 1000),
  voteMs: String(t.voteMs / 1000),
  guessMs: String(t.guessMs / 1000),
});

describe('host settings form (stage 4.6)', () => {
  it('offers the four difficulties with Mixed first (0023) and cycles 1–3 (0018 default inside)', () => {
    expect(DIFFICULTY_OPTIONS.map((o) => o.value)).toEqual(['mixed', 'concrete', 'medium', 'abstract']);
    expect(DIFFICULTY_OPTIONS[0]!.value).toBe(DEFAULT_DIFFICULTY);
    expect(CYCLE_OPTIONS).toEqual([1, 2, 3]);
    expect(CYCLE_OPTIONS[0]).toBe(CYCLES_MIN);
    expect(CYCLE_OPTIONS.at(-1)).toBe(CYCLES_MAX);
    expect(CYCLE_OPTIONS).toContain(CYCLES_DEFAULT);
  });

  it('starts the Custom draft from the stored set, else the preset in force', () => {
    expect(customDraft(normal)).toEqual({ drawMs: '60', perSlideMs: '3.5', voteMs: '45', guessMs: '30' });
    expect(customDraft({ ...normal, timers: 'quick' }).perSlideMs).toBe('2.5');
    const custom = { drawMs: 5000, perSlideMs: 1000, voteMs: 5000, guessMs: 5000 };
    expect(customDraft({ ...normal, timers: 'custom', custom })).toEqual({ drawMs: '5', perSlideMs: '1', voteMs: '5', guessMs: '5' });
  });

  it('accepts every bound exactly and every preset (0022)', () => {
    const min = parseCustomDraft(draftOf({
      drawMs: CUSTOM_TIMER_BOUNDS.drawMs.min, perSlideMs: CUSTOM_TIMER_BOUNDS.perSlideMs.min,
      voteMs: CUSTOM_TIMER_BOUNDS.voteMs.min, guessMs: CUSTOM_TIMER_BOUNDS.guessMs.min,
    }));
    expect(min).toEqual({ ok: true, timers: { drawMs: 5000, perSlideMs: 1000, voteMs: 5000, guessMs: 5000 } });
    const max = parseCustomDraft(draftOf({
      drawMs: CUSTOM_TIMER_BOUNDS.drawMs.max, perSlideMs: CUSTOM_TIMER_BOUNDS.perSlideMs.max,
      voteMs: CUSTOM_TIMER_BOUNDS.voteMs.max, guessMs: CUSTOM_TIMER_BOUNDS.guessMs.max,
    }));
    expect(max.ok).toBe(true);
    for (const preset of Object.values(TIMER_PRESETS)) expect(parseCustomDraft(draftOf(preset))).toEqual({ ok: true, timers: preset });
  });

  it('names each field outside its bounds or not a number', () => {
    const r = parseCustomDraft({ drawMs: '4.999', perSlideMs: '10.001', voteMs: 'abc', guessMs: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect([...r.fields].sort()).toEqual(['drawMs', 'guessMs', 'perSlideMs', 'voteMs']);
    const one = parseCustomDraft({ drawMs: '200', perSlideMs: '2', voteMs: '30', guessMs: '20' });
    expect(one.ok).toBe(false);
    if (!one.ok) expect([...one.fields]).toEqual(['drawMs']);
  });

  it('rounds seconds to whole milliseconds', () => {
    const r = parseCustomDraft({ drawMs: ' 12.3456 ', perSlideMs: '2.5', voteMs: '30', guessMs: '20' });
    expect(r).toEqual({ ok: true, timers: { drawMs: 12346, perSlideMs: 2500, voteMs: 30000, guessMs: 20000 } });
  });

  it('sends values with the first switch to Custom, since the room refuses Custom without them', () => {
    expect(timerChoicePatch('quick', normal)).toEqual({ timers: 'quick' });
    expect(timerChoicePatch('custom', normal)).toEqual({ timers: 'custom', custom: TIMER_PRESETS.normal });
    const stored = { ...normal, custom: TIMER_PRESETS.quick };
    expect(timerChoicePatch('custom', stored)).toEqual({ timers: 'custom' });
  });

  it('summarizes the timers in force and the bounds', () => {
    expect(timersInForce(normal)).toBe(TIMER_PRESETS.normal);
    expect(timersInForce({ ...normal, timers: 'custom', custom: TIMER_PRESETS.relaxed })).toBe(TIMER_PRESETS.relaxed);
    expect(boundsText('drawMs')).toBe('5–180 s');
    expect(boundsText('perSlideMs')).toBe('1–10 s');
    expect(msToSecondsText(2500)).toBe('2.5');
    expect(TIMER_FIELDS.map((f) => f.key)).toEqual(['drawMs', 'perSlideMs', 'voteMs', 'guessMs']);
  });
});
