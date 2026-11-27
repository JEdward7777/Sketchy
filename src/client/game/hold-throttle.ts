/**
 * The host's "hold" taps (decision 0004 rule 3, narrowed by 0017): every
 * tap on the host's screen except Continue and the briefing envelope tells
 * the room to push the auto-continue out by `HOLD_REARM_MS`.
 *
 * 0004 "Revisit if" asks for client-side throttling to at most one
 * `host:hold` per few seconds. A tap inside the window is not lost: one
 * trailing `host:hold` goes when the window ends, so the room's re-arm
 * instant is never more than the window earlier than the host's last tap
 * would have made it. Side effects are injected so the unit leg drives it.
 */

/** At most one `host:hold` per this many ms (0004: "one per few seconds"). */
export const HOLD_THROTTLE_MS = 3_000;

export interface ThrottleDeps {
  readonly send: () => void;
  readonly now: () => number;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

export class HoldThrottle {
  private lastSent = Number.NEGATIVE_INFINITY;
  private trailing: unknown = null;

  constructor(private readonly deps: ThrottleDeps) {}

  tap(): void {
    const now = this.deps.now();
    const next = this.lastSent + HOLD_THROTTLE_MS;
    if (now >= next) {
      this.fire(now);
      return;
    }
    if (this.trailing !== null) return;
    this.trailing = this.deps.setTimer(() => {
      this.trailing = null;
      this.fire(this.deps.now());
    }, next - now);
  }

  /** Stop: a pending trailing hold is dropped (the phase it was for has ended). */
  dispose(): void {
    if (this.trailing !== null) this.deps.clearTimer(this.trailing);
    this.trailing = null;
  }

  private fire(now: number): void {
    this.lastSent = now;
    this.deps.send();
  }
}

/** Taps on or inside an element marked `data-hold-exempt` (Continue, the envelope) are not holds. */
export const HOLD_EXEMPT_ATTR = 'data-hold-exempt';
