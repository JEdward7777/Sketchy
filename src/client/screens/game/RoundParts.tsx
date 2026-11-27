/**
 * Small pieces the round screens share: the public category (always
 * visible, §4, §6) and a countdown to a server deadline (8.1). The on-deck
 * notice moved to Fairness.tsx (phase 11).
 */

import type { ClockOffset } from '../../../shared/clock-offset';
import { formatSeconds, secondsShown, timeLeft, type Paused } from '../../game/countdown';
import { useServerNow } from '../../game/use-now';

export function CategoryBadge({ category }: { category: string | null }) {
  return (
    <p className="category-badge" data-testid="category">
      <span className="category-label">Category</span>
      <span className="category-name">{category ?? '…'}</span>
    </p>
  );
}

/** Seconds left on a phase deadline, frozen while paused. Turns urgent in the last `urgentMs`. */
export function Countdown({
  deadline,
  paused,
  clock,
  label,
  urgentMs = 5_000,
  testId = 'countdown',
}: {
  deadline: number;
  paused: Paused | null;
  clock: ClockOffset | null;
  label: string;
  urgentMs?: number;
  testId?: string;
}) {
  const now = useServerNow(clock, 250);
  const left = timeLeft(deadline, now, paused);
  return (
    <p className="countdown" data-testid={testId} data-urgent={left <= urgentMs} role="timer" aria-label={`${label}: ${secondsShown(left)} seconds left`}>
      <span className="countdown-value">{formatSeconds(left)}</span>
      {secondsShown(left) < 60 ? <span className="countdown-unit">s</span> : null}
    </p>
  );
}
