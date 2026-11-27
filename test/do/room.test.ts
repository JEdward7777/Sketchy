import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { BLIP_GRACE_MS, ROOM_EXPIRY_MS } from '../../src/shared/core/rules';
import { CLOSE_NO_ROOM, CLOSE_VERSION_MISMATCH, PROTOCOL_VERSION } from '../../src/shared/protocol';
import {
  Socket,
  failOnRoomErrors,
  farFuture,
  fireAlarmAtScheduledTime,
  freshCode,
  newRoom,
  openSockets,
  pinClock,
  resetClock,
  roomStub,
  roomWithPlayers,
  storedAlarm,
} from './helpers';

failOnRoomErrors();

afterEach(() => {
  resetClock();
});


describe('RoomDO sockets (stage 1.4)', () => {
  it('accepts N sockets through the hibernation API and handshakes each', async () => {
    const code = await newRoom();
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
    const code = await newRoom();
    await openSockets(code, 1);
    await openSockets(code.toLowerCase(), 1);
    const held = await runInDurableObject(roomStub(code), (_room, state) => state.getWebSockets().length);
    expect(held).toBe(2);
  });

  it('answers a code-less client close, so the client sees its socket close (O-17)', async () => {
    const [s] = await openSockets(await newRoom(), 1);
    // No code: the room receives 1005, which may not be echoed; it answers 1000.
    s!.ws.close();
    expect((await s!.nextClose()).code).toBe(1000);
  });

  it('echoes an application close code (O-17)', async () => {
    const [s] = await openSockets(await newRoom(), 1);
    s!.ws.close(3001, 'bye');
    expect((await s!.nextClose()).code).toBe(3001);
  });

  it('answers ping with the injected clock', async () => {
    const code = await newRoom();
    const [s] = await openSockets(code, 1);
    pinClock(1_234_567);
    s!.send({ type: 'ping', t: 99 });
    expect(await s!.next((m) => m.type === 'pong')).toEqual({ type: 'pong', t: 99, serverTime: 1_234_567 });
  });

  it('refuses a mismatched protocol version and closes the socket (0007 item 8)', async () => {
    const s = await Socket.connect(await newRoom());
    s.send({ type: 'hello', v: PROTOCOL_VERSION + 1 });
    expect(await s.next()).toMatchObject({ type: 'error', code: 'version' });
    expect((await s.nextClose()).code).toBe(CLOSE_VERSION_MISMATCH);
  });

  it('ignores frames that arrive after a version-mismatch close, and keeps serving', async () => {
    const code = await newRoom();
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
      server.serializeAttachment({ conn: 'test', helloed: false, player: null });
      await room.webSocketMessage(server, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION + 1 }));
      await expect(room.webSocketMessage(server, JSON.stringify({ type: 'ping', t: 1 }))).resolves.toBeUndefined();
      await expect(room.webSocketMessage(server, 'junk')).resolves.toBeUndefined();
    });
  });

  it('answers hello with no_room and closes when the room is gone after the socket opened', async () => {
    // A room that expires while a socket is mid-handshake; a never-created
    // code is told no_room on upgrade (worker.test.ts). Driven directly, to
    // reach the hello path with no room behind it.
    const got = await runInDurableObject(roomStub(freshCode()), async (room, state) => {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      const frames: string[] = [];
      const closed = new Promise<number>((resolve) => {
        client.addEventListener('close', (e) => {
          resolve(e.code);
        });
      });
      client.addEventListener('message', (e) => frames.push(String(e.data)));
      state.acceptWebSocket(server);
      client.accept();
      server.serializeAttachment({ conn: 'test', helloed: false, player: null });
      await room.webSocketMessage(server, JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION }));
      return { code: await closed, frames, closedFlag: (server.deserializeAttachment() as { closed?: boolean }).closed };
    });
    expect(got.code).toBe(CLOSE_NO_ROOM);
    expect(got.frames.map((f) => JSON.parse(f).code)).toEqual(['no_room']);
    expect(got.closedFlag).toBe(true);
  });

  it('requires hello before anything else, and rejects junk', async () => {
    const s = await Socket.connect(await newRoom());
    s.send({ type: 'ping', t: 1 });
    expect(await s.next()).toMatchObject({ type: 'error', code: 'hello_first' });
    s.send('not json');
    expect(await s.next()).toMatchObject({ type: 'error', code: 'bad_message' });
  });

  it('remembers the handshake across eviction (state lives in the socket attachment)', async () => {
    const code = await newRoom();
    const [s] = await openSockets(code, 1);
    await evictDurableObject(roomStub(code));
    s!.send({ type: 'ping', t: 7 });
    expect(await s!.next((m) => m.type !== 'state')).toMatchObject({ type: 'pong', t: 7 });
  });
});

describe('one-alarm multiplexer over room state (stages 1.4, 4.1, 4.7)', () => {
  it('arms the alarm for the room expiry on creation', async () => {
    const t0 = farFuture();
    pinClock(t0);
    const code = await newRoom();
    expect(await storedAlarm(code)).toBe(t0 + ROOM_EXPIRY_MS);
  });

  it('multiplexes a blip grace and the expiry, earliest first, surviving eviction', async () => {
    const t0 = farFuture();
    pinClock(t0);
    const { code, sockets } = await roomWithPlayers(2);
    sockets[1]!.ws.close(1000, 'bye');
    // The close starts p2's grace: the alarm moves from the expiry to it.
    await expect.poll(() => storedAlarm(code)).toBe(t0 + BLIP_GRACE_MS);
    await evictDurableObject(roomStub(code));
    expect(await fireAlarmAtScheduledTime(code)).toBe(t0 + BLIP_GRACE_MS);
    const st = await sockets[0]!.nextState((s) => s.players[1]?.connected === false);
    expect(st.players.map((p) => p.connected)).toEqual([true, false]);
    // Back to the expiry, counted from the last activity (the close at t0).
    expect(await storedAlarm(code)).toBe(t0 + ROOM_EXPIRY_MS);
  });
});
