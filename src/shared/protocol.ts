/**
 * Wire protocol shared by the client and `RoomDO`. Reference:
 * `harness/reference/protocol.md`.
 *
 * Every frame is one JSON object with a string `type`; the remaining fields
 * belong to that type. Phase 1 defines only the handshake and clock probe;
 * the game messages (`state`, `private`, intents) arrive with the reducer.
 */

/**
 * Bump on any incompatible change to a message shape. A mismatched client is
 * told `error {code: "version"}` and disconnected (decision 0007 item 8), so a
 * deploy mid-evening fails loudly instead of desyncing.
 */
export const PROTOCOL_VERSION = 1;

/** Close code sent with a version mismatch (4000–4999 is application-defined). */
export const CLOSE_VERSION_MISMATCH = 4000;

export type ClientMessage =
  | { type: 'hello'; v: number }
  | { type: 'ping'; t: number };

export type ErrorCode = 'version' | 'bad_message' | 'hello_first';

export type ServerMessage =
  | { type: 'welcome'; v: number; serverTime: number }
  | { type: 'pong'; t: number; serverTime: number }
  | { type: 'error'; code: ErrorCode; message: string };

/**
 * Parse one inbound frame into a `ClientMessage`, or null if it is not one.
 * Structural checks only; nothing here trusts the sender.
 */
export function parseClientMessage(raw: string | ArrayBuffer): ClientMessage | null {
  if (typeof raw !== 'string') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const msg = value as Record<string, unknown>;
  switch (msg.type) {
    case 'hello':
      return Number.isInteger(msg.v) ? { type: 'hello', v: msg.v as number } : null;
    case 'ping':
      return Number.isFinite(msg.t) ? { type: 'ping', t: msg.t as number } : null;
    default:
      return null;
  }
}
