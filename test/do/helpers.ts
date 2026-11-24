/**
 * DO-leg helpers: open N WebSockets to one room, and fire a room's alarm at
 * the instant it was scheduled for.
 *
 * Storage persists across tests in a file, so each test isolates itself with
 * its own room code from `freshCode`.
 */
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { expect } from 'vitest';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../../src/shared/protocol';
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

/** A connected test player: queues every server message; waits by predicate. */
export class Socket {
  readonly received: ServerMessage[] = [];
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
