/**
 * When the room socket should come back on its own, and how soon (stages
 * 4.3, 4.4; `SPEC.md` §7 "A reload, sleep or Wi-Fi drop reconnects
 * automatically"). Pure, so the unit leg can pin it.
 */

import { CLOSE_NO_ROOM, CLOSE_REPLACED, CLOSE_VERSION_MISMATCH, type ErrorCode } from '../../shared/protocol';

/** First retry delay; doubles per failed attempt up to the cap in force. */
export const RECONNECT_BASE_MS = 500;
/**
 * While the drop is recent the cap stays low, so a phone that lost Wi-Fi for
 * a moment is back well inside the room's `BLIP_GRACE_MS` (10 s) and nobody
 * sees it go dark.
 */
export const RECONNECT_FAST_CAP_MS = 3_000;
/** How long after the drop the low cap applies. */
export const RECONNECT_FAST_WINDOW_MS = 15_000;
/** Cap once the outage is longer: stop hammering a network that is not coming back soon. */
export const RECONNECT_MAX_MS = 10_000;

/**
 * A socket that has not reached `welcome` in `connectTimeout(attempt)` is
 * abandoned and retried. The wait grows with each attempt, so a slow link
 * (venue Wi-Fi, a cold start) that needs longer than the first wait still
 * gets through.
 */
export const CONNECT_TIMEOUT_MS = 5_000;
export const CONNECT_TIMEOUT_MAX_MS = 15_000;

/** `min(CONNECT_TIMEOUT_MS × (attempt + 1), CONNECT_TIMEOUT_MAX_MS)`. */
export function connectTimeout(attempt: number): number {
  return Math.min(CONNECT_TIMEOUT_MS * (Math.max(0, Math.floor(attempt)) + 1), CONNECT_TIMEOUT_MAX_MS);
}
/** `nudge()` abandons a socket that has been connecting at least this long. */
export const NUDGE_STALE_MS = 3_000;
/** On waking with an open socket, a probe ping without a pong in this long means the socket is dead. */
export const WAKE_PROBE_MS = 3_000;

/**
 * Delay before reconnect attempt `attempt` (0 for the first retry),
 * `sinceDropMs` after the connection was lost:
 * `min(RECONNECT_BASE_MS × 2^attempt, cap)` with cap `RECONNECT_FAST_CAP_MS`
 * inside `RECONNECT_FAST_WINDOW_MS` and `RECONNECT_MAX_MS` after, scaled by
 * a jitter in [0.5, 1) from `random` so a room full of phones waking at
 * once does not reconnect in lockstep.
 */
export function reconnectDelay(attempt: number, sinceDropMs: number, random: () => number = Math.random): number {
  const n = Math.max(0, Math.floor(attempt));
  const cap = sinceDropMs < RECONNECT_FAST_WINDOW_MS ? RECONNECT_FAST_CAP_MS : RECONNECT_MAX_MS;
  const capped = Math.min(RECONNECT_BASE_MS * 2 ** Math.min(n, 30), cap);
  const r = random();
  const jitter = 0.5 + 0.5 * (Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999) : 0.5);
  return Math.round(capped * jitter);
}

/** Why a socket ended for good; null while the client should keep trying. */
export type Terminal = 'replaced' | 'no_room' | 'version';

/** The terminal reason a server error code carries, if any (protocol.md "Errors"). */
export function terminalForError(code: ErrorCode): Terminal | null {
  if (code === 'replaced' || code === 'no_room' || code === 'version') return code;
  return null;
}

/** The terminal reason a close code carries, if any. Other codes (1006 drops, 1001 going away) are retried. */
export function terminalForClose(closeCode: number): Terminal | null {
  switch (closeCode) {
    case CLOSE_REPLACED:
      // Another tab or device took this seat; reconnecting would steal it back
      // and the two would take turns forever (protocol.md "One socket per player").
      return 'replaced';
    case CLOSE_NO_ROOM:
      return 'no_room';
    case CLOSE_VERSION_MISMATCH:
      return 'version';
    default:
      return null;
  }
}
