/**
 * Host "continue" points that auto-advance unless the host is busy
 * (decision 0004; briefing narrowed by 0017). Pure functions over
 * `AutoContinue`; the briefing uses them now and round results (3b) can
 * reuse them.
 *
 * - The fill starts at `fillFrom` and takes `beatMs` (rule 1).
 * - A hold pushes the fill start to `HOLD_REARM_MS` after the tap (rule 3).
 * - While the narrator speaks the fill waits, capped at `NARRATION_CAP_MS`
 *   after speaking started (rule 2); when speaking stops the fill starts no
 *   earlier than that instant.
 * - Holds and narration count only from a connected host; once the host is
 *   disconnected (the blip grace ran out, 0012 item 2) or the role moves
 *   (0010), both are dropped and the fill runs from the release instant at
 *   the latest (rule 5, `releaseAuto`). A reload inside the grace keeps them.
 */

import { HOLD_REARM_MS, NARRATION_CAP_MS } from './rules';
import type { AutoContinue } from './state';

export function startAuto(base: number, beatMs: number): AutoContinue {
  return { startedAt: base, fillFrom: base, speakingCapAt: null, beatMs };
}

/** When the fill actually starts: after `fillFrom` and after any narration (capped). */
export function autoFillStart(auto: AutoContinue): number {
  return Math.max(auto.fillFrom, auto.speakingCapAt ?? auto.fillFrom);
}

/** When the phase auto-continues. */
export function autoDue(auto: AutoContinue): number {
  return autoFillStart(auto) + auto.beatMs;
}

/** A tap elsewhere on the host's screen at `now` (rule 3). */
export function holdAuto(auto: AutoContinue, now: number): AutoContinue {
  return { ...auto, fillFrom: Math.max(auto.fillFrom, now + HOLD_REARM_MS) };
}

/** The narrator started (`true`) or stopped (`false`) at `now` (rule 2). */
export function narrateAuto(auto: AutoContinue, speaking: boolean, now: number): AutoContinue {
  if (speaking) return { ...auto, speakingCapAt: now + NARRATION_CAP_MS };
  if (auto.speakingCapAt === null) return auto;
  return { ...auto, speakingCapAt: null, fillFrom: Math.max(auto.fillFrom, Math.min(now, auto.speakingCapAt)) };
}

/**
 * The host left at `at` (disconnected, or the role moved, 0010): their holds
 * and narration no longer count, so the deadline runs normally (rule 5).
 * The fill starts at `startedAt` if no hold or narration had moved it past
 * `at`, otherwise at `at`: the host's extra time ends now, but the deadline
 * never lands before the release (which would skip the phase that follows).
 */
export function releaseAuto(auto: AutoContinue, at: number): AutoContinue {
  const stopped = narrateAuto(auto, false, at);
  return { ...stopped, fillFrom: Math.max(auto.startedAt, Math.min(stopped.fillFrom, at)) };
}

/** Shift every time by `delta` (resume after a pause, 0011 item 3). */
export function shiftAuto(auto: AutoContinue, delta: number): AutoContinue {
  return {
    ...auto,
    startedAt: auto.startedAt + delta,
    fillFrom: auto.fillFrom + delta,
    speakingCapAt: auto.speakingCapAt === null ? null : auto.speakingCapAt + delta,
  };
}
