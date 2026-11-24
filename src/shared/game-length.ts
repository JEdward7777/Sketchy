/**
 * Faker pick, round roster and game length (stage 2.7): `SPEC.md` §7 as
 * amended by decision 0020, with 0018 (default cycles) and 0019 (removed
 * players can return).
 *
 * - The faker is picked uniformly at random every round, from the round
 *   roster's connected players, with the room RNG. No history is an input,
 *   so past rounds cannot affect the pick (0020 item 1).
 * - `totalRounds = cycles × roster size at host:start`; late joiners do not
 *   change it (0020 item 2).
 * - A cancelled round awards nothing and does not count (0020 item 3); the
 *   next round simply calls `pickFaker` again.
 * - Late joiners and returning removed players are seated from the next
 *   round (0020 item 4): the round roster is fixed when a round starts and
 *   `seatRoundRoster` is only called then.
 */

import { rngPick, type Drawn, type RngState } from './rng';
import type { PlayerId } from './scoring';

export const CYCLES_MIN = 1;
export const CYCLES_MAX = 3;
/** Decision 0018. */
export const CYCLES_DEFAULT = 2;

export function isValidCycles(cycles: unknown): cycles is number {
  return Number.isInteger(cycles) && (cycles as number) >= CYCLES_MIN && (cycles as number) <= CYCLES_MAX;
}

/** `cycles × roster size at host:start` (0020 item 2). */
export function totalRounds(cycles: number, rosterSizeAtStart: number): number {
  if (!isValidCycles(cycles)) throw new RangeError(`cycles must be ${CYCLES_MIN}–${CYCLES_MAX}, got ${cycles}`);
  if (!Number.isInteger(rosterSizeAtStart) || rosterSizeAtStart < 0) {
    throw new RangeError(`roster size must be a non-negative integer, got ${rosterSizeAtStart}`);
  }
  return cycles * rosterSizeAtStart;
}

/** Rounds completed so far against the length fixed at start. */
export interface GameProgress {
  readonly completedRounds: number;
  readonly totalRounds: number;
}

export function startProgress(cycles: number, rosterSizeAtStart: number): GameProgress {
  return { completedRounds: 0, totalRounds: totalRounds(cycles, rosterSizeAtStart) };
}

/** A completed round counts; a cancelled one does not (0020 item 3). */
export function recordRoundEnd(progress: GameProgress, ending: 'completed' | 'cancelled'): GameProgress {
  if (ending === 'cancelled') return progress;
  return { ...progress, completedRounds: progress.completedRounds + 1 };
}

/** The game ends after `totalRounds` completed rounds. */
export function isGameOver(progress: GameProgress): boolean {
  return progress.completedRounds >= progress.totalRounds;
}

/** What seating needs to know about a player in the room. */
export interface SeatablePlayer {
  readonly id: PlayerId;
  /** Removed by the host (§7). Cleared when the player returns (0019 item 1). */
  readonly removed: boolean;
}

/**
 * The roster for a round about to start: every player in the room who is
 * not removed, in room order. Disconnected players are seated (their card
 * goes dark, §7); late joiners and returned players are seated because this
 * runs at each round's start, never mid-round (0020 item 4).
 */
export function seatRoundRoster(players: readonly SeatablePlayer[]): PlayerId[] {
  return players.filter((p) => !p.removed).map((p) => p.id);
}

/** The roster players who are connected now: the faker candidates. */
export function connectedRoster(roster: readonly PlayerId[], isConnected: (id: PlayerId) => boolean): PlayerId[] {
  return roster.filter(isConnected);
}

/**
 * Pick the faker uniformly from the round roster's connected players
 * (0020 item 1). Takes only the RNG state and the candidates.
 */
export function pickFaker(state: RngState, connectedRosterPlayers: readonly PlayerId[]): Drawn<PlayerId> {
  if (connectedRosterPlayers.length === 0) throw new RangeError('pickFaker: no connected roster players');
  return rngPick(state, connectedRosterPlayers);
}
