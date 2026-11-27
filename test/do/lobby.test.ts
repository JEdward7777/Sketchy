import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { BLIP_GRACE_MS, ROOM_EXPIRY_MS } from '../../src/shared/core/rules';
import { CLOSE_NO_ROOM, CLOSE_REPLACED } from '../../src/shared/protocol';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../src/shared/room-code';
import { ROOM_CREATE_ATTEMPTS, createRoomCode } from '../../src/worker/create-room';
import {
  ORIGIN,
  failOnRoomErrors,
  farFuture,
  fireAlarmAtScheduledTime,
  freshCode,
  join,
  newRoom,
  openSockets,
  pinClock,
  resetClock,
  roomStub,
  roomWithPlayers,
  Socket,
  storedAlarm,
} from './helpers';

failOnRoomErrors();

afterEach(() => {
  resetClock();
});

describe('creating a room (stage 4.2)', () => {
  it('POST /api/room returns a fresh 4-letter code that accepts players', async () => {
    const res = await exports.default.fetch(`${ORIGIN}/api/room`, { method: 'POST' });
    expect(res.status).toBe(201);
    const { code } = (await res.json()) as { code: string };
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    for (const c of code) expect(ROOM_CODE_ALPHABET).toContain(c);
    const [s] = await openSockets(code, 1);
    expect(await s!.nextState()).toMatchObject({ code, phase: { name: 'lobby' }, players: [] });
  });

  it('answers other methods on /api/room with 405', async () => {
    const res = await exports.default.fetch(`${ORIGIN}/api/room`);
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'method_not_allowed' });
  });

  it('retries on a collision with another code (0007 item 1), and gives up after the bound', async () => {
    const taken = await newRoom();
    const free = freshCode();
    const tries = [taken, taken, free];
    expect(await createRoomCode(env.ROOM, () => tries.shift()!)).toBe(free);
    // The occupied room was left alone.
    expect(await roomStub(taken).create(taken)).toBe(false);
    let calls = 0;
    expect(await createRoomCode(env.ROOM, () => (calls++, taken))).toBeNull();
    expect(calls).toBe(ROOM_CREATE_ATTEMPTS);
  });
});

describe('joining (stages 4.1, 4.4)', () => {
  it('N sockets join one room and all see each other', async () => {
    const { sockets, you } = await roomWithPlayers(4);
    for (const s of sockets) {
      const st = s.lastState();
      expect(st.players.map((p) => p.id)).toEqual(you.map((y) => y.id));
      expect(st.players.every((p) => p.connected)).toBe(true);
      expect(st.hostId).toBe(you[0]!.id);
    }
  });

  it('refuses a duplicate color, to the sender only', async () => {
    const code = await newRoom();
    const [a, b, c] = await openSockets(code, 3);
    await join(a!, 'Ada', 'red');
    b!.send({ type: 'join', name: 'Bo', color: 'red', icon: 'fedora' });
    expect(await b!.nextError()).toBe('color_taken');
    await join(b!, 'Bo', 'blue');
    expect(c!.received.some((m) => m.type === 'error')).toBe(false);
    expect((await c!.nextState((s) => s.players.length === 2)).players.map((p) => p.color)).toEqual(['red', 'blue']);
  });

  it('a closed socket reconnects by token as the same player, without ever showing a disconnect', async () => {
    const t0 = farFuture();
    pinClock(t0);
    const { code, sockets, you } = await roomWithPlayers(3);
    sockets[2]!.ws.close(1000, 'reload');
    await expect.poll(() => storedAlarm(code)).toBe(t0 + BLIP_GRACE_MS);
    const [fresh] = await openSockets(code, 1);
    fresh!.send({ type: 'rejoin', token: you[2]!.token });
    expect((await fresh!.nextPrivate()).you).toEqual(you[2]);
    // The grace was cleared, so the alarm is back to the expiry.
    await expect.poll(() => storedAlarm(code)).toBe(t0 + ROOM_EXPIRY_MS);
    for (const s of [sockets[0]!, sockets[1]!]) {
      for (const m of s.received) if (m.type === 'state') expect(m.state.players.every((p) => p.connected)).toBe(true);
    }
  });

  it('a new socket for the same player closes the older one, and the player stays online', async () => {
    const t0 = farFuture();
    pinClock(t0);
    const { code, sockets, you } = await roomWithPlayers(2);
    const [second] = await openSockets(code, 1);
    second!.send({ type: 'rejoin', token: you[1]!.token });
    await second!.nextPrivate();
    expect(await sockets[1]!.nextError()).toBe('replaced');
    expect((await sockets[1]!.nextClose()).code).toBe(CLOSE_REPLACED);
    // The old socket's close is not a disconnect: no grace was started.
    await expect.poll(() => storedAlarm(code)).toBe(t0 + ROOM_EXPIRY_MS);
    const online = await runInDurableObject(roomStub(code), (_r, state) =>
      JSON.parse(state.storage.sql.exec<{ state: string }>('SELECT state FROM room').one().state).players.map(
        (p: { presence: { online: boolean } }) => p.presence.online,
      ),
    );
    expect(online).toEqual([true, true]);
  });

  it('tells an intent from a socket that has not joined to join first', async () => {
    const [s] = await openSockets(await newRoom(), 1);
    s!.send({ type: 'host:start' });
    expect(await s!.nextError()).toBe('join_first');
  });
});

describe('"Rejoin as…" between rounds (stage 4.5, decision 0024 item 1)', () => {
  it('offers only disconnected players, binds at once in the lobby, and rotates the token', async () => {
    const t0 = farFuture();
    pinClock(t0);
    const { code, sockets, you } = await roomWithPlayers(3);
    const [phone] = await openSockets(code, 1);
    // A connected player is not rejoinable.
    phone!.send({ type: 'rejoinAs', playerId: you[2]!.id });
    expect(await phone!.nextError()).toBe('not_rejoinable');

    sockets[2]!.ws.close(1000, 'phone died');
    expect(await fireAlarmAtScheduledTime(code)).toBe(t0 + BLIP_GRACE_MS);
    const st = await phone!.nextState((s) => s.players[2]!.connected === false);
    // The list a client offers: exactly the players with connected: false.
    expect(st.players.filter((p) => !p.connected).map((p) => p.id)).toEqual([you[2]!.id]);

    phone!.send({ type: 'rejoinAs', playerId: you[2]!.id });
    const view = await phone!.nextPrivate();
    expect(view.you.id).toBe(you[2]!.id);
    expect(view.you.token).not.toBe(you[2]!.token);
    expect((await sockets[0]!.nextState((s) => s.players[2]!.connected)).players[2]!.id).toBe(you[2]!.id);

    // The old device's token stopped working (0024 item 3).
    const [old] = await openSockets(code, 1);
    old!.send({ type: 'rejoin', token: you[2]!.token });
    expect(await old!.nextError()).toBe('unknown_token');
  });
});

describe('host settings (stage 4.6)', () => {
  it('the host changes settings for everyone; anyone else is refused', async () => {
    const { sockets } = await roomWithPlayers(3);
    sockets[1]!.send({ type: 'host:settings', settings: { cycles: 3 } });
    expect(await sockets[1]!.nextError()).toBe('not_host');
    sockets[0]!.send({ type: 'host:settings', settings: { cycles: 3, difficulty: 'abstract', timers: 'quick' } });
    for (const s of sockets) {
      const st = await s.nextState((x) => x.settings.cycles === 3);
      expect(st.settings).toMatchObject({ cycles: 3, difficulty: 'abstract', timers: 'quick' });
    }
    sockets[0]!.send({ type: 'host:settings', settings: { cycles: 4 } });
    expect(await sockets[0]!.nextError()).toBe('bad_settings');
  });
});

describe('storage is the only memory (stage 4.1)', () => {
  it('continues after eviction: players, host and tokens survive', async () => {
    const { code, sockets, you } = await roomWithPlayers(3);
    await evictDurableObject(roomStub(code));
    sockets[0]!.send({ type: 'host:settings', settings: { cycles: 1 } });
    const st = await sockets[2]!.nextState((s) => s.settings.cycles === 1);
    expect(st.players.map((p) => p.id)).toEqual(you.map((y) => y.id));
    // The bound socket still acts as its player after waking.
    sockets[1]!.send({ type: 'host:settings', settings: { cycles: 2 } });
    expect(await sockets[1]!.nextError()).toBe('not_host');
    await evictDurableObject(roomStub(code));
    const [again] = await openSockets(code, 1);
    again!.send({ type: 'rejoin', token: you[1]!.token });
    expect((await again!.nextPrivate()).you.id).toBe(you[1]!.id);
  });

  it('a player whose socket vanished without a close event goes offline on the next event', async () => {
    const t0 = farFuture();
    pinClock(t0);
    const { code, sockets, you } = await roomWithPlayers(3);
    // What a runtime restart leaves behind: state says online, no socket is bound.
    await runInDurableObject(roomStub(code), (_r, state) => {
      for (const ws of state.getWebSockets()) {
        const a = ws.deserializeAttachment() as { player: string | null };
        if (a.player === you[2]!.id) ws.serializeAttachment({ ...a, player: null });
      }
    });
    sockets[0]!.send({ type: 'host:settings', settings: { cycles: 1 } });
    await sockets[0]!.nextState((s) => s.settings.cycles === 1);
    expect(await storedAlarm(code)).toBe(t0 + BLIP_GRACE_MS);
  });
});

describe('room expiry (stage 4.7)', () => {
  it('the expiry alarm closes every socket and clears storage; the code is free again', async () => {
    const t0 = farFuture();
    pinClock(t0);
    const { code, sockets } = await roomWithPlayers(2);
    expect(await storedAlarm(code)).toBe(t0 + ROOM_EXPIRY_MS);
    expect(await fireAlarmAtScheduledTime(code)).toBe(t0 + ROOM_EXPIRY_MS);
    for (const s of sockets) {
      expect(await s.nextError()).toBe('no_room');
      expect((await s.nextClose()).code).toBe(CLOSE_NO_ROOM);
    }
    const left = await runInDurableObject(roomStub(code), async (_r, state) => ({
      tables: [...state.storage.sql.exec<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'`)].map((r) => r.name),
      alarm: await state.storage.getAlarm(),
    }));
    expect(left).toEqual({ tables: [], alarm: null });
    expect(await roomStub(code).create(code)).toBe(true);
  });

  it('an upgrade after expiry is told no_room and closed 4004, and writes nothing', async () => {
    const t0 = farFuture();
    pinClock(t0);
    const { code, sockets } = await roomWithPlayers(1);
    await fireAlarmAtScheduledTime(code);
    expect((await sockets[0]!.nextClose()).code).toBe(CLOSE_NO_ROOM);

    const late = await Socket.connect(code);
    expect(await late.nextError()).toBe('no_room');
    expect((await late.nextClose()).code).toBe(CLOSE_NO_ROOM);
    expect(late.received.map((m) => m.type)).toEqual(['error']); // no welcome, no state
    const left = await runInDurableObject(roomStub(code), async (_r, state) => ({
      tables: [...state.storage.sql.exec<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'`)].map((r) => r.name),
      alarm: await state.storage.getAlarm(),
    }));
    expect(left).toEqual({ tables: [], alarm: null });
  });

  it('activity pushes the expiry back', async () => {
    const t0 = farFuture();
    pinClock(t0);
    const { code, sockets } = await roomWithPlayers(1);
    pinClock(t0 + 60_000);
    sockets[0]!.send({ type: 'host:settings', settings: { cycles: 1 } });
    await sockets[0]!.nextState((s) => s.settings.cycles === 1);
    expect(await storedAlarm(code)).toBe(t0 + 60_000 + ROOM_EXPIRY_MS);
  });
});
