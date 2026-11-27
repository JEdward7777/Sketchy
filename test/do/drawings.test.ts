/**
 * Phase 6: stroke intake (6.4), drawing delivery (6.5), the faker-disconnect
 * cancel (6.8) and restart safety (6.9) through real sockets.
 */
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { DRAW_SUBMIT_GRACE_MS } from '../../src/shared/core/rules';
import { FRAME_MAX_BYTES, PROTOCOL_VERSION, utf8ByteLength, type PublicState } from '../../src/shared/protocol';
import { setWordSourceForTests } from '../../src/worker/words';
import { type Socket, failOnRoomErrors, fireAlarmAtScheduledTime, openSockets, pinClock, resetClock, roomStub } from './helpers';
import { SECRET, briefingRoom, drawings, fireUntil, firstStateIndex, privates, strokesFor } from './round-helpers';

failOnRoomErrors();

afterEach(() => {
  resetClock();
  setWordSourceForTests(null);
});

function rows(code: string): Promise<{ key: string; round_no: number; bytes: number }[]> {
  return runInDurableObject(roomStub(code), (_r, state) =>
    [...state.storage.sql.exec<{ key: string; round_no: number; bytes: number }>('SELECT key, round_no, length(strokes) AS bytes FROM drawings ORDER BY key')].map(
      (r) => ({ ...r }),
    ),
  );
}

/** A room in the draw phase, with its draw deadline. */
async function drawRoom(n: number) {
  const room = await briefingRoom(n);
  await fireAlarmAtScheduledTime(room.code);
  const st = await room.sockets[0]!.nextState((s) => s.phase.name === 'draw');
  return { ...room, endsAt: (st.phase as Extract<PublicState['phase'], { name: 'draw' }>).endsAt };
}

/** A `draw:done` frame of exactly `bytes` UTF-8 bytes holding one valid stroke (padded with JSON whitespace). */
function frameOfBytes(bytes: number): string {
  const head = '{"type":"draw:done","strokes":[{"c":1,"s":0,"p":[';
  const tail = ']}]}';
  const pairs = Math.floor((bytes - head.length - tail.length + 1) / 4);
  const body = '1,1,'.repeat(pairs).slice(0, -1);
  const frame = head + body + tail;
  return frame.replace('"strokes":', `"strokes":${' '.repeat(bytes - frame.length)}`);
}

describe('stroke intake (stage 6.4)', () => {
  it('refuses malformed strokes with bad_strokes and stores nothing', async () => {
    const { code, sockets } = await drawRoom(3);
    const bad: unknown[] = [
      'not a list',
      [{ c: 99, s: 0, p: [1, 1] }],
      [{ c: 1, s: 7, p: [1, 1] }],
      [{ c: 1, s: 0, p: [800, 1] }],
      [{ c: 1, s: 0, p: [1, 1.5] }],
      [{ c: 1, s: 0, p: [1] }],
      [{ c: 1, s: 0, p: [] }],
      [{ c: 1, s: 0, p: [1, 1], x: 1 }],
      [null],
    ];
    for (const strokes of bad) {
      sockets[1]!.send({ type: 'draw:done', strokes });
      expect(await sockets[1]!.nextError()).toBe('bad_strokes');
    }
    expect(await rows(code)).toEqual([]);
    expect(sockets[0]!.lastState().round!.done).toEqual([]);
    // The player can still submit a good drawing afterwards.
    sockets[1]!.send({ type: 'draw:done', strokes: strokesFor(1) });
    await sockets[0]!.nextState((s) => s.round!.done.length === 1);
    expect((await rows(code)).map((r) => r.key)).toEqual(['1:p2']);
  });

  it('a frame of exactly FRAME_MAX_BYTES is kept whole and delivered whole; one byte more is too_large', async () => {
    const { code, sockets, you } = await drawRoom(3);
    const over = frameOfBytes(FRAME_MAX_BYTES + 1);
    expect(utf8ByteLength(over)).toBe(FRAME_MAX_BYTES + 1);
    sockets[1]!.send(over);
    expect(await sockets[1]!.nextError(10_000)).toBe('too_large');
    expect(await rows(code)).toEqual([]);

    const max = frameOfBytes(FRAME_MAX_BYTES);
    expect(utf8ByteLength(max)).toBe(FRAME_MAX_BYTES);
    sockets[1]!.send(max);
    await sockets[0]!.nextState((s) => s.round!.done.length === 1, 10_000);
    const sent = JSON.stringify((JSON.parse(max) as { strokes: unknown }).strokes);
    // One row, the strokes as validated, no longer than the frame they came in (no chunking, budget.md).
    expect(await rows(code)).toEqual([{ key: '1:p2', round_no: 1, bytes: sent.length }]);

    sockets[0]!.send({ type: 'draw:done', strokes: strokesFor(0) });
    sockets[2]!.send({ type: 'draw:done', strokes: strokesFor(2) });
    for (const s of sockets) {
      await s.next((m) => m.type === 'drawing' && m.playerId === you[1]!.id, 10_000);
      const d = drawings(s).find((x) => x.playerId === you[1]!.id)!;
      expect(JSON.stringify(d.strokes)).toBe(sent);
    }
  }, 30_000);

  it('the submission grace: kept just before closesAt; at closesAt the draw has closed', async () => {
    const { code, sockets, you, endsAt } = await drawRoom(4);
    const closesAt = endsAt + DRAW_SUBMIT_GRACE_MS;
    sockets[0]!.send({ type: 'draw:done', strokes: strokesFor(0) });
    pinClock(closesAt - 1);
    sockets[1]!.send({ type: 'draw:done', strokes: strokesFor(1) });
    await sockets[0]!.nextState((s) => s.round!.done.length === 2);
    pinClock(closesAt);
    sockets[2]!.send({ type: 'draw:done', strokes: strokesFor(2) });
    expect(await sockets[2]!.nextError()).toBe('wrong_phase');
    await sockets[0]!.nextState((s) => s.phase.name === 'slideshow');
    expect((await rows(code)).map((r) => r.key)).toEqual(['1:p1', '1:p2']);
    for (const s of sockets) {
      await expect.poll(() => drawings(s).length).toBe(2);
      expect(drawings(s).map((d) => d.playerId).sort()).toEqual([you[0]!.id, you[1]!.id]);
    }
    await fireUntil(code, () => sockets[0]!.lastState().phase.name === 'browse');
    sockets[3]!.send({ type: 'draw:done', strokes: strokesFor(3) });
    expect(await sockets[3]!.nextError()).toBe('wrong_phase');
  });

  it('clears the round\'s drawings when the next round starts, and sends none of them in it', async () => {
    const { code, sockets } = await drawRoom(3);
    for (const [i, s] of sockets.entries()) s.send({ type: 'draw:done', strokes: strokesFor(i) });
    await sockets[0]!.nextState((s) => s.phase.name === 'slideshow');
    expect(await rows(code)).toHaveLength(3);
    // Unmask, guess (none, so wrong), round results: all on their timers.
    await fireUntil(code, () => sockets[0]!.lastState().phase.name === 'results');
    sockets[0]!.send({ type: 'host:next', seq: sockets[0]!.lastState().seq });
    await sockets[0]!.nextState((s) => s.phase.name === 'briefing' && s.round!.no === 2);
    expect(await rows(code)).toEqual([]);
    await fireAlarmAtScheduledTime(code);
    await sockets[0]!.nextState((s) => s.phase.name === 'draw');
    sockets[1]!.send({ type: 'draw:done', strokes: strokesFor(5) });
    await sockets[0]!.nextState((s) => s.round!.done.length === 1);
    expect((await rows(code)).map((r) => r.key)).toEqual(['2:p2']);
    for (const s of sockets) expect(drawings(s).every((d) => d.roundNo === 1)).toBe(true);
  });
});

describe('the faker disconnects (stage 6.8, §7)', () => {
  it('during draw: the round is scrubbed, its drawings cleared, nothing revealed, and the next round deals afresh', async () => {
    const { code, sockets, you, fakerIdx } = await drawRoom(4);
    const agent = [0, 1, 2, 3].find((i) => i !== fakerIdx)!;
    sockets[agent]!.send({ type: 'draw:done', strokes: strokesFor(agent) });
    await sockets[agent]!.nextState((s) => s.round!.done.length === 1);
    sockets[fakerIdx]!.ws.close(1000, 'phone died');
    const watcher = sockets[agent]!;
    // The grace runs out (0012 item 2), then the round is cancelled.
    await fireUntil(code, () => watcher.lastState().phase.name === 'scrubbed');
    const st = watcher.lastState();
    expect(st.round!.faker).toBeNull();
    expect(st.progress!.completed).toBe(0);
    expect(await rows(code)).toEqual([]);
    expect(watcher.lastState().players[fakerIdx]!.connected).toBe(false);
    // The scrubbed beat ends: round 2, dealt and briefed, each connected player told privately.
    await fireUntil(code, () => watcher.lastState().round!.no === 2 && watcher.lastState().phase.name === 'briefing');
    for (const [i, s] of sockets.entries()) {
      if (i === fakerIdx) continue;
      await expect.poll(() => privates(s).at(-1)!.round?.no).toBe(2);
    }
    expect(watcher.lastState().round!.roster).toContain(you[fakerIdx]!.id);
    for (const s of sockets) expect(drawings(s)).toEqual([]);
  });
});

describe('restart safety (stage 6.9)', () => {
  it('evicted in briefing, draw, slideshow and browse, the round continues from storage alone', async () => {
    const { code, sockets, you, fakerIdx } = await briefingRoom(3);
    const stub = roomStub(code);
    await evictDurableObject(stub);
    await fireAlarmAtScheduledTime(code);
    await sockets[0]!.nextState((s) => s.phase.name === 'draw');

    sockets[0]!.send({ type: 'draw:done', strokes: strokesFor(0) });
    await sockets[1]!.nextState((s) => s.round!.done.length === 1);
    await evictDurableObject(stub);
    // A reconnect after the eviction still gets its private view, and no drawings.
    const agent = [1, 2].find((i) => i !== fakerIdx)!;
    sockets[agent]!.ws.close(1000, 'reload');
    const [again] = await openSockets(code, 1);
    again!.send({ type: 'rejoin', token: you[agent]!.token });
    expect((await again!.nextPrivate()).round).toMatchObject({ role: 'agent', word: SECRET.word });
    const live = sockets.map((s, i) => (i === agent ? again! : s));
    live[1]!.send({ type: 'draw:done', strokes: strokesFor(1) });
    live[2]!.send({ type: 'draw:done', strokes: strokesFor(2) });
    await live[0]!.nextState((s) => s.phase.name === 'slideshow');
    for (const s of live) await expect.poll(() => drawings(s).length).toBe(3);

    await evictDurableObject(stub);
    // After the eviction: a new socket gets them on hello; the others are not sent them again.
    const [viewer] = await openSockets(code, 1);
    await expect.poll(() => drawings(viewer!).length).toBe(3);
    live[0]!.send({ type: 'vote:set', targetId: you[1]!.id });
    await live[1]!.nextState((s) => Object.keys(s.round!.votes).length === 1);
    await fireAlarmAtScheduledTime(code);
    await live[0]!.nextState((s) => s.phase.name === 'browse');

    await evictDurableObject(stub);
    for (const [i, s] of live.entries()) {
      s.send({ type: 'vote:set', targetId: you[(i + 1) % 3]!.id });
      s.send({ type: 'vote:lock' });
    }
    await live[0]!.nextState((s) => s.phase.name === 'unmask');
    for (const s of [...live, viewer!]) {
      await expect.poll(() => firstStateIndex(s, (st) => st.phase.name === 'unmask')).toBeGreaterThanOrEqual(0);
      expect(drawings(s)).toHaveLength(3);
    }
  });

  it('a socket that reconnects mid-draw gets no drawing frame, even after hello again', async () => {
    const { code, sockets } = await drawRoom(3);
    sockets[0]!.send({ type: 'draw:done', strokes: strokesFor(0) });
    await sockets[0]!.nextState((s) => s.round!.done.length === 1);
    const [peek] = await openSockets(code, 1);
    peek!.send({ type: 'hello', v: PROTOCOL_VERSION });
    await peek!.next((m) => m.type === 'welcome');
    await peek!.next((m) => m.type === 'state');
    expect(drawings(peek!)).toEqual([]);
    for (const raw of (peek as Socket).raw) expect(raw).not.toContain('"strokes"');
  });
});
