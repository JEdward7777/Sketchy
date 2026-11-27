/**
 * Stage 7.11: display sockets (`hello {v, display: true}`, `SPEC.md` §3's
 * big screen). A display gets `state` and the drawings like any watcher,
 * never a `private`, cannot send a game intent, and is no player for
 * presence, the 10-player cap, done and lock counts, or the pause and the
 * 0025 restart.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { RESTART_WAIT_MS } from '../../src/shared/core/rules';
import { PROTOCOL_VERSION } from '../../src/shared/protocol';
import { setWordSourceForTests } from '../../src/worker/words';
import { COLORS, Socket, failOnRoomErrors, fireAlarmAtScheduledTime, join, newRoom, openSockets, resetClock, storedRoom } from './helpers';
import { drop, isOpen, newGame, openDisplay, playRound, send, start, sync } from './game-helpers';
import { assertGameSecrecy } from './game-secrecy';
import { drawings, firstStateIndex, privates } from './round-helpers';

failOnRoomErrors();

afterEach(() => {
  resetClock();
  setWordSourceForTests(null);
});

const INTENTS = [
  { type: 'join', name: 'Big Screen', color: 'brown', icon: 'fedora' },
  { type: 'rejoin', token: 'x' },
  { type: 'rejoinAs', playerId: 'p1' },
  { type: 'host:start' },
  { type: 'host:claim' },
  { type: 'vote:set', targetId: 'p1' },
  { type: 'draw:done', strokes: [] },
];

describe('display sockets (stage 7.11)', () => {
  it('gets welcome and state, answers ping, and every game intent is refused with display_only', async () => {
    const code = await newRoom();
    const display = await openDisplay(code);
    await display.nextState();
    expect(display.received.map((m) => m.type)).toEqual(['welcome', 'state']);
    for (const intent of INTENTS) {
      display.send(intent);
      expect(await display.nextError()).toBe('display_only');
    }
    // A repeated hello without the flag keeps it a display.
    display.send({ type: 'hello', v: PROTOCOL_VERSION });
    await display.next((m) => m.type === 'welcome');
    display.send(INTENTS[0]!);
    expect(await display.nextError()).toBe('display_only');
    display.send({ type: 'ping', t: 7 });
    expect(await display.next((m) => m.type === 'pong')).toMatchObject({ t: 7 });
    expect((await storedRoom(code))!.state.players).toEqual([]);
    expect(privates(display)).toEqual([]);
  });

  it('a bound player, or a socket with a pending "Rejoin as…", cannot become a display; a malformed flag is bad_message', async () => {
    const game = await newGame(4);
    game.sockets[1]!.send({ type: 'hello', v: PROTOCOL_VERSION, display: true });
    expect(await game.sockets[1]!.nextError()).toBe('already_joined');
    // Still the player: an intent goes to the reducer (and is refused there, as a non-host's start).
    send(game, 1, { type: 'host:start' });
    expect(await game.sockets[1]!.nextError()).toBe('not_host');

    await start(game);
    await playRound(game, {
      stopAt: 'draw',
      duringDraw: async (f) => {
        const x = [1, 2, 3].find((i) => i !== f)!;
        await drop(game, x);
        const [phone] = await openSockets(game.code, 1);
        phone!.send({ type: 'rejoinAs', playerId: game.ids[x]! });
        await phone!.next((m) => m.type === 'rejoin');
        phone!.send({ type: 'hello', v: PROTOCOL_VERSION, display: true });
        expect(await phone!.nextError()).toBe('already_joined');
        // The host admits it: it is a player socket, with its private view.
        send(game, game.host, { type: 'host:admit', playerId: game.ids[x]!, approve: true });
        expect((await phone!.nextPrivate()).you.id).toBe(game.ids[x]);
      },
    });

    const odd = await Socket.connect(game.code);
    odd.send({ type: 'hello', v: PROTOCOL_VERSION, display: 'yes' });
    expect(await odd.nextError()).toBe('bad_message');
  });

  it('is not a player for the start quorum or the 10-player cap', async () => {
    const code = await newRoom();
    const sockets = await openSockets(code, 11);
    const displays = await Promise.all([openDisplay(code), openDisplay(code)]);
    await join(sockets[0]!, 'Agent 1', COLORS[0]);
    await join(sockets[1]!, 'Agent 2', COLORS[1]);
    sockets[0]!.send({ type: 'host:start' });
    expect(await sockets[0]!.nextError()).toBe('not_enough_players');
    for (let i = 2; i < 10; i++) await join(sockets[i]!, `Agent ${i + 1}`, COLORS[i]!);
    sockets[10]!.send({ type: 'join', name: 'Agent 11', color: 'brown', icon: 'fedora' });
    expect(await sockets[10]!.nextError()).toBe('room_full');
    for (const d of displays) {
      await d.nextState((s) => s.players.length === 10);
      expect(privates(d)).toEqual([]);
    }
  });

  it('in a round: not waited for by the draw or the votes, gets each drawing once after the slideshow state, never a private', async () => {
    const game = await newGame(3);
    const displays = [await openDisplay(game.code)];
    await start(game);
    const played = await playRound(game, {
      beforeVotes: async () => {
        // A display opened mid-slideshow gets the round's drawings right after its state.
        displays.push(await openDisplay(game.code));
      },
      guess: (e) => e.word,
    });
    // Every lock in and every judge counted without the displays: no timer was needed.
    expect(played.guessAlarms).toBe(0);
    for (const d of displays) {
      await sync({ ...game, watch: d });
      expect(drawings(d).map((m) => m.playerId).sort()).toEqual([...game.ids].sort());
      expect(d.received.findIndex((m) => m.type === 'drawing')).toBeGreaterThan(firstStateIndex(d, (s) => s.round?.cards != null));
      expect(privates(d)).toEqual([]);
      game.opened.push({ socket: d, id: null });
    }
    expect(game.alarms).toBe(1); // only the unmask beat
    assertGameSecrecy(game.opened, game.you.map((y) => y.token), game.truth);
  });

  it('does not count toward the 3 that lift a pause or restart a paused round (0011, 0025)', async () => {
    const game = await newGame(3);
    const display = await openDisplay(game.code);
    await start(game);
    await playRound(game, {
      stopAt: 'draw',
      duringDraw: async (f) => {
        const x = [1, 2].find((i) => i !== f)!;
        const paused = await drop(game, x);
        expect(paused.paused).not.toBeNull();
        // The restart check fires and finds 2 players with a socket: the round stays paused.
        expect(await fireAlarmAtScheduledTime(game.code)).toBe(paused.paused!.since + RESTART_WAIT_MS);
        const st = await sync(game);
        expect(st.phase.name).toBe('draw');
        expect(st.paused).toEqual(paused.paused);
        expect(isOpen(game, x)).toBe(false);
      },
    });
    await sync({ ...game, watch: display });
    expect(display.lastState().paused).not.toBeNull();
    expect(privates(display)).toEqual([]);
  });
});
