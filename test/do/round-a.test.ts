/**
 * Phase 6 verification, the main run: 3- and 10-player rooms from the
 * briefing to the end of voting through real sockets, every frame of every
 * socket recorded and checked (harness/plan/06-server-loop-a.md
 * "Verification").
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BRIEFING_BEAT_MS, DRAW_SUBMIT_GRACE_MS, HOLD_REARM_MS } from '../../src/shared/core/rules';
import { PROTOCOL_VERSION, type PublicState } from '../../src/shared/protocol';
import { TIMER_PRESETS } from '../../src/shared/timers';
import { setWordSourceForTests } from '../../src/worker/words';
import { Socket, failOnRoomErrors, fireAlarmAtScheduledTime, join, openSockets, pinClock, resetClock } from './helpers';
import {
  SECRET,
  type Recorded,
  assertLogsClean,
  assertRecordedSecrecy,
  briefingRoom,
  captureConsole,
  drawings,
  firstStateIndex,
  privates,
  strokesFor,
} from './round-helpers';

failOnRoomErrors();

afterEach(() => {
  resetClock();
  setWordSourceForTests(null);
});

/**
 * One round, briefing → vote end, with: an unbound observer; a waiting late
 * joiner when the room has a seat for one; an agent who reconnects mid-draw
 * and then submits inside the submission grace; for 10 players, an agent who
 * never submits, so the draw ends on its timer and that card goes dark.
 */
async function runRound(n: number): Promise<void> {
  const logs = captureConsole();
  const { code, sockets, you, fakerIdx } = await briefingRoom(n);
  const host = sockets[0]!;
  const [observer] = await openSockets(code, 1);
  const agents = you.map((_, i) => i).filter((i) => i !== fakerIdx && i !== 0);
  const reconnecting = agents[0]!;
  const absent = n === 10 ? agents[1]! : null;

  // A late joiner waits (§7): a private with no round, never the word.
  let late: Socket | null = null;
  let lateId: string | null = null;
  if (n < 10) {
    late = (await openSockets(code, 1))[0]!;
    lateId = (await join(late!, 'Late Agent', 'pink')).id;
    expect(privates(late!).at(-1)!.round).toBeNull();
    expect((await host.nextState((s) => s.players.length === n + 1)).round!.roster).not.toContain(lateId);
  }

  // Briefing → draw on the 0004 auto-continue.
  await fireAlarmAtScheduledTime(code);
  const draw = await observer!.nextState((s) => s.phase.name === 'draw');
  const { endsAt } = draw.phase as Extract<PublicState['phase'], { name: 'draw' }>;

  // Reconnect mid-draw by token: the private view again, no drawings.
  sockets[reconnecting]!.ws.close(1000, 'reload');
  const [again] = await openSockets(code, 1);
  again!.send({ type: 'rejoin', token: you[reconnecting]!.token });
  expect((await again!.nextPrivate()).round).toEqual({ no: 1, category: SECRET.category, role: 'agent', word: SECRET.word });
  const live = sockets.map((s, i) => (i === reconnecting ? again! : s));

  // Everyone but the reconnecting agent (and the absent one) submits in time.
  const submitters = you.map((_, i) => i).filter((i) => i !== reconnecting && i !== absent);
  for (const i of submitters) live[i]!.send({ type: 'draw:done', strokes: strokesFor(i) });
  await observer!.nextState((s) => s.round!.done.length === submitters.length);
  // A late joiner is not on the roster: refused, and not waited for.
  if (late) {
    late.send({ type: 'draw:done', strokes: strokesFor(99) });
    expect(await late.nextError()).toBe('not_in_round');
  }
  const all: Socket[] = [...sockets, again!, observer!, ...(late ? [late] : [])];
  for (const s of all) expect(drawings(s)).toEqual([]);

  // Inside the submission grace, after the countdown: still accepted (3.3.2).
  pinClock(endsAt + DRAW_SUBMIT_GRACE_MS - 1);
  again!.send({ type: 'draw:done', strokes: strokesFor(reconnecting) });
  if (absent === null) {
    // Every connected roster player is done: the slideshow starts at once.
    await observer!.nextState((s) => s.phase.name === 'slideshow');
  } else {
    await observer!.nextState((s) => s.round!.done.includes(you[reconnecting]!.id));
    for (const s of all) expect(drawings(s)).toEqual([]);
    expect(await fireAlarmAtScheduledTime(code)).toBe(endsAt + DRAW_SUBMIT_GRACE_MS);
    await observer!.nextState((s) => s.phase.name === 'slideshow');
  }

  // Each open socket gets every submitted drawing once, in card order, after the slideshow state.
  const cards = observer!.lastState().round!.cards!;
  expect([...cards].sort()).toEqual(you.map((y) => y.id).sort());
  const expected = cards
    .map((id) => you.findIndex((y) => y.id === id))
    .filter((i) => i !== absent)
    .map((i) => ({ type: 'drawing', roundNo: 1, playerId: you[i]!.id, strokes: strokesFor(i) }));
  const open = all.filter((s) => s.closed === null);
  for (const s of open) {
    await s.next((m) => m.type === 'drawing' && m.playerId === expected.at(-1)!.playerId);
    expect(drawings(s)).toEqual(expected);
    expect(s.received.findIndex((m) => m.type === 'drawing')).toBeGreaterThan(firstStateIndex(s, (st) => st.phase.name === 'slideshow'));
  }

  // Voting: the late joiner cannot vote and is not waited for.
  if (late) {
    late.send({ type: 'vote:set', targetId: cards[0]! });
    expect(await late.nextError()).toBe('not_in_round');
  }
  if (n === 10) {
    // The slideshow runs its two passes (§8), then free browse.
    const show = observer!.lastState().phase as Extract<PublicState['phase'], { name: 'slideshow' }>;
    expect(show.endsAt).toBe(show.startsAt + cards.length * 2 * show.perSlideMs);
    expect(await fireAlarmAtScheduledTime(code)).toBe(show.endsAt);
    const browse = await observer!.nextState((s) => s.phase.name === 'browse');
    expect((browse.phase as { endsAt: number }).endsAt).toBe(show.endsAt + TIMER_PRESETS.normal.voteMs);
  }
  for (const [i, y] of you.entries()) {
    live[i]!.send({ type: 'vote:set', targetId: cards.find((id) => id !== y.id)! });
    live[i]!.send({ type: 'vote:lock' });
  }
  // The last connected roster lock ends voting at once (0016).
  const unmask = await observer!.nextState((s) => s.phase.name === 'unmask');
  expect(unmask.round!.faker).toBe(you[fakerIdx]!.id);
  for (const s of open) await expect.poll(() => firstStateIndex(s, (st) => st.phase.name === 'unmask')).toBeGreaterThanOrEqual(0);

  // Nothing after the slideshow started sent the drawings a second time.
  for (const s of open) expect(drawings(s)).toHaveLength(expected.length);

  const recorded: Recorded[] = [
    ...sockets.map((socket, i) => ({ socket, id: you[i]!.id, faker: i === fakerIdx })),
    { socket: again!, id: you[reconnecting]!.id, faker: false },
    { socket: observer!, id: null, faker: false },
    ...(late ? [{ socket: late, id: lateId, faker: false }] : []),
  ];
  // The late joiner's private carries a token of its own.
  const tokens = [...you.map((y) => y.token), ...(late ? [privates(late)[0]!.you.token] : [])];
  assertRecordedSecrecy(recorded, tokens);
  // Nothing the room logged names the word or the faker before unmask.
  assertLogsClean(logs.lines(), { id: you[fakerIdx]!.id, name: `Agent ${fakerIdx + 1}` });
  logs.stop();
}

describe('server loop A: briefing to vote end (phase 6)', () => {
  it('3 players, a waiting late joiner, a reconnect and a grace submission', async () => {
    await runRound(3);
  });

  it('10 players: a timed-out draw with a dark card, slideshow, browse, lock-in end', async () => {
    await runRound(10);
  }, 20_000);

  it('the briefing (6.1, 6.2): a hold pushes the auto-continue, a tap continues at once, a duplicate tap is ignored, a reload gets its private again', async () => {
    const { code, sockets, you, fakerIdx, t0 } = await briefingRoom(3);
    const host = sockets[0]!;
    const brief = host.lastState();
    const { continueAt } = brief.phase as Extract<PublicState['phase'], { name: 'briefing' }>;
    expect(continueAt).toBe(t0 + BRIEFING_BEAT_MS);
    pinClock(t0 + 1_000);
    host.send({ type: 'host:hold' });
    const held = await host.nextState((s) => s.phase.name === 'briefing' && (s.phase as { fillFrom: number }).fillFrom > t0);
    expect((held.phase as { continueAt: number }).continueAt).toBe(t0 + 1_000 + HOLD_REARM_MS + BRIEFING_BEAT_MS);

    // A reload during the briefing: the same private view on the new socket.
    const r = [1, 2].find((i) => i !== fakerIdx)!;
    sockets[r]!.ws.close(1000, 'reload');
    const [again] = await openSockets(code, 1);
    again!.send({ type: 'rejoin', token: you[r]!.token });
    expect((await again!.nextPrivate()).round).toEqual({ no: 1, category: SECRET.category, role: 'agent', word: SECRET.word });
    const f = sockets[fakerIdx]!;
    expect(privates(f).at(-1)!.round).toEqual({ no: 1, category: SECRET.category, role: 'faker' });

    host.send({ type: 'host:next', seq: brief.seq });
    const draw = await host.nextState((s) => s.phase.name === 'draw');
    host.send({ type: 'host:next', seq: brief.seq });
    host.send({ type: 'ping', t: 2 });
    await host.next((m) => m.type === 'pong');
    expect(host.lastState()).toEqual(draw);
    expect(await fireAlarmAtScheduledTime(code)).toBe((draw.phase as { closesAt: number }).closesAt);
  });

  it('a socket opened after the slideshow started gets the drawings on hello, once', async () => {
    const { code, sockets } = await briefingRoom(3);
    await fireAlarmAtScheduledTime(code);
    await sockets[0]!.nextState((s) => s.phase.name === 'draw');
    for (const [i, s] of sockets.entries()) s.send({ type: 'draw:done', strokes: strokesFor(i) });
    await sockets[0]!.nextState((s) => s.phase.name === 'slideshow');
    const late = await Socket.connect(code);
    late.send({ type: 'hello', v: PROTOCOL_VERSION });
    await late.next((m) => m.type === 'drawing' && drawings(late).length === 3);
    // A second hello on the same socket does not send them again.
    late.send({ type: 'hello', v: PROTOCOL_VERSION });
    await late.next((m) => m.type === 'welcome');
    late.send({ type: 'ping', t: 1 });
    await late.next((m) => m.type === 'pong');
    expect(drawings(late)).toHaveLength(3);
  });
});
