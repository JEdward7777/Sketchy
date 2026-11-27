/**
 * The one room connection (stages 4.3, 4.4, 4.5, 4.8): a single WebSocket
 * per device (protocol.md "Transport") with the handshake, automatic
 * reconnect, token rejoin, the clock probe, and a snapshot the UI renders.
 *
 * Framework-free and with every side effect injected (socket, storage,
 * timers), so the unit leg drives it with fakes; `useRoom` (room-hook.ts)
 * adapts it to React.
 */

import { estimateClockOffset, type ClockSample } from '../../shared/clock-offset';
import { PROTOCOL_VERSION, type ErrorCode, type GameIntent, type ServerMessage } from '../../shared/protocol';
import type { ConnectionDeps, GameError, RoomSnapshot, SocketLike } from './connection-types';
import {
  NUDGE_STALE_MS,
  WAKE_PROBE_MS,
  connectTimeout,
  reconnectDelay,
  terminalForClose,
  terminalForError,
  type Terminal,
} from './reconnect-policy';

export type { ConnStatus, ConnectionDeps, GameError, RejoinNotice, RoomSnapshot, SocketLike } from './connection-types';

/** Pings per connection (protocol.md "Clock probe": a few per connect, never periodic). */
export const CLOCK_PROBES = 3;
const MAX_SAMPLES = 2 * CLOCK_PROBES;
/**
 * A "Rejoin as…" re-sent after a reconnect can meet `rejoin_pending` while
 * the room has not yet seen the old socket close (after a real Wi-Fi drop
 * that can take a while), so its own old request still stands. It asks
 * again up to `REJOIN_RETRIES` times, `REJOIN_RETRY_MS` apart
 * (`REJOIN_RETRIES × REJOIN_RETRY_MS` = 15 s), before reporting it.
 */
export const REJOIN_RETRY_MS = 5_000;
export const REJOIN_RETRIES = 3;

const IDENTIFYING_ERRORS: readonly ErrorCode[] = [
  'unknown_token', 'room_full', 'bad_name', 'bad_color', 'color_taken', 'bad_icon',
  'not_rejoinable', 'rejoin_pending', 'already_joined',
];

type TimerName = 'retry' | 'connect' | 'probe' | 'rejoinRetry';

export class RoomConnection {
  private snap: RoomSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly timers = new Map<TimerName, unknown>();
  private socket: SocketLike | null = null;
  private welcomed = false;
  private stopped = false;
  private attempt = 0;
  /** When the connection was lost; null while open. Drives the backoff cap. */
  private droppedAt: number | null = null;
  private connectStartedAt = 0;
  private samples: ClockSample[] = [];
  private pingsThisSocket = 0;
  /** A mid-round "Rejoin as…" to ask again after a reconnect (the room drops a request whose socket closed). */
  private pendingRejoinAs: string | null = null;
  private rejoinResent = false;
  private rejoinRetries = 0;
  /** Never reset, even when `error` is cleared, so every error gets a new `n`. */
  private errorCount = 0;

  constructor(
    code: string,
    private readonly deps: ConnectionDeps,
  ) {
    this.snap = {
      code: code.toUpperCase(),
      status: 'connecting',
      state: null,
      you: null,
      round: null,
      identifying: null,
      rejoinNotice: null,
      error: null,
      resuming: false,
      clock: null,
    };
  }

  // ---- store interface (useSyncExternalStore) ----

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): RoomSnapshot => this.snap;

  private update(patch: Partial<RoomSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  // ---- lifecycle ----

  start(): void {
    this.stopped = false;
    this.deps.tokens.prune(this.snap.code);
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    for (const name of [...this.timers.keys()]) this.cancel(name);
    this.detach(1000);
  }

  /**
   * The page came back to the foreground or the network returned. A waiting
   * retry goes now; a socket stuck connecting is replaced; an open one is
   * probed, since a phone that slept may hold a socket that died silently.
   */
  nudge(): void {
    if (this.stopped) return;
    const { status } = this.snap;
    if (status === 'waiting') {
      this.connect();
    } else if (status === 'connecting' && this.deps.now() - this.connectStartedAt >= NUDGE_STALE_MS) {
      this.detach();
      this.connect();
    } else if (status === 'open' && this.socket && !this.timers.has('probe')) {
      this.socket.send(JSON.stringify({ type: 'ping', t: this.deps.now() }));
      this.after('probe', WAKE_PROBE_MS, () => {
        this.lost();
        this.connect();
      });
    }
  }

  /** After `replaced`: the player chose to play on this device again. Takes the seat back from the other one. */
  takeOver(): void {
    if (this.stopped || this.snap.status !== 'replaced') return;
    this.attempt = 0;
    this.connect();
  }

  /**
   * Withdraw a pending "Rejoin as…". The protocol has no cancel message: the
   * room drops a request when its socket closes, so this reconnects as a
   * fresh, unbound socket.
   */
  cancelRejoinAs(): void {
    this.pendingRejoinAs = null;
    this.cancel('rejoinRetry');
    this.update({ rejoinNotice: null, identifying: null });
    if (this.stopped || this.snap.status !== 'open') return;
    this.detach();
    this.connect();
  }

  // ---- intents ----

  /** Send an intent if the socket is open; false otherwise (the UI shows it is reconnecting). */
  send(intent: GameIntent): boolean {
    if (intent.type === 'rejoinAs' || intent.type === 'join' || intent.type === 'rejoin') this.cancel('rejoinRetry');
    if (intent.type === 'rejoinAs') {
      this.pendingRejoinAs = intent.playerId;
      this.rejoinResent = false;
      this.rejoinRetries = 0;
    } else if (intent.type === 'join' || intent.type === 'rejoin') {
      this.pendingRejoinAs = null;
    }
    return this.transmit(intent, true);
  }

  private transmit(intent: GameIntent, fresh: boolean): boolean {
    if (!this.socket || this.snap.status !== 'open') return false;
    this.socket.send(JSON.stringify(intent));
    if (intent.type === 'join' || intent.type === 'rejoin' || intent.type === 'rejoinAs') {
      this.update(fresh ? { identifying: intent.type, rejoinNotice: null, error: null } : { identifying: intent.type });
    }
    return true;
  }

  // ---- socket ----

  private connect(): void {
    this.cancel('retry');
    this.cancel('probe');
    this.welcomed = false;
    this.pingsThisSocket = 0;
    this.connectStartedAt = this.deps.now();
    this.update({ status: 'connecting', resuming: this.token() !== null });
    let socket: SocketLike;
    try {
      socket = this.deps.openSocket(this.deps.url);
    } catch {
      this.lost();
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    this.after('connect', connectTimeout(this.attempt), () => {
      this.lost();
      this.scheduleRetry();
    });
    socket.onopen = () => {
      if (this.socket === socket) socket.send(JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION }));
    };
    socket.onmessage = (ev) => {
      if (this.socket === socket && typeof ev.data === 'string') this.receive(ev.data);
    };
    socket.onerror = () => {
      // A close event always follows; it decides what to do.
    };
    socket.onclose = (ev) => {
      if (this.socket === socket) this.closed(ev.code);
    };
  }

  private receive(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;
    // Anything from the room proves the socket is alive.
    this.cancel('probe');
    switch (msg.type) {
      case 'welcome':
        this.cancel('connect');
        this.welcomed = true;
        this.attempt = 0;
        this.droppedAt = null;
        this.update({ status: 'open' });
        this.identify();
        this.ping();
        return;
      case 'pong':
        this.samples = [...this.samples, { sent: msg.t, received: this.deps.now(), serverTime: msg.serverTime }].slice(-MAX_SAMPLES);
        this.update({ clock: estimateClockOffset(this.samples) });
        this.ping();
        return;
      case 'state':
        // A refusal belongs to the screen it was made on; a new phase is a new screen.
        if (this.snap.state && this.snap.state.phase.name !== msg.state.phase.name) this.update({ state: msg.state, error: null });
        else this.update({ state: msg.state });
        return;
      case 'private':
        // A "Rejoin as…" rotates the token (0024 item 3), so always store the latest.
        this.deps.tokens.set(this.snap.code, msg.view.you.token);
        this.pendingRejoinAs = null;
        this.cancel('rejoinRetry');
        this.update({ you: msg.view.you, round: msg.view.round, identifying: null, rejoinNotice: null, error: null, resuming: false });
        return;
      case 'rejoin':
        if (msg.status !== 'pending') this.pendingRejoinAs = null;
        else this.rejoinRetries = 0;
        this.update({ identifying: null, rejoinNotice: { playerId: msg.playerId, status: msg.status } });
        return;
      case 'error':
        this.serverError(msg.code);
        return;
      default:
        return;
    }
  }

  /** After `welcome`: reconnect by stored token, or re-ask a pending "Rejoin as…". */
  private identify(): void {
    const token = this.token();
    if (token) this.transmit({ type: 'rejoin', token }, true);
    else if (this.pendingRejoinAs) {
      // A new socket: its own retry budget.
      this.rejoinRetries = 0;
      this.resendRejoinAs();
    } else if (this.snap.you) this.update({ you: null, round: null });
  }

  /** The stored token; the in-memory one covers a device whose storage refuses writes. */
  private token(): string | null {
    return this.deps.tokens.get(this.snap.code) ?? this.snap.you?.token ?? null;
  }

  private resendRejoinAs(): void {
    if (!this.pendingRejoinAs) return;
    this.rejoinResent = true;
    this.transmit({ type: 'rejoinAs', playerId: this.pendingRejoinAs }, false);
  }

  private ping(): void {
    if (!this.socket || this.pingsThisSocket >= CLOCK_PROBES) return;
    this.pingsThisSocket++;
    this.socket.send(JSON.stringify({ type: 'ping', t: this.deps.now() }));
  }

  private serverError(code: ErrorCode): void {
    const terminal = terminalForError(code);
    if (terminal) {
      this.finish(terminal);
      return;
    }
    if (code === 'rejoin_pending' && this.rejoinResent && this.rejoinRetries < REJOIN_RETRIES && this.pendingRejoinAs) {
      // Most likely our own request from the socket we just lost: keep waiting.
      this.rejoinRetries++;
      this.update({ identifying: null });
      this.after('rejoinRetry', REJOIN_RETRY_MS, () => this.resendRejoinAs());
      return;
    }
    if (code === 'unknown_token') {
      // The room no longer knows this device (another device took the seat
      // with "Rejoin as…", which rotated the token): start over as a guest.
      this.deps.tokens.clear(this.snap.code);
      this.update({ you: null, round: null, resuming: false });
    }
    const error: GameError = { code, n: ++this.errorCount, at: this.deps.now() };
    if (IDENTIFYING_ERRORS.includes(code)) {
      if (code === 'not_rejoinable' || code === 'rejoin_pending') this.pendingRejoinAs = null;
      this.update({ identifying: null, rejoinNotice: null, error });
    } else this.update({ error });
  }

  /**
   * Stop for good. The token is dropped only on an explicit `no_room` from
   * the room (protocol.md "No such room"), never on a generic failure; a
   * version mismatch keeps it so the reload reconnects as the same player.
   */
  private finish(terminal: Terminal): void {
    for (const name of [...this.timers.keys()]) this.cancel(name);
    if (terminal === 'no_room') this.deps.tokens.clear(this.snap.code);
    this.detach();
    this.update({ status: terminal, identifying: null });
  }

  private closed(closeCode: number): void {
    if (this.stopped) return;
    const terminal = terminalForClose(closeCode);
    if (terminal) {
      this.finish(terminal);
      return;
    }
    this.socket = null;
    this.lost();
    this.scheduleRetry();
  }

  /** The current socket is gone or abandoned: forget it and note when contact was lost. */
  private lost(): void {
    this.cancel('connect');
    this.cancel('probe');
    // The next socket asks again in identify(); a timer from this one must not double it.
    this.cancel('rejoinRetry');
    this.detach();
    if (this.droppedAt === null) this.droppedAt = this.deps.now();
  }

  /** Detach and close the current socket, so its late events are ignored. */
  private detach(code?: number): void {
    const s = this.socket;
    this.socket = null;
    if (!s) return;
    s.onclose = s.onmessage = s.onerror = s.onopen = null;
    try {
      s.close(code);
    } catch {
      // Already closing.
    }
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    const since = this.deps.now() - (this.droppedAt ?? this.deps.now());
    const delay = reconnectDelay(this.attempt, since, this.deps.random);
    this.attempt++;
    this.update({ status: 'waiting', identifying: null });
    this.after('retry', delay, () => this.connect());
  }

  private after(name: TimerName, ms: number, fn: () => void): void {
    this.cancel(name);
    this.timers.set(
      name,
      this.deps.setTimer(() => {
        this.timers.delete(name);
        fn();
      }, ms),
    );
  }

  private cancel(name: TimerName): void {
    if (!this.timers.has(name)) return;
    this.deps.clearTimer(this.timers.get(name));
    this.timers.delete(name);
  }
}
