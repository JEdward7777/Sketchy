/**
 * Phase 5 — the global deck (`DeckDO`, `SPEC.md` §6) on the DO leg: real
 * SQLite, real RPC from `RoomDO`. Deck tests use their own deck names so
 * they never touch the singleton the room tests deal from.
 */
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import wordsJson from '../../data/words.json';
import { parseWordList, shuffledOrder, type RandomInt } from '../../src/shared/deck';
import { rngFromSeed, rngInt } from '../../src/shared/rng';
import type { Difficulty } from '../../src/shared/difficulty-bag';
import type { ServerMessage } from '../../src/shared/protocol';
import { setDeckRandomForTests, type DeckDO } from '../../src/worker/deck-do';
import { setWordSourceForTests } from '../../src/worker/words';
import { failOnRoomErrors, farFuture, fireAlarmAtScheduledTime, freshCode, pinClock, resetClock, roomStub, roomWithPlayers, storedRoom, type Socket } from './helpers';

const WORDS = parseWordList(wordsJson);

failOnRoomErrors();

afterEach(() => {
  setDeckRandomForTests(null);
  setWordSourceForTests(null);
  resetClock();
});

function freshDeck(): DurableObjectStub<DeckDO> {
  return env.DECK.getByName(`test-deck-${freshCode()}`);
}

/** A reproducible `[0, n)` source for tests only, counting its calls. */
function scripted(seed: number): RandomInt & { calls: number } {
  let st = rngFromSeed(seed);
  const f = ((n: number) => {
    f.calls++;
    const r = rngInt(st, n);
    st = r.state;
    return r.value;
  }) as RandomInt & { calls: number };
  f.calls = 0;
  return f;
}

/** Script the deck's shuffles from `seed`; returns the source to count its calls. */
function scriptShuffles(seed: number): RandomInt & { calls: number } {
  const f = scripted(seed);
  setDeckRandomForTests(f);
  return f;
}

/** The words the scripted source's shuffles deal: shuffle 1, shuffle 2, … */
function scriptedOrders(d: Difficulty, seed: number, shuffles: number): string[][] {
  const src = scripted(seed);
  return Array.from({ length: shuffles }, () => shuffledOrder(WORDS[d].length, src).map((i) => WORDS[d][i]!.word));
}

async function dealWords(deck: DurableObjectStub<DeckDO>, d: Difficulty, n: number, exclude: string[] = []): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push((await deck.deal(d, exclude)).entry.word);
  return out;
}

async function shuffles(deck: DurableObjectStub<DeckDO>, d: Difficulty): Promise<number> {
  return runInDurableObject(deck, (_i, state) => state.storage.sql.exec<{ shuffles: number }>('SELECT shuffles FROM deck_pos WHERE difficulty = ?', d).one().shuffles);
}

describe('DeckDO (5.1, 5.2)', () => {
  it('deals the order its random source shuffles, the same on two decks given the same script', async () => {
    scriptShuffles(42);
    const a = await dealWords(freshDeck(), 'medium', 10);
    scriptShuffles(42);
    const b = await dealWords(freshDeck(), 'medium', 10);
    expect(a).toEqual(b);
    expect(a).toEqual(scriptedOrders('medium', 42, 1)[0]!.slice(0, 10));
  });

  it('shuffles from the CSPRNG by default: two fresh decks deal different orders', async () => {
    const a = await dealWords(freshDeck(), 'concrete', 12);
    const b = await dealWords(freshDeck(), 'concrete', 12);
    // Equal by chance with probability 1 / (200 × 199 × … × 189), about 2^-91.
    expect(a).not.toEqual(b);
  });

  it('draws fresh randomness for every swap of every reshuffle, never a seed', async () => {
    const src = scriptShuffles(9);
    const deck = freshDeck();
    const n = WORDS.abstract.length;
    await dealWords(deck, 'abstract', 1);
    expect(src.calls).toBe(n - 1);
    await dealWords(deck, 'abstract', n - 1);
    expect(src.calls).toBe(n - 1);
    await dealWords(deck, 'abstract', 1);
    expect(src.calls).toBe(2 * (n - 1));
  });

  it('deals every word once before reshuffling, and keeps its stored order across eviction', async () => {
    const src = scriptShuffles(7);
    const deck = freshDeck();
    const n = WORDS.abstract.length;
    const [first, second] = scriptedOrders('abstract', 7, 2);
    const half = await dealWords(deck, 'abstract', Math.floor(n / 2));
    await evictDurableObject(deck);
    const calls = src.calls;
    const rest = await dealWords(deck, 'abstract', n - half.length);
    // The order came back from SQLite, not from a new shuffle.
    expect(src.calls).toBe(calls);
    const all = [...half, ...rest];
    expect(new Set(all).size).toBe(n);
    expect(all).toEqual(first);
    expect(await shuffles(deck, 'abstract')).toBe(1);
    // One more: the deck reshuffles and starts its new order.
    expect(await dealWords(deck, 'abstract', 1)).toEqual([second![0]]);
    expect(await shuffles(deck, 'abstract')).toBe(2);
  });

  it('reshuffles when the stored order no longer fits words.json', async () => {
    scriptShuffles(4);
    const deck = freshDeck();
    await dealWords(deck, 'medium', 3);
    await runInDurableObject(deck, (_i, state) => {
      state.storage.sql.exec(`UPDATE deck_order SET ord = '[2,0,1]' WHERE difficulty = 'medium'`);
    });
    await evictDurableObject(deck);
    const src = scriptShuffles(5);
    expect(await dealWords(deck, 'medium', 1)).toEqual([scriptedOrders('medium', 5, 1)[0]![0]]);
    expect(src.calls).toBe(WORDS.medium.length - 1);
    expect(await shuffles(deck, 'medium')).toBe(2);
  });

  it('keeps one order and position per difficulty', async () => {
    scriptShuffles(3);
    const deck = freshDeck();
    const c = await dealWords(deck, 'concrete', 2);
    const m = await dealWords(deck, 'medium', 2);
    const src = scripted(3);
    const oc = shuffledOrder(WORDS.concrete.length, src).map((i) => WORDS.concrete[i]!.word);
    const om = shuffledOrder(WORDS.medium.length, src).map((i) => WORDS.medium[i]!.word);
    expect(c).toEqual(oc.slice(0, 2));
    expect(m).toEqual(om.slice(0, 2));
  });

  it('two rooms dealing in turn never receive the same word within one shuffle', async () => {
    const deck = freshDeck();
    const used: [string[], string[]] = [[], []];
    const n = WORDS.abstract.length;
    for (let i = 0; i < n; i++) {
      const room = used[i % 2]!;
      const { entry } = await deck.deal('abstract', room);
      room.push(entry.word);
    }
    const all = [...used[0], ...used[1]];
    expect(new Set(all).size).toBe(n);
    expect(await shuffles(deck, 'abstract')).toBe(1);
  });

  it('concurrent deals from many rooms are still distinct (no interleaving inside deal)', async () => {
    const deck = freshDeck();
    const n = WORDS.concrete.length;
    const got = await Promise.all(Array.from({ length: n }, () => deck.deal('concrete', [])));
    expect(new Set(got.map((g) => g.entry.word)).size).toBe(n);
  });

  it('skips an excluded word', async () => {
    scriptShuffles(11);
    const deck = freshDeck();
    const order = scriptedOrders('concrete', 11, 1)[0]!;
    const got = await deck.deal('concrete', [order[0]!, order[2]!]);
    expect(got).toMatchObject({ entry: { word: order[1] }, repeat: false });
    expect((await deck.deal('concrete', [order[0]!, order[2]!])).entry.word).toBe(order[3]);
  });

  it('with every word of the difficulty excluded, deals the next one flagged repeat instead of looping (0028)', async () => {
    scriptShuffles(5);
    const deck = freshDeck();
    const all = WORDS.abstract.map((w) => w.word);
    const got = await deck.deal('abstract', all);
    expect(got).toMatchObject({ entry: { word: scriptedOrders('abstract', 5, 1)[0]![0] }, repeat: true });
    // Excluding words of other difficulties changes nothing.
    expect(await deck.deal('abstract', WORDS.concrete.map((w) => w.word))).toMatchObject({ repeat: false });
  });

  it('refuses an unknown difficulty or a malformed exclude list', async () => {
    // Inside the object: a throw out of an RPC call is also reported by the
    // runtime as an unhandled rejection, which would fail the run.
    await runInDurableObject(freshDeck(), (deck) => {
      expect(() => deck.deal('mixed' as Difficulty, [])).toThrow(/unknown difficulty/);
      expect(() => deck.deal('concrete', [3] as unknown as string[])).toThrow(/exclude/);
    });
  });
});

type Private = Extract<ServerMessage, { type: 'private' }>;

async function playToResults(code: string, sockets: Socket[], you: { id: string }[]): Promise<void> {
  const host = sockets[0]!;
  host.send({ type: 'host:next', seq: host.lastState().seq });
  await host.nextState((s) => s.phase.name === 'draw');
  for (const s of sockets) s.send({ type: 'draw:done', strokes: [{ c: 0, s: 0, p: [1, 1, 2, 2] }] });
  await host.nextState((s) => s.phase.name === 'slideshow');
  sockets.forEach((s, i) => {
    s.send({ type: 'vote:set', targetId: you[(i + 1) % you.length]!.id });
    s.send({ type: 'vote:lock' });
  });
  await host.nextState((s) => s.phase.name === 'unmask');
  for (let i = 0; i < 6 && host.lastState().phase.name !== 'results'; i++) {
    await fireAlarmAtScheduledTime(code);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('RoomDO deals from DeckDO (5.3, 5.4)', () => {
  it('a round runs from dealing to results on a real word from the global deck, of the round\'s difficulty', async () => {
    pinClock(farFuture());
    const { code, sockets, you } = await roomWithPlayers(3);
    sockets[0]!.send({ type: 'host:start' });
    const brief = await sockets[0]!.nextState((s) => s.phase.name === 'briefing');
    const st = (await storedRoom(code))!.state;
    const d = st.round!.difficulty;
    const entry = WORDS[d].find((w) => w.word === st.round!.word!.word);
    expect(entry).toBeDefined();
    expect(brief.round!.category).toBe(entry!.category);
    const agentWords = sockets
      .map((s) => [...s.received].reverse().find((m): m is Private => m.type === 'private' && m.view.round !== null)!.view.round!)
      .filter((r) => r.role === 'agent')
      .map((r) => (r as { word: string }).word);
    expect(agentWords).toHaveLength(2);
    expect(new Set(agentWords)).toEqual(new Set([entry!.word]));
    await playToResults(code, sockets, you);
    expect(sockets[0]!.lastState().round!.result!.word).toBe(entry!.word);
    expect(st.usedWords).toEqual([entry!.word]);
  });

  it('a room that has used every word of its difficulty still gets a word, at once (0028)', async () => {
    pinClock(farFuture());
    const { code, sockets } = await roomWithPlayers(3);
    sockets[0]!.send({ type: 'host:settings', settings: { difficulty: 'abstract' } });
    await sockets[0]!.nextState((s) => s.settings.difficulty === 'abstract');
    const all = WORDS.abstract.map((w) => w.word);
    await runInDurableObject(roomStub(code), (_r, state) => {
      const row = state.storage.sql.exec<{ state: string }>('SELECT state FROM room').one();
      state.storage.sql.exec('UPDATE room SET state = ?', JSON.stringify({ ...JSON.parse(row.state), usedWords: all }));
    });
    sockets[0]!.send({ type: 'host:start' });
    await sockets[0]!.nextState((s) => s.phase.name === 'briefing');
    const st = (await storedRoom(code))!;
    expect(all).toContain(st.state.round!.word!.word);
    expect(st.state.usedWords).toEqual(all);
    expect(st.deal).toBeNull();
  });
});
