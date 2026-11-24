/**
 * The one place `RoomDO` reads the time.
 *
 * Production always uses `Date.now()`. Tests replace the source because
 * `runDurableObjectAlarm` runs the alarm handler immediately without moving
 * the clock: to fire a deadline "at" its scheduled instant, the DO-leg helper
 * sets this clock to that instant first. The DO leg runs the Worker in the
 * same isolate as the tests, so the override reaches the object.
 *
 * This holds no game timing: deadlines live in storage. It only decides what
 * "now" means.
 */

let source: () => number = () => Date.now();

export function now(): number {
  return source();
}

/** Test seam: pass a function to pin the clock, or null to restore `Date.now`. */
export function setClockForTests(fn: (() => number) | null): void {
  source = fn ?? (() => Date.now());
}
