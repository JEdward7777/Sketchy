/**
 * Stage 7.9: every `SPEC.md` §5 edge case reachable through real sockets,
 * timers fired by the room's own alarm (decisions 0003, 0007 item 6, 0013,
 * 0015). Each round's points are checked against `section5` and the case's
 * own expectation stated by hand.
 *
 * Not here: 0012 item 6 (a faker absent for the whole voting window still
 * scores) cannot happen through sockets. The window opens with the
 * slideshow, and a faker whose blip grace runs out before it (briefing or
 * draw, also across a pause) cancels the round (§7, 0012 item 1), so a
 * faker who reaches the slideshow was connected at its start.
 * `scoreRound` covers it in test/unit/scoring.test.ts ("0012 item 6").
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setWordSourceForTests } from '../../src/worker/words';
import { failOnRoomErrors, resetClock } from './helpers';
import { type Game, continueRound, dealt, drop, fireTo, newGame, playRound, section5, send, start } from './game-helpers';
import { assertGameSecrecy } from './game-secrecy';
import { drawings } from './round-helpers';

failOnRoomErrors();

afterEach(() => {
  resetClock();
  setWordSourceForTests(null);
});

/** The non-faker player indices of an `n`-player round, in room order. */
const agentsOf = (n: number, faker: number) => Array.from({ length: n }, (_, i) => i).filter((i) => i !== faker);

function secrecy(game: Game): void {
  assertGameSecrecy(game.opened, game.you.map((y) => y.token), game.truth);
}

describe('§5 edge cases through sockets (stage 7.9)', () => {
  it('an agent connected but not voting gives the faker +1; a faker who casts no vote gets no framing bonus (0003 item 1, 0015 item 3)', async () => {
    const game = await newGame(4);
    await start(game);
    let silent = -1;
    const played = await playRound(game, {
      votes: (f) => {
        silent = agentsOf(4, f)[0]!;
        return [0, 1, 2, 3].map((i) => (i === f || i === silent ? null : f));
      },
      // Two unlocked players: voting runs to the browse timer.
    });
    const r = played.result!;
    expect(r.faker).toEqual({ undetected: 1, guess: 0, framing: 0 });
    expect(r.points[game.ids[silent]!]).toBe(0);
    expect(r.points[game.ids[played.faker]!]).toBe(1);
    expect(r.points).toEqual(section5(game.ids, played.faker, played.votes, false));
    secrecy(game);
  });

  it('an agent disconnected for the whole voting window is excluded; one who leaves partway is counted (0003 item 2, 0007 item 6)', async () => {
    const game = await newGame(6);
    await start(game);
    let gone = -1;
    let left = -1;
    const played = await playRound(game, {
      duringDraw: async (f) => {
        // Drawn, then dropped before the slideshow starts: absent for the whole window, card dark.
        gone = agentsOf(6, f).find((i) => i !== game.host)!;
        await drop(game, gone);
      },
      beforeVotes: async (f) => {
        // Connected when the slideshow starts, gone before voting: present, no vote.
        left = agentsOf(6, f).find((i) => i !== game.host && i !== gone)!;
        game.sockets[left]!.ws.close(1000, 'phone died');
      },
      votes: (f) => [0, 1, 2, 3, 4, 5].map((i) => (i === gone || i === left ? null : i === f ? agentsOf(6, f)[0]! : f)),
    });
    const r = played.result!;
    // Present agents not voting the faker: only `left`. `gone` scores nothing either way.
    expect(r.faker.undetected).toBe(1);
    expect(r.points[game.ids[gone]!]).toBe(0);
    expect(r.points).toEqual(section5(game.ids, played.faker, played.votes, false, new Set([gone])));
    // `gone` never submitted, so the card went dark: five drawings for six cards.
    expect(played.results.round!.cards).toHaveLength(6);
    expect(drawings(game.watch).filter((d) => d.roundNo === played.no)).toHaveLength(5);
    secrecy(game);
  });

  it('"most votes" counts the faker\'s own vote, and a tie for most still frames (0003 item 3, §5)', async () => {
    const game = await newGame(5);
    await start(game);
    const played = await playRound(game, {
      // Faker → A, B → A, A → B, C → B, D → faker: A 2, B 2, faker 1. Without the faker's vote, A would trail B.
      votes: (f) => {
        const [a, b, c, d] = agentsOf(5, f) as [number, number, number, number];
        const v: (number | null)[] = [null, null, null, null, null];
        [v[f], v[b], v[a], v[c], v[d]] = [a, a, b, b, f];
        return v;
      },
    });
    const r = played.result!;
    const [a, b] = agentsOf(5, played.faker);
    expect(r.tally[game.ids[a!]!]).toBe(2);
    expect(r.tally[game.ids[b!]!]).toBe(2);
    expect(r.faker).toEqual({ undetected: 3, guess: 0, framing: 1 });
    expect(r.points).toEqual(section5(game.ids, played.faker, played.votes, false));
    secrecy(game);
  });

  it('judging: a 2–2 tie accepts, and judging ends once every connected judge has judged (0013 items 3, 5)', async () => {
    const game = await newGame(5);
    await start(game);
    const played = await playRound(game, {
      guess: () => 'blimp',
      judge: (f) => {
        const order = agentsOf(5, f);
        return [0, 1, 2, 3, 4].map((i) => (i === f ? null : order.indexOf(i) % 2 === 0));
      },
    });
    expect(played.result).toMatchObject({ verdict: 'judged', correct: true, accepts: 2, rejects: 2 });
    expect(played.result!.faker.guess).toBe(2);
    expect(played.guessAlarms).toBe(0);
    expect(played.results.round!.guess).toBe('blimp');
    expect(played.result!.points).toEqual(section5(game.ids, played.faker, played.votes, true));
    secrecy(game);
  });

  it('judging: nobody judges, the timer ends it, 0–0 accepts (0013 items 2, 5)', async () => {
    const game = await newGame(4);
    await start(game);
    const played = await playRound(game, { guess: () => 'blimp' });
    expect(played.result).toMatchObject({ verdict: 'judged', correct: true, accepts: 0, rejects: 0 });
    expect(played.guessAlarms).toBe(1);
    expect(played.result!.points).toEqual(section5(game.ids, played.faker, played.votes, true));
    secrecy(game);
  });

  it('no guess by the guess timer is wrong (§4)', async () => {
    const game = await newGame(3);
    await start(game);
    const played = await playRound(game, { guess: () => null });
    expect(played.result).toMatchObject({ verdict: 'none', correct: false });
    expect(played.results.round!.guess).toBeNull();
    expect(played.guessAlarms).toBe(1);
    expect(played.result!.faker.guess).toBe(0);
    secrecy(game);
  });

  it('auto-accepts a plural and an alt spelling after normalization, at once (§4 "Guess normalization")', async () => {
    const game = await newGame(3, [
      { word: 'zx000quill', category: 'Gadgets', alt: ['mq000fern'] },
      { word: 'zx001box', category: 'Gadgets', alt: ['mq001fern'] },
    ]);
    await start(game);
    const alt = await playRound(game, { guess: () => 'MQ000Fern?' });
    expect(alt.result).toMatchObject({ verdict: 'auto', correct: true, word: 'zx000quill' });
    expect(alt.guessAlarms).toBe(0);
    await continueRound(game);
    const plural = await playRound(game, { guess: () => '  ZX001Boxes!  ' });
    expect(plural.result).toMatchObject({ verdict: 'auto', correct: true, word: 'zx001box' });
    expect(plural.results.round!.guess).toBe('ZX001Boxes!');
    secrecy(game);
  });

  it('a cancelled round (the faker gone in the draw) leaves earlier scores and the game length unchanged (0003 item 4, §7)', async () => {
    const game = await newGame(4);
    await start(game);
    const first = await playRound(game, { guess: (e) => e.word });
    const scores = first.results.players.map((p) => p.score);
    expect(scores.some((x) => x > 0)).toBe(true);
    await continueRound(game);
    const second = await playRound(game, {
      stopAt: 'draw',
      duringDraw: async (f) => {
        // The faker's grace runs out in the draw: the round is scrubbed (§7, 0012 item 1).
        const st = await drop(game, f);
        expect(st.phase.name).toBe('scrubbed');
      },
    });
    const scrubbed = game.watch.lastState();
    expect(scrubbed.players.map((p) => p.score)).toEqual(scores);
    expect(scrubbed.progress).toEqual({ completed: 1, total: 8 });
    expect(scrubbed.round).toMatchObject({ no: second.no, faker: null, result: null });
    if (second.faker === game.host) {
      game.host = agentsOf(4, second.faker)[0]!;
      send(game, game.host, { type: 'host:claim' });
    }
    // The next round starts after the scrubbed beat, from the scores as they were.
    const next = await fireTo(game, ['dealing', 'briefing']);
    expect(next.round!.no).toBe(second.no + 1);
    expect((await dealt(game)).players.map((p) => p.score)).toEqual(scores);
    const third = await playRound(game, { guess: (e) => e.word });
    expect(third.results.players.map((p, i) => p.score - scores[i]!)).toEqual(game.ids.map((id) => third.result!.points[id] ?? 0));
    expect(third.results.progress).toEqual({ completed: 2, total: 8 });
    secrecy(game);
  });
});
