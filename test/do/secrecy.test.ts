import { runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import type { PublicState, ServerMessage } from '../../src/shared/protocol';
import { DEAL_RETRY_MS, dealBackoff } from '../../src/worker/room-policy';
import { setWordSourceForTests } from '../../src/worker/words';
import {
  type Socket,
  failOnRoomErrors,
  farFuture,
  fireAlarmAtScheduledTime,
  openSockets,
  pinClock,
  resetClock,
  roomStub,
  roomWithPlayers,
  storedAlarm,
} from './helpers';

/** A word no other frame could contain by accident, so a substring search is exact. */
const SECRET = { word: 'zeppelinwhisker', category: 'Vehicles' };

failOnRoomErrors();

afterEach(() => {
  resetClock();
  setWordSourceForTests(null);
});

type Private = Extract<ServerMessage, { type: 'private' }>;

function privates(s: Socket): Private['view'][] {
  return s.received.filter((m): m is Private => m.type === 'private').map((m) => m.view);
}

function stateFrames(s: Socket): string[] {
  return s.raw.filter((r) => (JSON.parse(r) as ServerMessage).type === 'state');
}

/** Four players and an unbound observer; the host starts; everyone sees the briefing. */
async function startedGame() {
  setWordSourceForTests({ deal: async () => ({ entry: SECRET, repeat: false }) });
  const t0 = farFuture();
  pinClock(t0);
  const { code, sockets, you } = await roomWithPlayers(4);
  const [observer] = await openSockets(code, 1);
  sockets[0]!.send({ type: 'host:start' });
  for (const s of [...sockets, observer!]) await s.nextState((st) => st.phase.name === 'briefing');
  const roles = sockets.map((s) => privates(s).at(-1)!.round!.role);
  const fakerIdx = roles.indexOf('faker');
  return { t0, code, sockets, you, observer: observer!, fakerIdx };
}

/**
 * The §14 secrecy rules, checked over every frame every socket received:
 * `private` only ever for the socket's own player; the word only on agents'
 * sockets and never in `state`; the faker role only on the faker's socket;
 * no token in any `state` frame or on another player's socket; `state`
 * byte-identical everywhere.
 */
async function assertSecrecy(all: { socket: Socket; id: string | null; faker: boolean }[], tokens: string[]): Promise<void> {
  for (const { socket, id, faker } of all) {
    for (const view of privates(socket)) expect(view.you.id).toBe(id);
    for (const raw of socket.raw) {
      const msg = JSON.parse(raw) as ServerMessage;
      if (msg.type === 'state' || id === null || faker) expect(raw).not.toContain(SECRET.word);
      if (msg.type === 'state' || id === null || !faker) expect(raw).not.toContain('"faker"}');
      if (msg.type === 'state') {
        expect((msg.state as PublicState).round?.faker ?? null).toBeNull();
        for (const t of tokens) expect(raw).not.toContain(t);
      }
      const own = msg.type === 'private' ? msg.view.you.token : null;
      for (const t of tokens) if (t !== own) expect(raw).not.toContain(t);
    }
  }
  // Every socket still open ends on the very same bytes.
  const open = all.filter(({ socket }) => socket.closed === null).map(({ socket }) => socket);
  await expect.poll(() => new Set(open.map((s) => stateFrames(s).at(-1))).size).toBe(1);
}

/** Close a non-host agent's socket and fire alarms until public state shows them disconnected. */
async function dropAgent(game: Awaited<ReturnType<typeof startedGame>>): Promise<{ idx: number; target: string }> {
  const { t0, code, sockets, you, observer, fakerIdx } = game;
  // An agent who is not the host, so the host can admit them.
  const idx = [1, 2, 3].find((i) => i !== fakerIdx)!;
  sockets[idx]!.ws.close(1000, 'phone died');
  // The briefing continue fires before the grace; keep firing until the drop shows.
  for (let i = 0; i < 4 && observer.lastState().players[idx]!.connected; i++) {
    expect(await fireAlarmAtScheduledTime(code)).toBeGreaterThan(t0);
    await observer.nextState().catch(() => null);
  }
  expect(observer.lastState().players[idx]!.connected).toBe(false);
  return { idx, target: you[idx]!.id };
}

describe('secrecy through the adapter (§14, stage 4.1.3)', () => {
  it('private views, the word, the faker and tokens reach only their own socket', async () => {
    const { sockets, you, observer, fakerIdx } = await startedGame();
    expect(fakerIdx).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < sockets.length; i++) {
      const round = privates(sockets[i]!).at(-1)!.round!;
      if (i === fakerIdx) expect(round).toEqual({ no: 1, category: SECRET.category, role: 'faker' });
      else expect(round).toEqual({ no: 1, category: SECRET.category, role: 'agent', word: SECRET.word });
    }
    expect(privates(observer)).toEqual([]);
    expect(observer.lastState().round).toMatchObject({ no: 1, category: SECRET.category, faker: null });
    const all = [
      ...sockets.map((socket, i) => ({ socket, id: you[i]!.id, faker: i === fakerIdx })),
      { socket: observer, id: null, faker: false },
    ];
    await assertSecrecy(all, you.map((y) => y.token));
  });

  it('a mid-round "Rejoin as…" waits for the host and only then gets the view (0024)', async () => {
    const game = await startedGame();
    const { code, sockets, you, observer, fakerIdx } = game;
    const { idx, target } = await dropAgent(game);

    const [phone] = await openSockets(code, 1);
    phone!.send({ type: 'rejoinAs', playerId: target });
    expect(await phone!.next((m) => m.type === 'rejoin')).toEqual({ type: 'rejoin', playerId: target, status: 'pending' });
    expect((await sockets[0]!.nextState((s) => s.rejoinRequests.length === 1)).rejoinRequests).toEqual([target]);
    expect(privates(phone!)).toEqual([]);

    sockets[0]!.send({ type: 'host:admit', playerId: target, approve: true });
    const view = await phone!.nextPrivate();
    expect(view.you.id).toBe(target);
    expect(view.round).toMatchObject({ role: 'agent', word: SECRET.word });
    await observer.nextState((s) => s.rejoinRequests.length === 0 && s.players[idx]!.connected);

    const all = [
      ...sockets.map((socket, i) => ({ socket, id: you[i]!.id, faker: i === fakerIdx })),
      { socket: observer, id: null, faker: false },
      { socket: phone!, id: target, faker: false },
    ];
    await assertSecrecy(all, [...you.map((y) => y.token), view.you.token]);
  });

  it('a pending request is dropped when its socket closes (connClosed, protocol.md "Ordering")', async () => {
    const game = await startedGame();
    const { target } = await dropAgent(game);
    const [phone] = await openSockets(game.code, 1);
    phone!.send({ type: 'rejoinAs', playerId: target });
    await game.observer.nextState((s) => s.rejoinRequests.length === 1);
    phone!.ws.close(1000, 'gave up');
    await game.observer.nextState((s) => s.rejoinRequests.length === 0);
    // The host can no longer admit a socket that is gone.
    game.sockets[0]!.send({ type: 'host:admit', playerId: target, approve: true });
    expect(await game.sockets[0]!.nextError()).toBe('no_request');
  });

  it('stores a drawing per round and clears it with the round (§14)', async () => {
    const { code, sockets, observer } = await startedGame();
    sockets[0]!.send({ type: 'host:next', seq: observer.lastState().seq });
    await observer.nextState((s) => s.phase.name === 'draw');
    sockets[1]!.send({ type: 'draw:done', strokes: [{ c: 0, s: 0, p: [10, 10, 20, 20] }] });
    await observer.nextState((s) => s.round!.done.length === 1);
    const rows = () =>
      runInDurableObject(roomStub(code), (_r, state) =>
        [...state.storage.sql.exec<{ key: string; round_no: number }>('SELECT key, round_no FROM drawings')].map((r) => ({ ...r })),
      );
    expect(await rows()).toEqual([{ key: '1:p2', round_no: 1 }]);
    const stored = await runInDurableObject(roomStub(code), (_r, state) =>
      JSON.parse(state.storage.sql.exec<{ state: string }>('SELECT state FROM room').one().state).round.drawings,
    );
    expect(stored).toEqual({ p2: { key: '1:p2', stored: true } });
    sockets[0]!.send({ type: 'host:end' });
    await observer.nextState((s) => s.phase.name === 'final');
    sockets[0]!.send({ type: 'host:next', seq: observer.lastState().seq });
    await observer.nextState((s) => s.phase.name === 'lobby');
    expect(await rows()).toEqual([]);
  });
});

describe('dealing (observation O-07)', () => {
  it('a failed deal is retried from the alarm until it succeeds', async () => {
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
    await expect.poll(() => storedAlarm(code)).toBe(t0 + DEAL_RETRY_MS);
    // Still down at the first retry: the next retry is armed.
    expect(await fireAlarmAtScheduledTime(code)).toBe(t0 + DEAL_RETRY_MS);
    // Backoff: the second retry waits twice as long.
    const second = t0 + DEAL_RETRY_MS + dealBackoff(1);
    expect(dealBackoff(1)).toBe(2 * DEAL_RETRY_MS);
    expect(await storedAlarm(code)).toBe(second);
    up = true;
    expect(await fireAlarmAtScheduledTime(code)).toBe(second);
    const st = await sockets[1]!.nextState((s) => s.phase.name === 'briefing');
    expect(st.round!.category).toBe(SECRET.category);
    // The pending deal is gone: the alarm is the briefing's continue now.
    expect(await storedAlarm(code)).toBe((st.phase as { continueAt: number }).continueAt);
  });
});
