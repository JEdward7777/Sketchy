/**
 * What goes into and out of `reduce` (stage 3.3, decision 0006 item 1).
 *
 * The adapter (`RoomDO`, phase 4) turns socket frames, socket closes, the
 * alarm and the results of its own I/O into `Input`s, and performs the
 * returned `Effect`s. Every `reduce` call also takes `entropy`: a
 * fresh unsigned 32-bit value from the adapter's CSPRNG
 * (Web Crypto's `getRandomValues`), never reused and never derived from room
 * state, which the reducer folds into its generators (observation O-10). Broadcasting is not an effect: after every step the
 * adapter sends `projectPublic` to every socket and `projectPrivate` to each
 * bound socket whenever they change.
 */

import type { Difficulty } from '../difficulty-bag';
import type { WordEntry } from '../guess';
import type { GameIntent, ServerMessage } from '../protocol';
import type { WireStroke } from '../stroke-codec';
import type { ConnId, PlayerId, RoomState } from './state';

export type Input =
  /**
   * A parsed intent from one socket. `player` is the player the adapter has
   * bound the socket to (from its attachment), or null for a socket that
   * has not joined. If an overdue deadline fired in the same step binds this
   * socket (a pending "Rejoin as…" admitted when the round ended), the
   * reducer treats the input as from that player: a player intent acts as
   * them, and `join`/`rejoin`/`rejoinAs` get `already_joined`. For `join` and `rejoinAs`, the adapter supplies
   * `mintedToken`: a fresh random token from a CSPRNG, because the room RNG
   * is not cryptographic and must never be predictable from a token
   * (0020 item 5). `rejoinAs` rotates the player's token to it (0024 item 3).
   */
  | {
      readonly kind: 'intent';
      readonly conn: ConnId;
      readonly player: PlayerId | null;
      readonly intent: GameIntent;
      readonly mintedToken?: string;
    }
  /**
   * The player's first socket opened (`connected: true`) or their last one
   * closed (`false`). Joining or rejoining already marks the player online,
   * so the adapter sends this only for changes that happen without an intent.
   * `connected: true` for a removed player is ignored: a removed player
   * returns only through `rejoin`/`rejoinAs`, which clear the flag (0019).
   */
  | { readonly kind: 'presence'; readonly player: PlayerId; readonly connected: boolean }
  /**
   * A socket that is not bound to a player closed. Drops any "Rejoin as…"
   * request it was waiting on (0024), before any overdue deadline runs. The
   * adapter must deliver it before any later input, or an admission could
   * bind a socket that is gone.
   */
  | { readonly kind: 'connClosed'; readonly conn: ConnId }
  /** The alarm fired. Every input first runs whatever is due, so a tick needs no payload. */
  | { readonly kind: 'tick' }
  /**
   * The answer to a `dealWord` effect (§6, stage 5.3). `repeat`: the deck
   * had no word of the difficulty outside `exclude` and dealt a used one
   * anyway, so the round takes it instead of asking again (decision 0028).
   */
  | { readonly kind: 'wordDealt'; readonly roundNo: number; readonly entry: WordEntry; readonly repeat?: boolean }
  /** The adapter stored the strokes of a `storeDrawing` effect. */
  | { readonly kind: 'drawingStored'; readonly key: string };

export type Effect =
  /** Reply to one socket (errors). */
  | { readonly type: 'send'; readonly conn: ConnId; readonly msg: ServerMessage }
  /** This socket now belongs to this player: record it in the socket's attachment (4.1.1). */
  | { readonly type: 'bind'; readonly conn: ConnId; readonly player: PlayerId }
  /** Deal the next word of this difficulty, skipping `exclude`, and answer with `wordDealt` (§6). */
  | { readonly type: 'dealWord'; readonly roundNo: number; readonly difficulty: Difficulty; readonly exclude: readonly string[] }
  /** Store validated strokes under `key` (one row per drawing, 6.4), then answer with `drawingStored`. */
  | { readonly type: 'storeDrawing'; readonly key: string; readonly strokes: readonly WireStroke[] }
  /** Delete every stored drawing of this round (§14: drawings live for the current round only). */
  | { readonly type: 'clearDrawings'; readonly roundNo: number }
  /** The room has been inactive for `ROOM_EXPIRY_MS`: clear storage and close every socket (§14). */
  | { readonly type: 'expireRoom' };

export interface Step {
  readonly state: RoomState;
  readonly effects: readonly Effect[];
}

/** Effects collected while one input is handled. */
export type Fx = Effect[];

export function sendError(fx: Fx, conn: ConnId, code: Extract<ServerMessage, { type: 'error' }>['code'], message: string): void {
  fx.push({ type: 'send', conn, msg: { type: 'error', code, message } });
}
