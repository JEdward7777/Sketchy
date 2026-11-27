/**
 * React helpers for the round screens: a clock that re-renders, read as
 * server time (countdown.ts), and the host's hold taps (hold-throttle.ts).
 */

import { useEffect, useState } from 'react';
import type { ClockOffset } from '../../shared/clock-offset';
import { serverClock } from './countdown';
import { HOLD_EXEMPT_ATTR, HoldThrottle } from './hold-throttle';

/** Server time now, refreshed every `intervalMs`. */
export function useServerNow(clock: ClockOffset | null, intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return serverClock(now, clock);
}

/**
 * While `enabled`, any pointer press or key press on the page outside an
 * element marked `data-hold-exempt` sends a throttled `host:hold` (decisions 0004 rule 3,
 * 0017). Listens in the capture phase, so a control that stops propagation
 * still counts as a tap on the host's screen.
 */
export function useHostHold(enabled: boolean, send: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const throttle = new HoldThrottle({
      send,
      now: () => Date.now(),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (h) => window.clearTimeout(h as number),
    });
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Element && t.closest(`[${HOLD_EXEMPT_ATTR}]`)) return;
      throttle.tap();
    };
    // Typing on the host's screen is busy too (a keyboard-only host), except on Continue or the envelope.
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const t = e.target;
      if (t instanceof Element && t.closest(`[${HOLD_EXEMPT_ATTR}]`)) return;
      throttle.tap();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      throttle.dispose();
    };
    // `send` is a fresh closure each render; the listener only needs the latest connection, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
