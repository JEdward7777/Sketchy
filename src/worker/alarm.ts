import { earliestDeadline } from '../shared/deadlines';

/**
 * Point the Durable Object's single alarm at the earliest of `deadlines`
 * (absolute epoch ms), or clear it when there are none.
 *
 * This is the only caller of `setAlarm` in the codebase. `setAlarm` replaces
 * any pending alarm, so a feature that set its own would silently cancel
 * another's deadline. Phase 1 feeds it a stored list; from phase 4 the list
 * comes from `nextDeadline(state)`.
 *
 * It reads the current alarm first and skips an identical write, because each
 * `setAlarm()` is billed as one SQLite row written (see reference/budget.md).
 */
export async function armAlarm(
  storage: DurableObjectStorage,
  deadlines: readonly number[],
): Promise<number | null> {
  const next = earliestDeadline(deadlines);
  const current = await storage.getAlarm();
  if (next === null) {
    if (current !== null) await storage.deleteAlarm();
    return null;
  }
  if (current !== next) await storage.setAlarm(next);
  return next;
}
