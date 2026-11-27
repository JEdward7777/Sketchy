/**
 * Countdowns from absolute server deadlines (stage 8.1, `SPEC.md` §14,
 * protocol.md "Times"): the room sends epoch-ms deadlines on its own clock,
 * never countdowns, and the client converts with the offset measured from
 * `ping`/`pong` (src/shared/clock-offset.ts). Pure, so the unit leg pins it.
 *
 * While the room is paused every phase time is frozen (decision 0011):
 * the time left is `deadline − paused.since`, whatever the clock says.
 */

import { serverNow, type ClockOffset } from '../../shared/clock-offset';

export interface Paused {
  readonly since: number;
}

/** The room's clock now, from this device's clock and the measured offset (none yet: assume no skew). */
export function serverClock(clientNow: number, clock: ClockOffset | null): number {
  return clock ? serverNow(clientNow, clock) : clientNow;
}

/** The instant time stands at: frozen at `since` while paused. */
function effectiveNow(now: number, paused: Paused | null): number {
  return paused ? paused.since : now;
}

/** Milliseconds left until `deadline` (server time), never negative. */
export function timeLeft(deadline: number, now: number, paused: Paused | null): number {
  return Math.max(0, deadline - effectiveNow(now, paused));
}

/** Whole seconds to show, rounded up, so "0" appears only once time is really up. */
export function secondsShown(ms: number): number {
  return Math.ceil(Math.max(0, ms) / 1000);
}

/** `m:ss` from a minute up, plain seconds below it. */
export function formatSeconds(ms: number): string {
  const s = secondsShown(ms);
  if (s < 60) return String(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * How full the host's continue button is (decision 0004 rule 1): 0 until
 * `fillFrom`, 1 at `continueAt`, linear between. The room already folds
 * holds and narration into `fillFrom` (`autoFillStart`), so the client
 * needs nothing else.
 */
export function fillFraction(fillFrom: number, continueAt: number, now: number, paused: Paused | null): number {
  const t = effectiveNow(now, paused);
  const span = continueAt - fillFrom;
  if (span <= 0) return t >= continueAt ? 1 : 0;
  return Math.min(1, Math.max(0, (t - fillFrom) / span));
}
