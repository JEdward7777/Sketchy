import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { BLIP_GRACE_MS, ROOM_EXPIRY_MS } from '../../src/shared/core/rules';
import type { ServerMessage } from '../../src/shared/protocol';
import { DEAL_RETRY_MAX_MS, FAILED_ALARM_RETRY_MS, MAX_DEALS_PER_EVENT, dealBackoff, setFaultForTests } from '../../src/worker/room-policy';
import { setWordSourceForTests } from '../../src/worker/words';
import {
  type Socket,
  allowRoomErrors,
  failOnRoomErrors,
  farFuture,
  fireAlarmAtScheduledTime,
  openSockets,
  pinClock,
  resetClock,
  roomStub,
  roomWithPlayers,
  storedAlarm,
  storedRoom,
} from './helpers';

const SECRET = { word: 'zeppelinwhisker', category: 'Vehicles' };

failOnRoomErrors();

afterEach(() => {
  resetClock();
  setWordSourceForTests(null);
  setFaultForTests(null);
});

async function briefing(n: number) {
  setWordSourceForTests({ deal: async () => ({ entry: SECRET, repeat: false }) });
  const t0 = farFuture();
  pinClock(t0);
  const room = await roomWithPlayers(n);
  room.sockets[0]!.send({ type: 'host:start' });
  for (const s of room.sockets) await s.nextState((st) => st.phase.name === 'briefing');
  return { t0, ...room };
}

/** Fire alarms until `done` holds (bounded). */
async function fireUntil(code: string, done: () => boolean, max = 6): Promise<void> {
  for (let i = 0; i < max && !done(); i++) {
    await fireAlarmAtScheduledTime(code);
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(done()).toBe(true);
}

describe('a failed event changes nothing (unit 4a review)', () => {
  it('a throw before commit leaves no drawing row, no reference, and the alarm armed', async () => {
    allowRoomErrors();
    const { code, sockets } = await briefing(3);
    sockets[0]!.send({ type: 'host:next', seq: sockets[0]!.lastState().seq });
    await sockets[0]!.nextState((s) => s.phase.name === 'draw');
    const alarm = await storedAlarm(code);
    setFaultForTests(() => {
      throw new Error('injected');
    });
    sockets[1]!.send({ type: 'draw:done', strokes: [{ c: 0, s: 0, p: [10, 10, 20, 20] }] });
    sockets[1]!.send({ type: 'ping', t: 1 });
    await sockets[1]!.next((m) => m.type === 'pong');
    const rows = await runInDurableObject(roomStub(code), (_r, state) => [...state.storage.sql.exec('SELECT key FROM drawings')].length);
    expect(rows).toBe(0);
    expect((await storedRoom(code))!.state.round!.drawings).toEqual({});
    expect(await storedAlarm(code)).toBe(alarm);
    // Healthy again: the same submission goes through.
    setFaultForTests(null);
    sockets[1]!.send({ type: 'draw:done', strokes: [{ c: 0, s: 0, p: [10, 10, 20, 20] }] });
    await sockets[0]!.nextState((s) => s.round!.done.length === 1);
  });

  it('a throw before commit binds no socket and closes no older one', async () => {
    allowRoomErrors();
    const { code, sockets, you } = await roomWithPlayers(2);
    const [second] = await openSockets(code, 1);
    setFaultForTests(() => {
      throw new Error('injected');
    });
    second!.send({ type: 'rejoin', token: you[1]!.token });
    second!.send({ type: 'ping', t: 1 });
    await second!.next((m) => m.type === 'pong');
    setFaultForTests(null);
    const attachments = await runInDurableObject(roomStub(code), (_r, state) =>
      state.getWebSockets().map((ws) => ws.deserializeAttachment() as { player: string | null; closed?: boolean }),
    );
    expect(attachments.map((a) => [a.player, a.closed ?? false]).sort((x, y) => String(x[0]).localeCompare(String(y[0])))).toEqual([
      [null, false],
      [you[0]!.id, false],
      [you[1]!.id, false],
    ]);
    expect(sockets[1]!.closed).toBeNull();
    expect(second!.received.some((m) => m.type === 'private')).toBe(false);
    // The older socket still acts as the player.
    sockets[1]!.send({ type: 'host:start' });
    expect(await sockets[1]!.nextError()).toBe('not_host');
  });

  it('a failing alarm re-arms itself, no sooner than FAILED_ALARM_RETRY_MS', async () => {
    allowRoomErrors();
    const { code, sockets } = await briefing(3);
    setFaultForTests(() => {
      throw new Error('injected');
    });
    const at = await fireAlarmAtScheduledTime(code);
    expect(await storedAlarm(code)).toBe(at! + FAILED_ALARM_RETRY_MS);
    expect((await storedRoom(code))!.state.phase.name).toBe('briefing');
    setFaultForTests(null);
    await fireAlarmAtScheduledTime(code);
    await sockets[0]!.nextState((s) => s.phase.name === 'draw');
  });
});

describe('nested events (unit 4a review round 2)', () => {
  it('a failed dealt event inside an alarm leaves the alarm at the pending retry, not pushed back', async () => {
    allowRoomErrors();
    let up = false;
    setWordSourceForTests({
      deal: async () => {
        if (!up) throw new Error('deck unavailable');
        return { entry: SECRET, repeat: false };
      },
    });
    const t0 = farFuture();
    pinClock(t0);
    const { code, sockets } = await roomWithPlayers(3);
    sockets[0]!.send({ type: 'host:start' });
    await sockets[0]!.nextState((s) => s.phase.name === 'dealing');
    up = true;
    let commits = 0;
    // The tick commits; the dealt event it starts fails at its commit.
    setFaultForTests(() => {
      if (++commits === 2) throw new Error('injected');
    });
    const at = await fireAlarmAtScheduledTime(code);
    expect(commits).toBe(2);
    expect((await storedRoom(code))!.state.phase.name).toBe('dealing');
    expect(await storedAlarm(code)).toBe(at! + dealBackoff(1));
  });

  it('a bind to a socket that closed meanwhile does not replace the live one', async () => {
    const { code, sockets, you } = await roomWithPlayers(2);
    const ran = await runInDurableObject(roomStub(code), async (room, state) => {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      state.acceptWebSocket(server);
      client.accept();
      server.serializeAttachment({ conn: 'dead', helloed: true, player: null });
      server.close(1000, 'gone');
      const open = server.readyState === WebSocket.OPEN;
      await room.webSocketMessage(server, JSON.stringify({ type: 'rejoin', token: you[1]!.token }));
      const s1 = state
        .getWebSockets()
        .filter((ws) => ws.readyState === WebSocket.OPEN)
        .map((ws) => ws.deserializeAttachment() as { player: string | null; closed?: boolean })
        .filter((a) => a.player === you[1]!.id && !a.closed);
      return { open, live: s1.length };
    });
    expect(ran.open).toBe(false);
    expect(ran.live).toBe(1);
    sockets[1]!.send({ type: 'ping', t: 1 });
    await sockets[1]!.next((m) => m.type === 'pong');
    expect(sockets[1]!.closed).toBeNull();
    expect(sockets[1]!.received.some((m) => m.type === 'error' && m.code === 'replaced')).toBe(false);
  });
});

describe('a ghost "Rejoin as…" (unit 4a review)', () => {
  it('a request whose socket vanished without a close event is dropped on the next event', async () => {
    const { code, sockets, you } = await briefing(4);
    const roles = sockets.map((s) => [...s.received].reverse().find((m): m is Extract<ServerMessage, { type: 'private' }> => m.type === 'private')!.view.round!.role);
    const idx = [1, 2, 3].find((i) => roles[i] !== 'faker')!;
    const target = you[idx]!;
    sockets[idx]!.ws.close(1000, 'phone died');
    await fireUntil(code, () => sockets[0]!.lastState().players[idx]!.connected === false);
    const [phone] = await openSockets(code, 1);
    phone!.send({ type: 'rejoinAs', playerId: target.id });
    await phone!.next((m) => m.type === 'rejoin');
    // What a restart leaves: the requester's socket is gone, with no close event.
    await runInDurableObject(roomStub(code), (_r, state) => {
      for (const ws of state.getWebSockets()) {
        const a = ws.deserializeAttachment() as { player: string | null; helloed: boolean };
        if (a.player === null && a.helloed) ws.serializeAttachment({ ...a, conn: 'gone' });
      }
    });
    await evictDurableObject(roomStub(code));
    sockets[0]!.send({ type: 'host:end' });
    await sockets[0]!.nextState((s) => s.phase.name === 'final');
    const st = (await storedRoom(code))!.state;
    expect(st.rejoinRequests).toEqual([]);
    expect(st.players[idx]!.token).toBe(target.token);
    expect(st.players[idx]!.presence.connected).toBe(false);
  });
});

describe('a deal that never succeeds (unit 4a review, O-11)', () => {
  it('backs off to DEAL_RETRY_MAX_MS and the room still expires ROOM_EXPIRY_MS after the last player action', async () => {
    setWordSourceForTests({
      deal: async () => {
        throw new Error('deck unavailable');
      },
    });
    const t0 = farFuture();
    pinClock(t0);
    const { code, sockets } = await roomWithPlayers(3);
    sockets[0]!.send({ type: 'host:start' });
    await sockets[0]!.nextState((s) => s.phase.name === 'dealing');
    // The first player-free alarm after the host's tap is a deal retry.
    let fired = 0;
    let lastGap = 0;
    let prev = t0;
    while (sockets[0]!.closed === null && fired < 100) {
      const at = await fireAlarmAtScheduledTime(code);
      if (at === null) break;
      lastGap = at - prev;
      prev = at;
      fired++;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(prev).toBe(t0 + ROOM_EXPIRY_MS);
    expect(lastGap).toBeLessThanOrEqual(DEAL_RETRY_MAX_MS);
    // 2 h at the 5 min cap plus the doubling ramp: a few dozen alarms, not thousands.
    expect(fired).toBeLessThan(ROOM_EXPIRY_MS / DEAL_RETRY_MAX_MS + 12);
    expect((await sockets[0]!.nextClose()).code).toBe(4004);
    expect(await storedRoom(code)).toBeNull();
  });
});

describe('a source that keeps dealing used words (§6, unit 4a review)', () => {
  it('calls the source at most MAX_DEALS_PER_EVENT times per event and keeps counting attempts', async () => {
    const { code, sockets } = await briefing(4);
    let calls = 0;
    // Always the round-1 word, which is now used.
    setWordSourceForTests({ deal: async () => (calls++, { entry: SECRET, repeat: false }) });
    const roles = sockets.map((s) => [...s.received].reverse().find((m): m is Extract<ServerMessage, { type: 'private' }> => m.type === 'private')!.view.round!.role);
    const faker = roles.indexOf('faker');
    sockets[faker]!.ws.close(1000, 'faker left');
    const watcher = sockets[(faker + 1) % sockets.length]!;
    await fireUntil(code, () => watcher.lastState().phase.name === 'scrubbed');
    calls = 0;
    const at = await fireAlarmAtScheduledTime(code);
    await watcher.nextState((s) => s.phase.name === 'dealing');
    await expect.poll(async () => ((await storedRoom(code))!.deal as { attempts: number } | null)?.attempts).toBe(MAX_DEALS_PER_EVENT);
    expect(calls).toBe(MAX_DEALS_PER_EVENT);
    expect(await storedAlarm(code)).toBe(at! + dealBackoff(MAX_DEALS_PER_EVENT));
    // The next retry asks twice more and backs off further.
    calls = 0;
    const at2 = await fireAlarmAtScheduledTime(code);
    await expect.poll(async () => ((await storedRoom(code))!.deal as { attempts: number }).attempts).toBe(2 * MAX_DEALS_PER_EVENT + 1);
    expect(calls).toBe(MAX_DEALS_PER_EVENT);
    expect(await storedAlarm(code)).toBe(at2! + dealBackoff(2 * MAX_DEALS_PER_EVENT + 1));
  });
});

describe('the faker and an agent get the same frame sequence (unit 4a review)', () => {
  it('from dealing through round results, the frame kinds match socket for socket', async () => {
    const { code, sockets, you } = await briefing(5);
    const obs: Socket = sockets[0]!;
    obs.send({ type: 'host:next', seq: obs.lastState().seq });
    await obs.nextState((s) => s.phase.name === 'draw');
    for (const s of sockets) s.send({ type: 'draw:done', strokes: [{ c: 0, s: 0, p: [1, 1, 2, 2] }] });
    await obs.nextState((s) => s.phase.name === 'slideshow');
    // Every player votes for the next one and locks: symmetric, whoever the faker is.
    sockets.forEach((s, i) => {
      s.send({ type: 'vote:set', targetId: you[(i + 1) % you.length]!.id });
      s.send({ type: 'vote:lock' });
    });
    await obs.nextState((s) => s.phase.name === 'unmask');
    // Unmask, then the guess times out (nobody guesses): results.
    await fireUntil(code, () => obs.lastState().phase.name === 'results');
    await new Promise((r) => setTimeout(r, 50));
    // From the round's start on, every socket, the faker's included, sees the same kinds in the same order.
    const shape = (s: Socket) => {
      const kinds = s.raw.map((r) => {
        const m = JSON.parse(r) as ServerMessage;
        return m.type === 'state' ? `state:${m.state.phase.name}` : m.type;
      });
      const start = kinds.indexOf('state:dealing');
      expect(start).toBeGreaterThanOrEqual(0);
      return kinds.slice(start).join(',');
    };
    const roles = sockets.map((s) => s.received.find((m): m is Extract<ServerMessage, { type: 'private' }> => m.type === 'private' && m.view.round !== null)!.view.round!.role);
    expect(roles.filter((r) => r === 'faker')).toHaveLength(1);
    const shapes = sockets.map(shape);
    expect(shapes[0]).toContain('state:results');
    for (const sh of shapes) expect(sh).toBe(shapes[0]);
    expect(sockets.every((s) => s.received.every((m) => m.type !== 'error'))).toBe(true);
  });
});
