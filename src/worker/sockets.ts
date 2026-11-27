/**
 * What `RoomDO` remembers about each socket, and how it sends.
 *
 * Everything lives in the socket's serialized attachment (at most 16,384
 * bytes, `reference/budget.md`), so it survives the room hibernating: the
 * connection id the reducer addresses it by, whether the handshake is done,
 * and which player it is bound to (stage 4.1.1). The attachment never holds
 * a token or anything secret, only ids.
 */

import type { ServerMessage } from '../shared/protocol';

export interface SocketAttachment {
  /** The reducer's `ConnId` for this socket (`mintConnId`). */
  readonly conn: string;
  readonly helloed: boolean;
  /** The player this socket is bound to (a `bind` effect), or null before joining. */
  readonly player: string | null;
  /**
   * Set before the room closes the socket (version mismatch, no such room,
   * replaced by a newer socket, expiry). Later frames are ignored, and the
   * socket no longer counts toward its player's presence.
   */
  readonly closed?: boolean;
}

export function attachmentOf(ws: WebSocket): SocketAttachment | null {
  const a = ws.deserializeAttachment() as SocketAttachment | null;
  return a && typeof a.conn === 'string' ? a : null;
}

export function setAttachment(ws: WebSocket, a: SocketAttachment): void {
  ws.serializeAttachment(a);
}

/** A socket the room still talks to: open, with an attachment, not being closed by the room. */
export function isLive(ws: WebSocket): boolean {
  const a = attachmentOf(ws);
  return a !== null && !a.closed && ws.readyState === WebSocket.OPEN;
}

/**
 * Send, never throw: a socket can close between a frame arriving and the
 * reply, and an exception escaping a hibernation handler is only logged by
 * the runtime, so the failure would be invisible.
 */
export function sendRaw(ws: WebSocket, frame: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(frame);
  } catch {
    // Closed concurrently; nothing useful to do with the reply.
  }
}

export function send(ws: WebSocket, msg: ServerMessage): void {
  sendRaw(ws, JSON.stringify(msg));
}

/** Mark the socket closed in its attachment, then close it with `code`. */
export function closeSocket(ws: WebSocket, code: number, reason: string): void {
  const a = attachmentOf(ws);
  if (a) setAttachment(ws, { ...a, closed: true });
  try {
    ws.close(code, reason);
  } catch {
    // Already closed.
  }
}
