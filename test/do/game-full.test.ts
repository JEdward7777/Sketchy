/**
 * Phase 7 verification, the main run (stage 7.9): 3- and 10-player games
 * from the first briefing to final results through real sockets, every
 * frame of every socket recorded and checked past unmask (the word reaches
 * nobody outside an agent's own `private` before its round resolves), and
 * every round's points checked against `SPEC.md` §5 written out again in
 * the test (`section5`). Then Play again, with scores reset and round
 * numbers continuing (0014, 0026 item 2, 0027 item 4).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { projectPublic } from '../../src/shared/core';
import { HOLD_REARM_MS, RESULTS_BEAT_MS } from '../../src/shared/core/rules';
import type { PublicState } from '../../src/shared/protocol';
import { setWordSourceForTests } from '../../src/worker/words';
import { failOnRoomErrors, fireAlarmAtScheduledTime, openSockets, pinClock, resetClock, storedRoom } from './helpers';
import { type Game, type RoundPlan, continueRound, openDisplay, dealt, expectedStandings, newGame, playRound, scriptedWords, section5, send, start, sync } from './game-helpers';
import { assertGameSecrecy, assertLogsCleanOfGame } from './game-secrecy';
import { captureConsole, drawings, privates, stateFrames } from './round-helpers';

failOnRoomErrors();

afterEach(() => {
  resetClock();
  setWordSourceForTests(null);
});

/** A rotating set of plans: exact, plural and `alt` auto-accepts (§4), judged ties and rejections (0013), a timeout. */
function planFor(r: number, n: number): RoundPlan {
  // Judges in room order; `accept(k)` for the k-th judge.
  const judgeAll = (accept: (k: number) => boolean) => (f: number) => Array.from({ length: n }, (_, i) => (i === f ? null : accept(i < f ? i : i - 1)));
  // Some rounds the agents split: half vote the faker, half the faker's target, so framing (§5) varies.
  const split = (f: number) => {
    const t = (f + 1) % n;
    return Array.from({ length: n }, (_, i) => (i === f ? t : i % 2 === 0 || i === t ? f : t));
  };
  switch (r % 6) {
    case 0:
      return { guess: (e) => e.word };
    case 1:
      return { guess: (e) => `  ${e.word.toUpperCase()}S! `, votes: split };
    case 2:
      // Judged: alternate accept and reject, so an even number of judges ties, and a tie accepts (0013 item 5).
      return { guess: () => 'periscope', judge: judgeAll((k) => k % 2 === 0), votes: split };
    case 3:
      return { guess: () => 'periscope', judge: judgeAll(() => false) };
    case 4:
      return { guess: () => null, votes: split };
    default:
      return { guess: (e) => e.alt![0]! };
  }
}

/**
 * Play every round of a game started with `cycles`, checking each round's
 * points and the running scores, then final results. Returns the final state.
 */
async function playGame(game: Game, n: number, cycles: number, firstRound: number): Promise<PublicState> {
  const scores = game.ids.map(() => 0);
  const total = cycles * n;
  for (let r = 0; r < total; r++) {
    const played = await playRound(game, planFor(r, n));
    expect(played.no).toBe(firstRound + r);
    const correct = { auto: true, judged: played.result!.accepts >= played.result!.rejects, none: false }[played.result!.verdict];
    expect(played.result!.correct).toBe(correct);
    if (r % 6 === 2) expect([played.result!.accepts, played.result!.rejects]).toEqual([Math.ceil((n - 1) / 2), Math.floor((n - 1) / 2)]);
    if (r % 6 === 3) expect(played.result).toMatchObject({ verdict: 'judged', correct: false, accepts: 0, rejects: n - 1 });
    if (r % 6 === 4) expect(played.result).toMatchObject({ verdict: 'none', correct: false });
    if (r % 6 === 0 || r % 6 === 1 || r % 6 === 5) expect(played.result).toMatchObject({ verdict: 'auto', correct: true });
    expect(played.result!.word).toBe(played.entry.word);
    const want = section5(game.ids, played.faker, played.votes, played.result!.correct);
    expect(played.result!.points).toEqual(want);
    game.ids.forEach((id, i) => (scores[i]! += want[id]!));
    expect(played.results.players.map((p) => p.score)).toEqual(scores);
    expect(played.results.progress).toEqual({ completed: r + 1, total });
    // Results → the next round on the host's continue (0004 rule 4); the last one → final results.
    const after = await continueRound(game);
    if (r + 1 < total) expect(after.round!.no).toBe(played.no + 1);
  }
  const final = game.watch.lastState();
  expect(final.phase).toEqual({ name: 'final', standings: expectedStandings(game.ids, scores) });
  return final;
}

describe('server loop B: whole games (stage 7.9)', () => {
  it('3 players, 2 cycles: every round to final results, Play again resets scores, round numbers continue', async () => {
    const logs = captureConsole();
    const game = await newGame(3, scriptedWords(40, true));
    await start(game);
    // planFor's six rounds: exact, plural, a judged 1–1 tie (2 judges), rejected, no guess, alt.
    const final = await playGame(game, 3, 2, 1);
    expect(final.progress).toEqual({ completed: 6, total: 6 });
    expect((final.phase as Extract<PublicState['phase'], { name: 'final' }>).standings.map((s) => s.place)[0]).toBe(1);

    // A duplicate Play again tap (same seq) is ignored silently (0004 rule 6, 0026 item 2).
    const host = game.sockets[0]!;
    send(game, 0, { type: 'host:next', seq: final.seq });
    send(game, 0, { type: 'host:next', seq: final.seq });
    const lobby = await sync(game, [0]);
    expect(lobby.phase.name).toBe('lobby');
    expect(lobby.seq).toBe(final.seq + 1);
    expect(host.received.filter((m) => m.type === 'error')).toEqual([]);
    expect(lobby.players.map((p) => p.score)).toEqual([0, 0, 0]);
    expect(lobby.progress).toBeNull();
    expect(lobby.round).toBeNull();

    // The next game: round numbers continue room-wide (0027 item 4), scores start from zero.
    await start(game);
    const again = await playRound(game, planFor(0, 3));
    expect(again.no).toBe(7);
    expect(again.results.players.map((p) => p.score)).toEqual(game.ids.map((id) => again.result!.points[id]));
    expect(again.results.progress).toEqual({ completed: 1, total: 6 });
    send(game, 0, { type: 'host:end' });
    expect((await sync(game, [0])).phase.name).toBe('final');

    // Every round's drawings reached every socket once, after its slideshow.
    for (const s of [...game.sockets, game.watch]) expect(drawings(s)).toHaveLength(7 * 3);
    assertGameSecrecy(game.opened, game.you.map((y) => y.token), game.truth);
    assertLogsCleanOfGame(logs.lines(), game.truth, game.ids.map((_, i) => `Agent ${i + 1}`));
    logs.stop();
  }, 30_000);

  it('10 players, 1 cycle: every round to final results with a display and a late watcher', async () => {
    const logs = captureConsole();
    const game = await newGame(10, scriptedWords(40, true));
    const display = await openDisplay(game.code);
    game.opened.push({ socket: display, id: null });
    await start(game, 1);
    const scores = await playGame(game, 10, 1, 1);
    expect(scores.progress).toEqual({ completed: 10, total: 10 });
    // A watcher opening on final results gets the last round's drawings, and no private.
    const [late] = await openSockets(game.code, 1);
    await sync({ ...game, watch: late! });
    expect(drawings(late!).map((d) => d.roundNo)).toEqual(Array(10).fill(10));
    expect(privates(late!)).toEqual([]);
    // The display saw the whole game like any watcher: every drawing, never a private.
    await sync({ ...game, watch: display });
    expect(drawings(display)).toHaveLength(10 * 10);
    expect(privates(display)).toEqual([]);
    game.opened.push({ socket: late!, id: null });
    assertGameSecrecy(game.opened, game.you.map((y) => y.token), game.truth);
    assertLogsCleanOfGame(logs.lines(), game.truth, game.ids.map((_, i) => `Agent ${i + 1}`));
    logs.stop();
  }, 60_000);

  it('a duplicate continue on round results is ignored, even one arriving in the next briefing (0004 rule 6)', async () => {
    const game = await newGame(3);
    await start(game);
    const first = await playRound(game);
    send(game, 0, { type: 'host:next', seq: first.results.seq });
    send(game, 0, { type: 'host:next', seq: first.results.seq });
    let st = await dealt(game);
    expect(st.phase.name).toBe('briefing');
    expect(st.round!.no).toBe(first.no + 1);
    // A late copy of the same tap (a slow retry) lands in the briefing: it must not start the draw.
    send(game, 0, { type: 'host:next', seq: first.results.seq });
    st = await sync(game, [0]);
    expect(st.phase.name).toBe('briefing');
    expect(st.seq).toBe(first.results.seq + 2);
    expect(game.sockets[0]!.received.filter((m) => m.type === 'error')).toEqual([]);
  });

  it('round results auto-continue on the room\'s alarm after RESULTS_BEAT_MS, a host hold pushes it, the last one opens final results (0004 rules 1, 3, 5)', async () => {
    const game = await newGame(3);
    await start(game, 1);
    for (let r = 0; r < 3; r++) {
      const played = await playRound(game, { guess: (e) => e.word });
      const phase = played.results.phase as Extract<PublicState['phase'], { name: 'results' }>;
      expect(phase.continueAt - phase.fillFrom).toBe(RESULTS_BEAT_MS);
      let due = phase.continueAt;
      if (r === 0) {
        pinClock(phase.fillFrom + 1_000);
        send(game, game.host, { type: 'host:hold' });
        const held = (await sync(game, [game.host])).phase as typeof phase;
        due = phase.fillFrom + 1_000 + HOLD_REARM_MS + RESULTS_BEAT_MS;
        expect(held.continueAt).toBe(due);
      }
      expect(await fireAlarmAtScheduledTime(game.code)).toBe(due);
      const st = r < 2 ? await dealt(game) : await sync(game);
      expect(st.phase.name).toBe(r < 2 ? 'briefing' : 'final');
    }
  });

  it('every `state` frame is exactly `projectPublic` of the stored state, at each phase (the adapter adds nothing)', async () => {
    const game = await newGame(3);
    const seen: string[] = [];
    const check = async () => {
      const st = await sync(game);
      const stored = (await storedRoom(game.code))!.state;
      expect(stateFrames(game.watch).at(-1)).toBe(JSON.stringify({ type: 'state', state: projectPublic(stored) }));
      seen.push(st.phase.name);
    };
    await check();
    await start(game);
    await dealt(game);
    await check();
    await playRound(game, { duringDraw: check, beforeVotes: check, atUnmask: check, guess: () => 'blimp', judge: () => [] });
    await check();
    expect(seen).toEqual(['lobby', 'briefing', 'draw', 'slideshow', 'unmask', 'results']);
  });
});
