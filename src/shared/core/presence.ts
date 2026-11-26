/**
 * Presence inside the core (decision 0006 item 2): online/offline from the
 * adapter, the blip grace that turns a socket close into a disconnect
 * (0012 item 2), and the pause below 3 active players (§7, 0011).
 *
 * The grace is the same for every player, so whether a disconnecting
 * player is the faker changes nothing public until the cancel itself
 * (3.6.1): `connected` flips for everyone at `graceUntil`, and only then
 * does `settle` (reduce.ts) apply the faker rule.
 */

import { isGameOver } from '../game-length';
import { releaseAuto, shiftAuto } from './auto-continue';
import { BLIP_GRACE_MS, MIN_PLAYERS, RESTART_WAIT_MS } from './rules';
import { activeCount, findPlayer, noteConnected, timeBase, updatePlayer, type Phase, type PlayerId, type RoomState } from './state';

/** A socket for this player is open: online and connected at once, grace cleared. */
export function goOnline(state: RoomState, id: PlayerId): RoomState {
  const next = updatePlayer(state, id, (p) => ({ ...p, presence: { online: true, connected: true, graceUntil: null } }));
  return noteConnected(next, id);
}

/**
 * The player's last socket closed. They stay connected until the grace runs
 * out. The grace runs on wall time even while paused: it is presence, not a
 * game timer, and a host who drops during a pause must become claimable
 * (0010, 0011 item 3's "a claimed host can still end the game"). The host's
 * holds survive a reload: they are released only when the grace runs out
 * (`expireGrace`).
 */
export function goOffline(state: RoomState, id: PlayerId, now: number): RoomState {
  let next = updatePlayer(state, id, (p) => {
    if (!p.presence.online) return p;
    const graceUntil = p.presence.connected ? now + BLIP_GRACE_MS : null;
    return { ...p, presence: { online: false, connected: p.presence.connected, graceUntil } };
  });
  return next;
}

/**
 * The grace ran out at `at`: the player is now disconnected for game rules.
 * A disconnected host's holds and narration end (0004 rule 5).
 */
export function expireGrace(state: RoomState, id: PlayerId, at: number): RoomState {
  const p = findPlayer(state, id);
  if (!p || p.presence.online || p.presence.graceUntil === null) return state;
  const next = updatePlayer(state, id, (q) => ({ ...q, presence: { online: false, connected: false, graceUntil: null } }));
  return id === next.hostId ? releaseHostHold(next, at) : next;
}

/**
 * End the host's holds and narration, when the host is disconnected (grace
 * over) or the
 * role moves (0004 rule 5, 0010): the deadline then runs normally.
 */
export function releaseHostHold(state: RoomState, now: number): RoomState {
  const phase = state.phase;
  if (phase.name !== 'briefing' && phase.name !== 'results') return state;
  // While paused the release counts from the pause start, so the resume shift keeps it ahead.
  return { ...state, phase: { ...phase, auto: releaseAuto(phase.auto, timeBase(state, now)) } };
}

/**
 * Where a pause may start (0011 as amended by 0027): every phase of a game
 * in progress except
 * - unmask through judging (0027 item 1): votes are in and the faker is
 *   public, so the round runs to results on its timers; a drop below 3
 *   pauses at round results instead;
 * - round results of the game's last round, and final results (item 2): a
 *   finished game needs no quorum to show its podium.
 */
function pausable(state: RoomState): boolean {
  switch (state.phase.name) {
    case 'lobby':
    case 'unmask':
    case 'guess':
    case 'judging':
    case 'final':
      return false;
    case 'results':
      return !(state.progress && isGameOver(state.progress));
    default:
      return true;
  }
}

/**
 * Between rounds: the next round has not started, so it would seat every
 * waiting player (0020 item 4). Also the "between rounds" of decision 0024
 * item 1, where "Rejoin as…" binds at once.
 */
export function betweenRounds(phase: Phase): boolean {
  return phase.name === 'lobby' || phase.name === 'scrubbed' || phase.name === 'results' || phase.name === 'final';
}

/**
 * Connected, non-removed players, seated or waiting: everyone the next
 * round would seat (0020 item 4) who could play it.
 */
export function readyCount(state: RoomState): number {
  return state.players.filter((p) => p.presence.connected && !p.removed).length;
}

/**
 * Players with an open socket, seated or waiting, not removed: who counts
 * toward a 0023 restart (decision 0025 item 1; a player inside the grace
 * with no socket does not).
 */
export function onlineReadyCount(state: RoomState): number {
  return state.players.filter((p) => p.presence.online && !p.removed).length;
}

/** When a paused round may restart with newcomers (0025 item 1), or null when no restart applies. */
export function restartAt(state: RoomState): number | null {
  return state.pause && roundInProgress(state) ? state.pause.since + RESTART_WAIT_MS : null;
}

/**
 * Between rounds (scrubbed, round results) the next round seats every
 * waiting player, so they count toward the 3 (decision 0023 item 1: "just
 * resume and seat normally"). During a round only seated players count
 * (0011 item 1).
 */
function playableCount(state: RoomState): number {
  return betweenRounds(state.phase) ? readyCount(state) : activeCount(state);
}

/** True when a round is under way (dealing through judging): the phases decision 0023 item 1 restarts. */
export function roundInProgress(state: RoomState): boolean {
  return state.round !== null && !betweenRounds(state.phase);
}

/** Freeze everything at `at` when fewer than 3 can play (0011 items 1–3). */
export function maybePause(state: RoomState, at: number): RoomState {
  if (state.pause || !pausable(state) || playableCount(state) >= MIN_PLAYERS) return state;
  return { ...state, pause: { since: at } };
}

/** Every frozen time of the phase, shifted by `delta`; a new timed phase must be added here and in `phaseDeadline`. */
function shiftPhase(phase: Phase, delta: number): Phase {
  switch (phase.name) {
    case 'briefing':
    case 'results':
      return { ...phase, auto: shiftAuto(phase.auto, delta) };
    case 'slideshow':
      // The clients derive the slide from `startsAt`, so it moves with the end.
      return { ...phase, startsAt: phase.startsAt + delta, endsAt: phase.endsAt + delta };
    case 'draw':
    case 'scrubbed':
    case 'browse':
    case 'unmask':
    case 'guess':
    case 'judging':
      return { ...phase, endsAt: phase.endsAt + delta };
    case 'lobby':
    case 'dealing':
    case 'final':
      return phase;
  }
}

/**
 * Resume at `at` once 3 players are active again: every frozen game deadline is
 * re-armed from `at` plus the time it had left at the pause start, which is
 * the same as shifting it by the pause's length (0011 item 3).
 */
export function maybeResume(state: RoomState, at: number): RoomState {
  if (!state.pause || playableCount(state) < MIN_PLAYERS) return state;
  return unpause(state, at);
}

/** Lift the pause at `at`, shifting every frozen game deadline by the pause length. */
export function unpause(state: RoomState, at: number): RoomState {
  if (!state.pause) return state;
  // Blip graces are not shifted: they ran on wall time through the pause.
  return { ...state, pause: null, phase: shiftPhase(state.phase, at - state.pause.since) };
}
