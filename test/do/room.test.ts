import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { CLOSE_VERSION_MISMATCH, PROTOCOL_VERSION } from '../../src/shared/protocol';
import {
  Socket,
  fireAlarmAtScheduledTime,
  freshCode,
  openSockets,
  pinClock,
  resetClock,
  roomStub,
  storedAlarm,
} from './helpers';

afterEach(() => {
  resetClock();
});

async function deadlineNames(code: string): Promise<string[]> {
  return runInDurableObject(roomStub(code), (room) => room.storedDeadlines().map((d) => d.name));
}

describe('RoomDO sockets (stage 1.4)', () => {
  it('accepts N sockets through the hibernation API and handshakes each', async () => {
    const code = freshCode();
    const N = 5;
    const sockets = await openSockets(code, N);
    // ctx.getWebSockets() lists only sockets accepted with ctx.acceptWebSocket().
    const held = await runInDurableObject(roomStub(code), (_room, state) => state.getWebSockets().length);
    expect(held).toBe(N);
    for (const s of sockets) {
      expect(s.received[0]).toMatchObject({ type: 'welcome', v: PROTOCOL_VERSION });
    }
  });

  it('treats room codes case-insensitively: /ws/abcd reaches the ABCD room', async () => {
    const code = freshCode();
    await openSockets(code, 1);
    await openSockets(code.toLowerCase(), 1);
    const held = await runInDurableObject(roomStub(code), (_room, state) => state.getWebSockets().length);
    expect(held).toBe(2);
  });

  it('answers ping with the injected clock', async () => {
    const code = freshCode();
    const [s] = await openSockets(code, 1);
    pinClock(1_234_567);
    s!.send({ type: 'ping', t: 99 });
    expect(await s!.next((m) => m.type === 'pong')).toEqual({ type: 'pong', t: 99, serverTime: 1_234_567 });
  });

  it('refuses a mismatched protocol version and closes the socket (0007 item 8)', async () => {
    const s = await Socket.connect(freshCode());
    s.send({ type: 'hello', v: PROTOCOL_VERSION + 1 });
    expect(await s.next()).toMatchObject({ type: 'error', code: 'version' });
    expect((await s.nextClose()).code).toBe(CLOSE_VERSION_MISMATCH);
  });

  it('ignores frames that arrive after a version-mismatch close, and keeps serving', async () => {
    const code = freshCode();
    const s = await Socket.connect(code);
    // One burst: the pings are in flight before the client can see the close.
    s.send({ type: 'hello', v: PROTOCOL_VERSION + 1 });
    s.send({ type: 'ping', t: 1 });
    s.send({ type: 'ping', t: 2 });
    expect((await s.nextClose()).code).toBe(CLOSE_VERSION_MISMATCH);
    expect(s.received.map((m) => m.type)).toEqual(['error']);
    const [fresh] = await openSockets(code, 1);
    fresh!.send({ type: 'ping', t: 3 });
    expect(await fresh!.next((m) => m.type === 'pong')).toMatchObject({ t: 3 });
  });

  it('handler calls never throw for frames after a close', async () => {
    // The runtime only logs an exception thrown by a hibernation handler and
    // vitest still passes, so call the handler directly where a throw fails
    // the test.
    await runInDurableObject(roomStub(freshCode()), async (room, state) => {
      const pair = new WebSocketPair();
      const server = pair[1];
      state.acceptWebSocket(server);
      server.serializeAttachment({ helloed: false });
      await room.webSocketMessage(server, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION + 1 }));
      await expect(room.webSocketMessage(server, JSON.stringify({ type: 'ping', t: 1 }))).resolves.toBeUndefined();
      await expect(room.webSocketMessage(server, 'junk')).resolves.toBeUndefined();
    });
  });

  it('requires hello before anything else, and rejects junk', async () => {
    const s = await Socket.connect(freshCode());
    s.send({ type: 'ping', t: 1 });
    expect(await s.next()).toMatchObject({ type: 'error', code: 'hello_first' });
    s.send('not json');
    expect(await s.next()).toMatchObject({ type: 'error', code: 'bad_message' });
  });

  it('remembers the handshake across eviction (state lives in the socket attachment)', async () => {
    const code = freshCode();
    const [s] = await openSockets(code, 1);
    await evictDurableObject(roomStub(code));
    s!.send({ type: 'ping', t: 7 });
    expect(await s!.next()).toMatchObject({ type: 'pong', t: 7 });
  });
});

describe('one-alarm multiplexer (stage 1.4)', () => {
  it('fires two deadlines in order from the one alarm, surviving eviction between them', async () => {
    const code = freshCode();
    const stub = roomStub(code);
    // Far enough ahead that the runtime will not fire the real alarm mid-test.
    const t0 = Date.now() + 3_600_000;
    const first = t0 + 1_000;
    const second = t0 + 5_000;

    await runInDurableObject(stub, (room) => room.replaceDeadlines({ late: second, early: first }));
    expect(await storedAlarm(code)).toBe(first);

    // Nothing about time is in memory: drop the instance before each firing.
    await evictDurableObject(stub);
    expect(await fireAlarmAtScheduledTime(code)).toBe(first);
    expect(await deadlineNames(code)).toEqual(['late']);
    expect(await storedAlarm(code)).toBe(second);

    await evictDurableObject(stub);
    expect(await fireAlarmAtScheduledTime(code)).toBe(second);
    expect(await deadlineNames(code)).toEqual([]);
    expect(await storedAlarm(code)).toBeNull();
  });

  it('fires every deadline already due in a single run', async () => {
    const code = freshCode();
    const t0 = Date.now() + 3_600_000;
    await runInDurableObject(roomStub(code), (room) =>
      room.replaceDeadlines({ a: t0 + 1_000, b: t0 + 1_000, c: t0 + 9_000 }),
    );
    expect(await fireAlarmAtScheduledTime(code)).toBe(t0 + 1_000);
    expect(await deadlineNames(code)).toEqual(['c']);
    expect(await storedAlarm(code)).toBe(t0 + 9_000);
  });

  it('clears the alarm when there are no deadlines', async () => {
    const code = freshCode();
    const stub = roomStub(code);
    await runInDurableObject(stub, (room) => room.replaceDeadlines({ a: Date.now() + 3_600_000 }));
    expect(await storedAlarm(code)).not.toBeNull();
    await runInDurableObject(stub, (room) => room.replaceDeadlines({}));
    expect(await storedAlarm(code)).toBeNull();
  });
});
