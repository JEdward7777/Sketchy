/**
 * Draw-phase rules on the client (stages 8.6, 8.7): when to submit by
 * itself, when to send an unconfirmed drawing again, and the drawing in
 * progress kept in session storage so a reload mid-draw does not wipe it. Pure, so the unit leg pins it.
 */

import { decodeStrokes, encodeStrokes, type Stroke } from '../../shared/stroke-codec';
import type { KeyValueStorage } from '../net/token-store';
import { DRAW_SUBMIT_GRACE_MS } from '../../shared/core/rules';
import type { Paused } from './countdown';

/**
 * How long to wait past `endsAt` before submitting by itself when no clock
 * offset has been measured yet (no `pong` arrived): the device clock may
 * run ahead of the room's, and sending early would cut the drawing short.
 * Half of `DRAW_SUBMIT_GRACE_MS`, so a device clock that is right still
 * lands inside the grace.
 */
export const UNSYNCED_SUBMIT_DELAY_MS = DRAW_SUBMIT_GRACE_MS / 2;

/**
 * True when the drawing should go by itself: the countdown has run out by
 * the room's clock. There is no upper bound: once the room has closed the
 * draw it answers `wrong_phase` (or the phase has already moved on), which
 * is harmless. Never while paused: the room's times are frozen.
 */
export function autoSubmitDue(now: number, endsAt: number, paused: Paused | null, clockKnown: boolean): boolean {
  return paused === null && now >= endsAt + (clockKnown ? 0 : UNSYNCED_SUBMIT_DELAY_MS);
}

/**
 * A `draw:done` the room has not confirmed yet (public `round.done` does
 * not list this player). A frame sent on a socket that was already dying
 * is lost without any error, so it is sent again at once on every new
 * socket. On the same socket it is resent only once the socket has
 * flushed what it holds (`bufferedAmount` 0: a slow upload is not a lost
 * one) and after a backoff of `DRAW_RESEND_MS`, doubling per resend up to
 * `DRAW_RESEND_MAX_MS`. A duplicate that does land is refused with
 * `already_done`, which changes nothing.
 */
export interface PendingDraw {
  /** Client epoch ms of the last send. */
  readonly at: number;
  /** The socket generation (`RoomSnapshot.opens`) it went out on; -1 when it could not be sent at all. */
  readonly socket: number;
  /** Resends on that same socket so far. */
  readonly tries: number;
}

export const DRAW_RESEND_MS = 4_000;
/** `DRAW_RESEND_MS × 2²`: 4 → 8 → 16 s, then every 16 s. */
export const DRAW_RESEND_MAX_MS = DRAW_RESEND_MS * 4;

export function resendDelay(tries: number): number {
  return Math.min(DRAW_RESEND_MAX_MS, DRAW_RESEND_MS * 2 ** Math.max(0, tries));
}

export function resendDue(pending: PendingDraw, now: number, socket: number, buffered: number): boolean {
  if (pending.socket !== socket) return true;
  return buffered === 0 && now - pending.at >= resendDelay(pending.tries);
}

/** The pending record after a send at `now` on `socket`. */
export function sentAgain(pending: PendingDraw | null, now: number, socket: number): PendingDraw {
  return { at: now, socket, tries: pending && pending.socket === socket ? pending.tries + 1 : 0 };
}

const DRAFT_PREFIX = 'sketchy:draft:';

export function draftKey(code: string, roundNo: number): string {
  return `${DRAFT_PREFIX}${code.toUpperCase()}:${roundNo}`;
}

/** Store the drawing in progress. Storage that refuses writes (full, private mode) just means no draft. */
export function saveDraft(storage: KeyValueStorage | null, code: string, roundNo: number, strokes: readonly Stroke[]): void {
  if (!storage) return;
  try {
    storage.setItem(draftKey(code, roundNo), JSON.stringify(encodeStrokes(strokes)));
  } catch {
    // No draft then.
  }
}

/** The stored drawing for this round, if any; drafts of every other round are dropped. */
export function loadDraft(storage: KeyValueStorage | null, code: string, roundNo: number): Stroke[] {
  if (!storage) return [];
  const key = draftKey(code, roundNo);
  try {
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k !== null && k.startsWith(DRAFT_PREFIX) && k !== key) stale.push(k);
    }
    for (const k of stale) storage.removeItem(k);
    const raw = storage.getItem(key);
    if (raw === null) return [];
    const decoded = decodeStrokes(JSON.parse(raw));
    return decoded.ok ? decoded.strokes : [];
  } catch {
    return [];
  }
}

export function dropDraft(storage: KeyValueStorage | null, code: string, roundNo: number): void {
  try {
    storage?.removeItem(draftKey(code, roundNo));
  } catch {
    // Nothing to drop.
  }
}
