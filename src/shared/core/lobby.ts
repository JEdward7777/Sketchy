/**
 * Joining, identity and host controls (stage 3.3.1, with host claim (0010)
 * and remove pulled forward from 3.3.5 because the lobby needs them).
 *
 * - `join`: name, unique color, spy icon (§2). Refused at 10 players,
 *   counting removed players and waiting late joiners (§2, 0019 item 3).
 *   During a game a joiner waits to be seated next round (0020 item 4).
 * - Reconnecting and "Rejoin as…" live in rejoin.ts (§7, 0019, 0024); this
 *   module routes `host:admit` to it.
 * - Host only: settings and start in the lobby; remove a disconnected
 *   player at any time (§7).
 * - `host:claim` while the host is disconnected (0010).
 */

import { isValidCycles, startProgress, seatRoundRoster } from '../game-length';
import type { JoinIntent, PlayerIntent, SettingsPatch } from '../protocol';
import { sendError, type Fx } from './io';
import { releaseHostHold } from './presence';
import { admit, bindAndConnect } from './rejoin';
import { startRound } from './round';
import { MAX_PLAYERS, MIN_PLAYERS, NAME_MAX_LENGTH, PLAYER_COLORS, SPY_ICONS } from './rules';
import { activeCount, findPlayer, updatePlayer, type ConnId, type Player, type PlayerId, type RoomState } from './state';

/** Trim and collapse whitespace; null when empty or longer than `NAME_MAX_LENGTH`. */
export function cleanName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  return name.length > 0 && name.length <= NAME_MAX_LENGTH ? name : null;
}

export function join(state: RoomState, conn: ConnId, intent: JoinIntent, token: string | undefined, fx: Fx): RoomState {
  if (state.players.length >= MAX_PLAYERS) return (sendError(fx, conn, 'room_full', `the room holds ${MAX_PLAYERS} agents`), state);
  const name = cleanName(intent.name);
  if (name === null) return (sendError(fx, conn, 'bad_name', `name must be 1–${NAME_MAX_LENGTH} characters`), state);
  if (!(PLAYER_COLORS as readonly string[]).includes(intent.color)) return (sendError(fx, conn, 'bad_color', 'unknown color'), state);
  // Removed players keep their color reserved (0019 item 1).
  if (state.players.some((p) => p.color === intent.color)) return (sendError(fx, conn, 'color_taken', 'that color is taken'), state);
  if (!(SPY_ICONS as readonly string[]).includes(intent.icon)) return (sendError(fx, conn, 'bad_icon', 'unknown icon'), state);
  if (!token || state.players.some((p) => p.token === token)) {
    throw new Error('join: the adapter must mint a fresh token for every join');
  }
  const id = `p${state.nextPlayerNo}`;
  const player: Player = {
    id,
    name,
    color: intent.color,
    icon: intent.icon,
    token,
    removed: false,
    score: 0,
    presence: { online: false, connected: false, graceUntil: null },
  };
  const next: RoomState = {
    ...state,
    nextPlayerNo: state.nextPlayerNo + 1,
    players: [...state.players, player],
    hostId: state.hostId ?? id,
  };
  return bindAndConnect(next, conn, id, fx);
}

function applySettings(state: RoomState, conn: ConnId, patch: SettingsPatch, fx: Fx): RoomState {
  if (state.phase.name !== 'lobby') return (sendError(fx, conn, 'wrong_phase', 'settings change in the lobby only'), state);
  const settings = { ...state.settings };
  if (patch.difficulty !== undefined) settings.difficulty = patch.difficulty;
  if (patch.custom !== undefined) settings.custom = patch.custom;
  if (patch.timers !== undefined) settings.timers = patch.timers;
  if (patch.cycles !== undefined) {
    if (!isValidCycles(patch.cycles)) return (sendError(fx, conn, 'bad_settings', 'cycles must be 1–3'), state);
    settings.cycles = patch.cycles;
  }
  if (settings.timers === 'custom' && settings.custom === null) {
    return (sendError(fx, conn, 'bad_settings', 'custom timers need values'), state);
  }
  return { ...state, settings };
}

/** host:start (§4, §7): at least 3 active players; fixes the game length (0020 item 2). */
function start(state: RoomState, conn: ConnId, now: number, fx: Fx): RoomState {
  if (state.phase.name !== 'lobby') return (sendError(fx, conn, 'wrong_phase', 'the game has started'), state);
  if (activeCount(state) < MIN_PLAYERS) {
    return (sendError(fx, conn, 'not_enough_players', `need ${MIN_PLAYERS} connected agents`), state);
  }
  const progress = startProgress(state.settings.cycles, seatRoundRoster(state.players).length);
  return startRound({ ...state, progress }, now, fx);
}

/**
 * Remove a disconnected player (§7). They keep their seat, token, color and
 * score and can return (0019); a round under way finishes as seated
 * (0019 item 4), which needs nothing here because the roster is fixed.
 */
function remove(state: RoomState, conn: ConnId, target: PlayerId, fx: Fx): RoomState {
  const p = findPlayer(state, target);
  if (!p || p.removed || p.presence.connected) {
    return (sendError(fx, conn, 'not_removable', 'only a disconnected agent can be removed'), state);
  }
  return updatePlayer(state, target, (q) => ({ ...q, removed: true }));
}

/** 0010: any connected player may take the role while the host is disconnected (after the grace). */
function claim(state: RoomState, conn: ConnId, player: PlayerId, now: number, fx: Fx): RoomState {
  const host = state.hostId === null ? undefined : findPlayer(state, state.hostId);
  if (state.hostId === player || (host && host.presence.connected)) {
    return (sendError(fx, conn, 'host_connected', 'the host is still here'), state);
  }
  // Holds and narration belong to the old host's phone, so they end with the role.
  return releaseHostHold({ ...state, hostId: player }, now);
}

const HOST_ONLY: ReadonlySet<PlayerIntent['type']> = new Set(['host:settings', 'host:start', 'host:remove', 'host:admit']);

/** Lobby and host intents; null for intents another module handles. */
export function lobbyIntent(
  state: RoomState,
  conn: ConnId,
  player: PlayerId,
  intent: PlayerIntent,
  now: number,
  fx: Fx,
): RoomState | null {
  if (HOST_ONLY.has(intent.type) && state.hostId !== player) {
    return (sendError(fx, conn, 'not_host', 'host only'), state);
  }
  switch (intent.type) {
    case 'host:settings':
      return applySettings(state, conn, intent.settings, fx);
    case 'host:start':
      return start(state, conn, now, fx);
    case 'host:remove':
      return remove(state, conn, intent.playerId, fx);
    case 'host:claim':
      return claim(state, conn, player, now, fx);
    case 'host:admit':
      return admit(state, conn, intent.playerId, intent.approve, fx);
    default:
      return null;
  }
}
