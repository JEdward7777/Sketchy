/**
 * `RoomDO`'s socket bookkeeping over the attachments (`./sockets`): the
 * sockets against the state, committing binds, and delivering frames. Plain
 * functions over the room's `ctx.getWebSockets()`, so `room-do.ts` stays the
 * event loop.
 */

import type { Input, RoomState } from '../shared/core';
import { CLOSE_REPLACED, type ServerMessage } from '../shared/protocol';
import { hasPlayer, privateFrame, publicFrame } from './room-policy';
import { attachmentOf, closeSocket, isLive, send, sendRaw, setAttachment } from './sockets';

/** Binds made so far in this event, not yet written to attachments: conn → player. */
export type Binds = ReadonlyMap<string, string>;

export function socketFor(sockets: readonly WebSocket[], conn: string): WebSocket | null {
  return sockets.find((ws) => attachmentOf(ws)?.conn === conn) ?? null;
}

/**
 * The sockets themselves against the state (4.1.2), at the start of every
 * event. Normally they agree, because joins and closes report changes;
 * they differ after the runtime dropped sockets without close events (a
 * restart), and then the state follows the sockets:
 * - a "Rejoin as…" request whose socket is gone is dropped (`connClosed`),
 *   before any presence input could admit it;
 * - a player is online while a live socket is bound to them.
 */
export function reconcile(sockets: readonly WebSocket[], state: RoomState, closingConn: string | null): Input[] {
  const liveConns = new Set<string>();
  const livePlayers = new Set<string>();
  for (const ws of sockets) {
    const a = attachmentOf(ws);
    if (!a || a.conn === closingConn || !isLive(ws)) continue;
    liveConns.add(a.conn);
    if (a.player) livePlayers.add(a.player);
  }
  const out: Input[] = [];
  for (const r of state.rejoinRequests) {
    if (r.conn !== closingConn && !liveConns.has(r.conn)) out.push({ kind: 'connClosed', conn: r.conn });
  }
  for (const p of state.players) {
    if (p.presence.online && !livePlayers.has(p.id)) out.push({ kind: 'presence', player: p.id, connected: false });
    else if (!p.presence.online && !p.removed && livePlayers.has(p.id)) out.push({ kind: 'presence', player: p.id, connected: true });
  }
  return out;
}

/**
 * Record committed binds in the attachments (4.1.1). A player's older live
 * socket is marked closed at once, so it stops counting toward presence,
 * and returned for closing (4.1.2).
 */
export function applyBinds(sockets: readonly WebSocket[], binds: Binds): WebSocket[] {
  const replaced: WebSocket[] = [];
  if (binds.size === 0) return replaced;
  // Only a bind to a socket that is still live replaces anything: a socket
  // that closed while its rejoin was handled must not kick the player's
  // live one (its close event reconciles presence next).
  const liveConns = new Set(sockets.filter(isLive).map((ws) => attachmentOf(ws)!.conn));
  const players = new Set([...binds].filter(([conn]) => liveConns.has(conn)).map(([, player]) => player));
  for (const ws of sockets) {
    const a = attachmentOf(ws);
    if (!a) continue;
    const bound = binds.get(a.conn);
    if (bound !== undefined) setAttachment(ws, { ...a, player: bound });
    else if (a.player !== null && players.has(a.player) && !a.closed) {
      setAttachment(ws, { ...a, closed: true });
      replaced.push(ws);
    }
  }
  return replaced;
}

/** Errors and rejoin notices, then per socket: its own view if it changed, and the public state if it changed. */
export function deliver(
  sockets: readonly WebSocket[],
  before: RoomState,
  after: RoomState,
  boundBefore: ReadonlyMap<string, string>,
  sends: readonly { conn: string; msg: ServerMessage }[],
  replaced: readonly WebSocket[],
): void {
  for (const s of sends) {
    const ws = socketFor(sockets, s.conn);
    if (ws && isLive(ws)) send(ws, s.msg);
  }
  const pub = publicFrame(after);
  const pubChanged = pub !== publicFrame(before);
  for (const ws of sockets) {
    const a = attachmentOf(ws);
    if (!a || !a.helloed || !isLive(ws)) continue;
    // The socket's own view first, so a joiner knows its id before the state that lists it.
    if (hasPlayer(after, a.player)) {
      const own = privateFrame(after, a.player);
      const prev = boundBefore.get(a.conn) === a.player ? privateFrame(before, a.player) : null;
      if (own && own !== prev) sendRaw(ws, own);
    }
    if (pubChanged) sendRaw(ws, pub);
  }
  for (const ws of replaced) {
    send(ws, { type: 'error', code: 'replaced', message: 'this agent connected from another screen' });
    closeSocket(ws, CLOSE_REPLACED, 'replaced');
  }
}
