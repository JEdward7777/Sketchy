/**
 * Choosing the one alarm a Durable Object may have.
 *
 * A DO has a single alarm and `setAlarm` replaces whatever was pending, so
 * every deadline a room tracks (phase timers, the inactivity expiry) is
 * multiplexed onto it: the alarm is always the earliest outstanding deadline.
 * Deadlines are absolute epoch milliseconds so they survive hibernation.
 */

/** The earliest finite deadline, or null when there is none. */
export function earliestDeadline(deadlines: readonly number[]): number | null {
  let earliest: number | null = null;
  for (const d of deadlines) {
    if (!Number.isFinite(d)) continue;
    if (earliest === null || d < earliest) earliest = d;
  }
  return earliest;
}

/** Split deadlines into those due at `now` (inclusive) and those still pending. */
export function partitionDue<T extends { dueAt: number }>(
  deadlines: readonly T[],
  now: number,
): { due: T[]; pending: T[] } {
  const due: T[] = [];
  const pending: T[] = [];
  for (const d of deadlines) (d.dueAt <= now ? due : pending).push(d);
  due.sort((a, b) => a.dueAt - b.dueAt);
  return { due, pending };
}
