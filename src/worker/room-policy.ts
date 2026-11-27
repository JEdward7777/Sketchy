/**
 * `RoomDO`'s small pure pieces: the frames it sends, its retry policy, what
 * it logs, and a test seam for injected failures.
 */

import { projectPrivate, projectPublic, type RoomState } from '../shared/core';
import type { ServerMessage } from '../shared/protocol';

export function publicFrame(state: RoomState): string {
  return JSON.stringify({ type: 'state', state: projectPublic(state) } satisfies ServerMessage);
}

export function privateFrame(state: RoomState, player: string): string | null {
  const view = projectPrivate(state, player);
  return view && JSON.stringify({ type: 'private', view } satisfies ServerMessage);
}

export function hasPlayer(state: RoomState, id: string | null | undefined): id is string {
  return typeof id === 'string' && state.players.some((p) => p.id === id);
}

/** The first deal retry waits this long (observation O-07). Our choice. */
export const DEAL_RETRY_MS = 2_000;
/** The deal backoff stops doubling here. Our choice. */
export const DEAL_RETRY_MAX_MS = 5 * 60_000;
/**
 * Source calls in one event: the first ask plus one re-deal when the word
 * was already used (§6). Further re-deals wait for the backoff, so a source
 * that keeps answering used words costs a few rows per retry, not a burst.
 */
export const MAX_DEALS_PER_EVENT = 2;

/**
 * How long to wait before asking again after `attempts` asks without a
 * usable word: `DEAL_RETRY_MS × 2^attempts`, capped at `DEAL_RETRY_MAX_MS`.
 */
export function dealBackoff(attempts: number): number {
  return Math.min(DEAL_RETRY_MS * 2 ** Math.min(attempts, 30), DEAL_RETRY_MAX_MS);
}

/**
 * After an alarm event fails, the alarm is re-armed no sooner than this, so a
 * deadline whose handling keeps throwing is retried once a minute rather than
 * at once in a loop (each alarm is a billed request and `setAlarm` a row).
 */
export const FAILED_ALARM_RETRY_MS = 60_000;

/**
 * What a failure log may say. A `SyntaxError` from `JSON.parse` can quote the
 * stored JSON (the word, tokens), so its message is withheld; other errors
 * come from the adapter or the reducer and name only ids and rules.
 */
export function describeError(err: unknown): string {
  if (err instanceof SyntaxError) return 'SyntaxError (message withheld)';
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return 'unknown error';
}

/** Where `setFaultForTests` can make an event fail. */
export type FaultPoint = 'commit';

let fault: ((point: FaultPoint) => void) | null = null;

/** Called by `RoomDO` at each `FaultPoint`; does nothing outside tests. */
export function faultAt(point: FaultPoint): void {
  fault?.(point);
}

/** Test seam: a function that may throw at a fault point, or null to remove it. */
export function setFaultForTests(f: ((point: FaultPoint) => void) | null): void {
  fault = f;
}
