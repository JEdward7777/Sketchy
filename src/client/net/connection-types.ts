/**
 * Types of the room connection (connection.ts): the socket and side
 * effects it is given, and the snapshot the UI renders.
 */

import type { ClockOffset } from '../../shared/clock-offset';
import type { PrivateRound } from '../../shared/core/views';
import type { ErrorCode, PublicState } from '../../shared/protocol';
import type { Terminal } from './reconnect-policy';
import type { DrawingBuffer } from './drawing-buffer';
import type { TokenStore } from './token-store';

/** The part of `WebSocket` the connection uses. */
export interface SocketLike {
  send(data: string): void;
  /** Bytes queued by `send` and not yet handed to the network (absent on fakes: treated as 0). */
  readonly bufferedAmount?: number;
  close(code?: number, reason?: string): void;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
}

export interface ConnectionDeps {
  /** `wss://<origin>/ws/<code>`. */
  readonly url: string;
  readonly openSocket: (url: string) => SocketLike;
  readonly tokens: TokenStore;
  readonly now: () => number;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  readonly random?: () => number;
  /**
   * A big-screen display (stage 12.4, protocol.md "Display sockets"): says
   * `display: true` in its `hello`, never identifies (no token, no join)
   * and sends no intents, so it only ever receives public `state` and
   * the round's `drawing` frames.
   */
  readonly display?: boolean;
}

/**
 * - `connecting`: a socket is opening or awaiting `welcome`.
 * - `open`: `welcome` received.
 * - `waiting`: dropped; a retry is scheduled.
 * - the `Terminal` reasons: no automatic retry.
 */
export type ConnStatus = 'connecting' | 'open' | 'waiting' | Terminal;

export interface RejoinNotice {
  readonly playerId: string;
  readonly status: 'pending' | 'declined' | 'cancelled';
}

export interface GameError {
  readonly code: ErrorCode;
  /** Increments per error for the connection's life, so the UI can tell a repeat of the same code. */
  readonly n: number;
  /** Client epoch ms it arrived, so a screen that mounts just after can still show it. */
  readonly at: number;
}

export interface RoomSnapshot {
  readonly code: string;
  readonly status: ConnStatus;
  readonly state: PublicState | null;
  /** This device's player, from its last `private`. Kept across a reconnect so the lobby does not flash. */
  readonly you: { readonly id: string; readonly token: string } | null;
  readonly round: PrivateRound | null;
  /** Which identity intent is on its way and not yet answered. */
  readonly identifying: 'join' | 'rejoin' | 'rejoinAs' | null;
  /** The latest answer to a mid-round "Rejoin as…" (decision 0024). */
  readonly rejoinNotice: RejoinNotice | null;
  /**
   * The latest refused intent; cleared when an identity step succeeds, a new
   * one starts, or the phase changes (a refusal belongs to the screen it was made on).
   */
  readonly error: GameError | null;
  /**
   * This device holds a token for the room and has not been refused: while
   * the socket is re-established it will rejoin, so the UI shows "checking
   * credentials" rather than flashing the join form.
   */
  readonly resuming: boolean;
  readonly clock: ClockOffset | null;
  /** The newest round's `drawing` frames, by player (drawing-buffer.ts); phase 9 shows them. */
  readonly drawings: DrawingBuffer | null;
  /**
   * How many sockets have reached `welcome`. A screen that sent something
   * the room has not confirmed compares it to resend on a new socket (a
   * frame sent just before a drop can be lost without an error).
   */
  readonly opens: number;
}
