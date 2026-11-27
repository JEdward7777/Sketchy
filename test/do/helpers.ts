/**
 * DO-leg helpers: open N WebSockets to one room, and fire a room's alarm at
 * the instant it was scheduled for.
 *
 * Storage persists across tests in a file, so each test isolates itself with
 * its own room code from `freshCode`.
 */
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, expect, vi, type MockInstance } from 'vitest';
import { PROTOCOL_VERSION, type ClientMessage, type PrivateView, type PublicState, type ServerMessage } from '../../src/shared/protocol';
import { setClockForTests } from '../../src/worker/clock';

export const ORIGIN = 'https://sketchy.test';

let counter = 0;
/** A room code no other test in this run uses. */
export function freshCode(): string {
  counter += 1;
  return `T${Date.now().toString(36).slice(-6)}${counter}`.toUpperCase();
}

export function roomStub(code: string): DurableObjectStub<import('../../src/worker/room-do').RoomDO> {
  return env.ROOM.getByName(code);
}

/** Create a room under a fresh code (as `POST /api/room` would) and return the code. */
export async function newRoom(): Promise<string> {
  const code = freshCode();
  expect(await roomStub(code).create(code)).toBe(true);
  return code;
}

/** A connected test player: queues every server message; waits by predicate. */
export class Socket {
  readonly received: ServerMessage[] = [];
  /** Every frame exactly as it arrived, for byte-level secrecy checks. */
  readonly raw: string[] = [];
  closed: { code: number; reason: string } | null = null;
  private queue: ServerMessage[] = [];
  private waiters: (() => void)[] = [];

  private constructor(readonly ws: WebSocket) {}

  static async connect(code: string): Promise<Socket> {
    const res = await exports.default.fetch(`${ORIGIN}/ws/${code}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    if (!ws) throw new Error('no webSocket on the 101 response');
    const socket = new Socket(ws);
    ws.addEventListener('message', (event) => {
      socket.raw.push(String(event.data));
      const msg = JSON.parse(String(event.data)) as ServerMessage;
      socket.received.push(msg);
      socket.queue.push(msg);
      socket.wake();
    });
    ws.addEventListener('close', (event) => {
      socket.closed = { code: event.code, reason: event.reason };
      socket.wake();
    });
    // The test's end of the pair; the room's end uses the hibernation API.
    ws.accept();
    return socket;
  }

  send(msg: ClientMessage | Record<string, unknown> | string): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  /** The next queued message matching `pred`, consuming everything before it. */
  async next(pred: (m: ServerMessage) => boolean = () => true, timeoutMs = 2_000): Promise<ServerMessage> {
    return this.waitFor(() => {
      const idx = this.queue.findIndex(pred);
      if (idx === -1) return undefined;
      const msg = this.queue[idx]!;
      this.queue.splice(0, idx + 1);
      return msg;
    }, timeoutMs);
  }

  /** The last `state` received so far. */
  lastState(): PublicState {
    for (let i = this.received.length - 1; i >= 0; i--) {
      const m = this.received[i]!;
      if (m.type === 'state') return m.state;
    }
    throw new Error('no state received');
  }

  /** The next `state` matching `pred`. */
  async nextState(pred: (s: PublicState) => boolean = () => true, timeoutMs = 2_000): Promise<PublicState> {
    const m = await this.next((x) => x.type === 'state' && pred(x.state), timeoutMs);
    return (m as Extract<ServerMessage, { type: 'state' }>).state;
  }

  /** The next `private` view. */
  async nextPrivate(timeoutMs = 2_000): Promise<PrivateView> {
    const m = await this.next((x) => x.type === 'private', timeoutMs);
    return (m as Extract<ServerMessage, { type: 'private' }>).view;
  }

  /** The next `error`, returning its code. */
  async nextError(timeoutMs = 2_000): Promise<string> {
    const m = await this.next((x) => x.type === 'error', timeoutMs);
    return (m as Extract<ServerMessage, { type: 'error' }>).code;
  }

  async nextClose(timeoutMs = 2_000): Promise<{ code: number; reason: string }> {
    return this.waitFor(() => this.closed ?? undefined, timeoutMs);
  }

  private wake(): void {
    for (const w of this.waiters.splice(0)) w();
  }

  private async waitFor<T>(poll: () => T | undefined, timeoutMs: number): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = poll();
      if (hit !== undefined) return hit;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting on socket');
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, remaining);
      });
    }
  }
}

/** Open `n` sockets to one room and complete the handshake on each. */
export async function openSockets(code: string, n: number): Promise<Socket[]> {
  const sockets = await Promise.all(Array.from({ length: n }, () => Socket.connect(code)));
  for (const s of sockets) s.send({ type: 'hello', v: PROTOCOL_VERSION });
  await Promise.all(sockets.map((s) => s.next((m) => m.type === 'welcome')));
  return sockets;
}

export async function storedAlarm(code: string): Promise<number | null> {
  return runInDurableObject(roomStub(code), (_instance, state) => state.storage.getAlarm());
}

/**
 * Run the room's pending alarm as if at its scheduled instant.
 *
 * `runDurableObjectAlarm` runs the handler immediately and does not move the
 * clock, so the room's injected clock is pinned to the scheduled time first.
 * Returns that time, or null if no alarm was pending. The clock stays pinned
 * until `resetClock()`.
 */
export async function fireAlarmAtScheduledTime(code: string): Promise<number | null> {
  const at = await storedAlarm(code);
  if (at === null) return null;
  setClockForTests(() => at);
  const ran = await runDurableObjectAlarm(roomStub(code));
  expect(ran).toBe(true);
  return at;
}

export function pinClock(t: number): void {
  setClockForTests(() => t);
}

export function resetClock(): void {
  setClockForTests(null);
}

/** Join as a new player on an open, helloed socket; returns the private `you`. */
export async function join(s: Socket, name: string, color: string, icon = 'fedora'): Promise<{ id: string; token: string }> {
  s.send({ type: 'join', name, color, icon });
  return (await s.nextPrivate()).you;
}

/** A created room with `n` joined players (colors from PLAYER_COLORS in order); p1 is the host. */
export async function roomWithPlayers(n: number): Promise<{ code: string; sockets: Socket[]; you: { id: string; token: string }[] }> {
  const code = await newRoom();
  const sockets = await openSockets(code, n);
  const you: { id: string; token: string }[] = [];
  // One at a time, so ids follow socket order.
  for (let i = 0; i < n; i++) you.push(await join(sockets[i]!, `Agent ${i + 1}`, COLORS[i]!));
  for (const s of sockets) await s.nextState((st) => st.players.length === n);
  return { code, sockets, you };
}

export const COLORS = ['red', 'orange', 'yellow', 'lime', 'green', 'teal', 'sky', 'blue', 'purple', 'pink'] as const;

/** An hour ahead of real time, so the runtime never fires a real alarm mid-test (verification.md). */
export function farFuture(): number {
  return Date.now() + 3_600_000;
}

/**
 * `RoomDO` catches a failed event and logs it (a hibernation handler's
 * exception would only be logged by the runtime anyway, verification.md), so
 * a reducer or adapter bug would otherwise show only as a timeout. The DO
 * runs in the tests' isolate, so a spy on `console.error` sees the log; any
 * logged room failure fails the test, except the deal failures a test
 * provokes on purpose.
 */
export function failOnRoomErrors(): void {
  let spy: MockInstance<typeof console.error>;
  beforeEach(() => {
    allowed = false;
    spy = vi.spyOn(console, 'error');
  });
  afterEach(() => {
    const failures = spy.mock.calls.filter((c) => String(c[0]).startsWith('room event failed'));
    spy.mockRestore();
    if (!allowed) expect(failures).toEqual([]);
  });
}

let allowed = false;

/** For a test that makes events fail on purpose: `failOnRoomErrors` lets this test's logged failures pass. */
export function allowRoomErrors(): void {
  allowed = true;
}

/** The room's stored reducer state and pending deal, parsed (null when the room has no row). */
export async function storedRoom(code: string): Promise<{ state: import('../../src/shared/core').RoomState; deal: unknown } | null> {
  return runInDurableObject(roomStub(code), (_r, state) => {
    const table = [...state.storage.sql.exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'room'`)];
    if (table.length === 0) return null;
    const rows = [...state.storage.sql.exec<{ state: string; deal: string | null }>('SELECT state, deal FROM room')];
    const row = rows[0];
    return row ? { state: JSON.parse(row.state), deal: row.deal && JSON.parse(row.deal) } : null;
  });
}
