/**
 * Stage 7.8 through real sockets (stage 7.9): removal and return (0019),
 * pause and resume (0011), no pause from unmask on (0027), host claim
 * (0010) and `host:end` (0026 item 3), each with the frame recording
 * checked past unmask.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { RESTART_WAIT_MS } from '../../src/shared/core/rules';
import { setWordSourceForTests } from '../../src/worker/words';
import { failOnRoomErrors, pinClock, resetClock, storedAlarm } from './helpers';
import { type Game, close, continueRound, dealt, drop, fireUntil, joinLate, newGame, playRound, rejoin, send, start, sync } from './game-helpers';
import { assertGameSecrecy } from './game-secrecy';
import { privates } from './round-helpers';

failOnRoomErrors();

afterEach(() => {
  resetClock();
  setWordSourceForTests(null);
});

const agentsOf = (n: number, faker: number) => Array.from({ length: n }, (_, i) => i).filter((i) => i !== faker);

function secrecy(game: Game): void {
  assertGameSecrecy(game.opened, game.you.map((y) => y.token), game.truth);
}

describe('fairness through sockets (stages 7.8, 7.9)', () => {
  it('removal: only a disconnected player; the round finishes as seated; they return to their seat from the next round, as a late joiner is seated (0019, 0020 item 4)', async () => {
    const game = await newGame(4);
    await start(game);
    let x = -1;
    let late = -1;
    const first = await playRound(game, {
      duringDraw: async (f) => {
        x = agentsOf(4, f).find((i) => i !== game.host)!;
        send(game, game.host, { type: 'host:remove', playerId: game.ids[x]! });
        expect(await game.sockets[game.host]!.nextError()).toBe('not_removable');
        await drop(game, x);
        send(game, game.host, { type: 'host:remove', playerId: game.ids[x]! });
        const st = await sync(game, [game.host]);
        expect(st.players[x]).toMatchObject({ removed: true, connected: false });
        // The round goes on as seated (0019 item 4); the faker is unaffected, no pause (3 active).
        expect(st.round!.roster).toContain(game.ids[x]);
        expect(st.paused).toBeNull();
      },
    });
    // Removed before the slideshow: no card, so no target (0007 item 7, 0019 item 5); absent, so 0 points.
    expect(first.results.round!.cards).not.toContain(game.ids[x]);
    expect(first.result!.points[game.ids[x]!]).toBe(0);
    const scoreOfX = first.results.players[x]!.score;

    await continueRound(game);
    const second = await playRound(game, {
      duringDraw: async () => {
        // Back by token mid-round: same seat and score, waiting until the next round (0019 items 1–2).
        const view = await rejoin(game, x);
        expect(view.you.id).toBe(game.ids[x]);
        expect(view.round).toBeNull();
        const st = await sync(game, [x]);
        expect(st.players[x]).toMatchObject({ removed: false, connected: true, seated: false, score: scoreOfX });
        expect(st.round!.roster).not.toContain(game.ids[x]);
        // A late joiner waits the same way: no round view, not seated.
        late = await joinLate(game, 'Late Agent', 'pink');
        expect(privates(game.sockets[late]!).at(-1)!.round).toBeNull();
        expect((await sync(game)).players[late]!.seated).toBe(false);
      },
    });
    expect(second.results.round!.roster).not.toContain(game.ids[x]);
    expect(Object.keys(second.result!.points)).not.toContain(game.ids[x]);

    await continueRound(game);
    const third = await playRound(game);
    expect(third.results.round!.roster).toEqual(game.ids);
    expect(third.results.players[x]!.seated).toBe(true);
    expect(third.results.players[late]!.seated).toBe(true);
    // Late joiners do not change the game length (0020 item 2): 2 cycles × 4 at the start.
    expect(third.results.progress).toEqual({ completed: 3, total: 8 });
    secrecy(game);
  });

  it('pause below 3 freezes the draw; a return resumes it with every deadline shifted by the pause (0011)', async () => {
    const game = await newGame(3);
    await start(game);
    const played = await playRound(game, {
      duringDraw: async (f) => {
        const x = agentsOf(3, f).find((i) => i !== game.host)!;
        const draw = game.watch.lastState().phase as { endsAt: number; closesAt: number };
        const paused = await drop(game, x);
        const since = paused.paused!.since;
        expect(paused.phase).toMatchObject({ name: 'draw', endsAt: draw.endsAt, closesAt: draw.closesAt });
        // Frozen: the draw's deadline is not armed; the 0025 restart check is next.
        expect(await storedAlarm(game.code)).toBe(since + RESTART_WAIT_MS);
        pinClock(since + 20_000);
        await rejoin(game, x);
        const resumed = await sync(game, [x]);
        expect(resumed.paused).toBeNull();
        expect(resumed.phase).toMatchObject({ name: 'draw', endsAt: draw.endsAt + 20_000, closesAt: draw.closesAt + 20_000 });
        expect(await storedAlarm(game.code)).toBe(draw.closesAt + 20_000);
      },
    });
    expect(played.result).not.toBeNull();
    secrecy(game);
  });

  it('no pause from unmask on: a faker who drops at unmask still has the guess timer, no guess is wrong, and the pause waits for round results (0027, 0012 item 1)', async () => {
    const game = await newGame(3);
    await start(game);
    const played = await playRound(game, {
      atUnmask: async (f) => {
        const st = await drop(game, f);
        expect(st.phase.name).toBe('guess');
        expect(st.paused).toBeNull();
      },
    });
    expect(played.result).toMatchObject({ verdict: 'none', correct: false });
    // Two active players at round results: the pause starts there.
    expect(played.results.paused).not.toBeNull();
    if (played.faker === game.host) {
      // The faker was the host: someone claims the role (0010), which works while paused.
      game.host = agentsOf(3, played.faker)[0]!;
      send(game, game.host, { type: 'host:claim' });
      expect((await sync(game, [game.host])).hostId).toBe(game.ids[game.host]);
    }
    // A paused continue is refused; host:end still works and lifts the pause (0011 item 3).
    send(game, game.host, { type: 'host:next', seq: played.results.seq });
    expect(await game.sockets[game.host]!.nextError()).toBe('paused');
    send(game, game.host, { type: 'host:end' });
    const final = await sync(game, [game.host]);
    expect(final.phase.name).toBe('final');
    expect(final.paused).toBeNull();
    secrecy(game);
  });

  it('host claim: refused while the host is connected or in their grace; the first claim wins; the old host returns as a player (0010)', async () => {
    const game = await newGame(3);
    await close(game, 0);
    send(game, 1, { type: 'host:claim' });
    expect(await game.sockets[1]!.nextError()).toBe('host_connected');
    await fireUntil(game, (s) => !s.players[0]!.connected);
    send(game, 1, { type: 'host:claim' });
    send(game, 2, { type: 'host:claim' });
    expect(await game.sockets[2]!.nextError()).toBe('host_connected');
    expect((await sync(game, [1, 2])).hostId).toBe(game.ids[1]);
    await rejoin(game, 0);
    send(game, 0, { type: 'host:start' });
    expect(await game.sockets[0]!.nextError()).toBe('not_host');
    expect((await sync(game, [0])).hostId).toBe(game.ids[1]);
    game.host = 1;
    await start(game);
    const played = await playRound(game);
    expect(played.result).not.toBeNull();
    secrecy(game);
  });

  it('host:end mid-guess reveals no word and scores nothing; before unmask it reveals no faker (0026 item 3)', async () => {
    const game = await newGame(4);
    await start(game);
    const first = await playRound(game, { guess: (e) => e.word });
    const scores = first.results.players.map((p) => p.score);
    await continueRound(game);
    // Ended in the guess: the faker is public, the word is not, and the round scores nothing.
    const second = await playRound(game, { stopAt: 'guess' });
    send(game, game.host, { type: 'host:end' });
    const final = await sync(game, [game.host]);
    expect(final.phase.name).toBe('final');
    expect(final.round).toMatchObject({ no: second.no, faker: game.ids[second.faker], result: null });
    expect(final.players.map((p) => p.score)).toEqual(scores);
    expect(final.progress).toEqual({ completed: 1, total: 8 });

    // Play again, then end in the draw: the faker stays secret too.
    send(game, game.host, { type: 'host:next', seq: final.seq });
    await sync(game, [game.host]);
    await start(game);
    const third = await playRound(game, { stopAt: 'draw' });
    expect(third.no).toBe(3);
    send(game, game.host, { type: 'host:end' });
    const ended = await sync(game, [game.host]);
    expect(ended.phase.name).toBe('final');
    expect(ended.round).toMatchObject({ no: 3, faker: null, result: null });
    expect(ended.players.map((p) => p.score)).toEqual([0, 0, 0, 0]);
    // A late tap of the ended round's continue changes nothing.
    send(game, game.host, { type: 'host:next', seq: second.results.seq });
    expect((await dealt(game)).seq).toBe(ended.seq);
    secrecy(game);
  });
});
