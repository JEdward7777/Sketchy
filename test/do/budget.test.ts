/**
 * Stage 7.10: the free-tier budget measured from whole games through real
 * sockets, as expressions in players `P` and rounds `R`
 * (harness/reference/budget.md "Measured in phase 7").
 *
 * Each round is the plan budget.md calls the baseline round: the host taps
 * the briefing and results continues, everyone draws, sets one vote and
 * locks it, and the faker's exact guess auto-accepts. The counters spy on
 * the room's own storage calls in the tests' isolate (the DO shares it):
 * `RoomStore` methods for rows, the storage prototype's `setAlarm` for
 * alarm rows.
 */
import { runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '../../src/shared/protocol';
import { RoomStore } from '../../src/worker/room-store';
import { setWordSourceForTests } from '../../src/worker/words';
import { failOnRoomErrors, freshCode, resetClock, roomStub } from './helpers';
import { continueRound, newGame, playRound, start } from './game-helpers';

failOnRoomErrors();

afterEach(() => {
  resetClock();
  setWordSourceForTests(null);
  vi.restoreAllMocks();
});

interface Measured {
  readonly sent: Record<string, number>;
  readonly roomRows: number;
  readonly drawingRows: number;
  readonly clears: number;
  readonly setAlarms: number;
  readonly alarms: number;
  readonly deals: number;
  readonly dbBytes: number;
  /** Outbound frames to one player socket, by type: count and total bytes. */
  readonly frames: Record<string, { n: number; bytes: number; max: number }>;
}

async function measure(p: number, cycles: number): Promise<Measured & { lobby: { roomRows: number; setAlarms: number } }> {
  // Any room's storage object will do to reach the shared prototype; this one is never written.
  const storage = await runInDurableObject(roomStub(freshCode()), (_r, state) => state.storage);
  const setAlarm = vi.spyOn(Object.getPrototypeOf(storage) as DurableObjectStorage, 'setAlarm');
  const save = vi.spyOn(RoomStore.prototype, 'save');
  const storeDrawing = vi.spyOn(RoomStore.prototype, 'storeDrawing');
  const clearDrawings = vi.spyOn(RoomStore.prototype, 'clearDrawings');
  const game = await newGame(p);
  // The lobby (create and P joins) apart from the game itself.
  const lobby = { roomRows: save.mock.calls.length, setAlarms: setAlarm.mock.calls.length };
  for (const spy of [save, storeDrawing, clearDrawings, setAlarm]) spy.mockClear();
  await start(game, cycles);
  for (let r = 0; r < cycles * p; r++) {
    await playRound(game, { guess: (e) => e.word });
    await continueRound(game);
  }
  expect(game.watch.lastState().phase.name).toBe('final');
  const dbBytes = await runInDurableObject(roomStub(game.code), (_r, state) => state.storage.sql.databaseSize);
  const frames: Measured['frames'] = {};
  for (const raw of game.sockets[1]!.raw) {
    const type = (JSON.parse(raw) as ServerMessage).type;
    const f = (frames[type] ??= { n: 0, bytes: 0, max: 0 });
    f.n++;
    f.bytes += raw.length;
    f.max = Math.max(f.max, raw.length);
  }
  return {
    lobby,
    sent: Object.fromEntries(game.sent),
    roomRows: save.mock.calls.length,
    drawingRows: storeDrawing.mock.calls.length,
    clears: clearDrawings.mock.calls.length,
    setAlarms: setAlarm.mock.calls.length,
    alarms: game.alarms,
    deals: game.dealt.length,
    dbBytes,
    frames,
  };
}

describe('budget per game, measured (stage 7.10)', () => {
  for (const [p, cycles] of [
    [3, 2],
    [10, 1],
  ] as const) {
    it(`${p} players, ${cycles} cycle(s)`, async () => {
      const m = await measure(p, cycles);
      const r = p * cycles;
      // Inbound game intents: 3 per player per round (draw:done, vote:set, vote:lock), plus
      // the guess and two host taps per round, plus settings and start.
      expect(m.sent).toEqual({
        'host:settings': 1,
        'host:start': 1,
        'host:next': 2 * r,
        'draw:done': r * p,
        'vote:set': r * p,
        'vote:lock': r * p,
        'guess:submit': r,
      });
      // One room row per handled event: every intent, every fired alarm, every dealt word.
      const intents = Object.values(m.sent).reduce((a, b) => a + b, 0);
      expect(m.alarms).toBe(r); // the unmask beat; every other phase ended early
      expect(m.deals).toBe(r);
      expect(m.roomRows).toBe(intents + m.alarms + m.deals);
      expect(m.roomRows).toBe(r * (3 * p + 5) + 2);
      expect(m.drawingRows).toBe(r * p);
      // A round's rows are cleared when the next round starts; the last round's stay to final results.
      expect(m.clears).toBe(r - 1);
      // The alarm moves at each of the round's 7 timed phases (dealing's retry, briefing, draw,
      // slideshow, unmask, guess, results), then once to the expiry at final results.
      expect(m.setAlarms).toBe(7 * r + 1);
      // The lobby: the create and each join write the room row. Only the create sets the alarm
      // here because the clock is pinned; at a live clock each join pushes the expiry (§14) to a
      // new instant, so the lobby costs up to `p + 1` alarm rows.
      expect(m.lobby).toEqual({ roomRows: p + 1, setAlarms: 1 });
      // The sizes for budget.md: `npx vitest run --project do test/do/budget.test.ts --silent=false`.
      console.log(JSON.stringify({ p, cycles, ...m }));
    }, 60_000);
  }
});
