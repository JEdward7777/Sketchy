/**
 * Reconnecting (§7, 0019 item 1) and "Rejoin as…" with the host's OK during
 * a round (decision 0024).
 *
 * - `rejoin {token}` with the player's current token binds at once, in any
 *   phase, and lapses any pending request for that player.
 * - `rejoinAs` between rounds (lobby, scrubbed; 3b adds round results and
 *   final results) binds at once. During a round it records a request that
 *   public state shows by player only; the requesting socket is bound, and
 *   so gets a private view, only when the host admits it (item 2).
 * - Every successful `rejoinAs` rotates the player's token to the one the
 *   adapter minted, so an earlier device's token stops working (item 3).
 *
 * Pending requests, settled after every event (`settleRejoins`):
 * - the target is connected again (by token, or a presence event): the
 *   request lapses and the requester is told `cancelled`;
 * - the requesting socket closes (`connClosed`): the request is dropped;
 * - the round ends (between rounds again) with the target still
 *   disconnected: the request becomes an immediate rejoin (item 2 "waits for
 *   the next between-rounds moment").
 */

import { sendError, type Fx } from './io';
import { goOnline, roundInProgress } from './presence';
import { findPlayer, updatePlayer, type ConnId, type PlayerId, type RejoinRequest, type RoomState } from './state';

/** Bind the socket and mark the player online; a returning removed player is reinstated (0019 item 1). */
export function bindAndConnect(state: RoomState, conn: ConnId, id: PlayerId, fx: Fx): RoomState {
  fx.push({ type: 'bind', conn, player: id });
  return goOnline(updatePlayer(state, id, (p) => (p.removed ? { ...p, removed: false } : p)), id);
}

/** Rotate the token (0024 item 3) and bind. */
function admitAs(state: RoomState, conn: ConnId, id: PlayerId, token: string, fx: Fx): RoomState {
  return bindAndConnect(updatePlayer(state, id, (p) => ({ ...p, token })), conn, id, fx);
}

function tell(fx: Fx, r: RejoinRequest, status: 'pending' | 'declined' | 'cancelled'): void {
  fx.push({ type: 'send', conn: r.conn, msg: { type: 'rejoin', playerId: r.player, status } });
}

function withoutRequest(state: RoomState, player: PlayerId): RoomState {
  return { ...state, rejoinRequests: state.rejoinRequests.filter((r) => r.player !== player) };
}

export function rejoin(state: RoomState, conn: ConnId, token: string, fx: Fx): RoomState {
  const p = state.players.find((q) => q.token === token);
  if (!p) return (sendError(fx, conn, 'unknown_token', 'no such agent in this room'), state);
  return bindAndConnect(state, conn, p.id, fx);
}

/** "Rejoin as…" (§7) offers exactly the players with `connected: false` in public state. */
export function rejoinAs(state: RoomState, conn: ConnId, id: PlayerId, token: string | undefined, fx: Fx): RoomState {
  if (!token || state.players.some((p) => p.token === token) || state.rejoinRequests.some((r) => r.token === token)) {
    throw new Error('rejoinAs: the adapter must mint a fresh token for every rejoinAs');
  }
  const p = findPlayer(state, id);
  if (!p || p.presence.connected) return (sendError(fx, conn, 'not_rejoinable', 'that agent is not disconnected'), state);
  if (!roundInProgress(state)) return admitAs(state, conn, id, token, fx);
  if (state.rejoinRequests.some((r) => r.player === id && r.conn !== conn)) {
    return (sendError(fx, conn, 'rejoin_pending', 'someone already asked to rejoin as that agent'), state);
  }
  // One request per socket: a socket that asks again (for the same player or
  // another) replaces its earlier request, with the newly minted token.
  const request: RejoinRequest = { player: id, conn, token };
  tell(fx, request, 'pending');
  return { ...state, rejoinRequests: [...state.rejoinRequests.filter((r) => r.conn !== conn), request] };
}

/** `host:admit` (0024 item 2); the dispatcher has checked the sender is the host. */
export function admit(state: RoomState, conn: ConnId, id: PlayerId, approve: boolean, fx: Fx): RoomState {
  const request = state.rejoinRequests.find((r) => r.player === id);
  if (!request) return (sendError(fx, conn, 'no_request', 'nobody is asking to rejoin as that agent'), state);
  const rest = withoutRequest(state, id);
  if (!approve) {
    tell(fx, request, 'declined');
    return rest;
  }
  return admitAs(rest, request.conn, id, request.token, fx);
}

/** An unbound socket closed: drop its request. */
export function connClosed(state: RoomState, conn: ConnId): RoomState {
  if (!state.rejoinRequests.some((r) => r.conn === conn)) return state;
  return { ...state, rejoinRequests: state.rejoinRequests.filter((r) => r.conn !== conn) };
}

/** Lapse requests whose player is back; between rounds, turn the rest into rejoins. */
export function settleRejoins(state: RoomState, fx: Fx): RoomState {
  let s = state;
  for (const r of state.rejoinRequests) {
    if (findPlayer(s, r.player)?.presence.connected) {
      tell(fx, r, 'cancelled');
      s = withoutRequest(s, r.player);
    } else if (!roundInProgress(s)) {
      s = admitAs(withoutRequest(s, r.player), r.conn, r.player, r.token, fx);
    }
  }
  return s;
}
