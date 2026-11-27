/**
 * Phase 6 DO-leg helpers: start a round on a scripted word, stub stroke
 * lists, the per-socket frame recording checks (`SPEC.md` §14), and a
 * capture of everything `RoomDO` logs.
 */
import { expect, vi } from 'vitest';
import type { PublicState, ServerMessage } from '../../src/shared/protocol';
import type { WireStroke } from '../../src/shared/stroke-codec';
import { setWordSourceForTests } from '../../src/worker/words';
import { type Socket, farFuture, fireAlarmAtScheduledTime, pinClock, roomWithPlayers } from './helpers';

/** A word and category no frame could contain by accident, so substring searches are exact. */
export const SECRET = { word: 'zeppelinwhisker', category: 'Vehicles' };

export type Drawing = Extract<ServerMessage, { type: 'drawing' }>;
type Private = Extract<ServerMessage, { type: 'private' }>;

export function privates(s: Socket): Private['view'][] {
  return s.received.filter((m): m is Private => m.type === 'private').map((m) => m.view);
}

export function drawings(s: Socket): Drawing[] {
  return s.received.filter((m): m is Drawing => m.type === 'drawing');
}

export function stateFrames(s: Socket): string[] {
  return s.raw.filter((r) => (JSON.parse(r) as ServerMessage).type === 'state');
}

/** A small stroke list unique to player index `i` (stub drawings, phase 6). */
export function strokesFor(i: number): WireStroke[] {
  return [
    { c: 1 + (i % 8), s: i % 3, p: [10 + i, 20 + i, 30 + i, 40 + i] },
    { c: 0, s: 2, p: [100 + i, 100] },
  ];
}

/**
 * `n` players; the host starts; everyone sees the briefing. The first deal
 * is `SECRET`; later rounds get other words of the same category, since a
 * used word is dealt again (§6).
 */
export async function briefingRoom(n: number) {
  let deals = 0;
  setWordSourceForTests({
    deal: async () => ({ entry: deals++ === 0 ? SECRET : { word: `othercipher${deals}`, category: SECRET.category }, repeat: false }),
  });
  const t0 = farFuture();
  pinClock(t0);
  const room = await roomWithPlayers(n);
  room.sockets[0]!.send({ type: 'host:start' });
  for (const s of room.sockets) await s.nextState((st) => st.phase.name === 'briefing');
  const fakerIdx = room.sockets.findIndex((s) => privates(s).at(-1)?.round?.role === 'faker');
  expect(fakerIdx).toBeGreaterThanOrEqual(0);
  return { t0, fakerIdx, ...room };
}

/** Fire alarms until `done` holds (bounded), letting frames arrive between. */
export async function fireUntil(code: string, done: () => boolean, max = 8): Promise<void> {
  for (let i = 0; i < max && !done(); i++) {
    await fireAlarmAtScheduledTime(code);
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(done()).toBe(true);
}

/** The index of the first frame on `s` that is a `state` matching `pred`, or -1. */
export function firstStateIndex(s: Socket, pred: (st: PublicState) => boolean): number {
  return s.received.findIndex((m) => m.type === 'state' && pred(m.state));
}

export interface Recorded {
  readonly socket: Socket;
  /** The player this socket was bound to, or null for an observer. */
  readonly id: string | null;
  readonly faker: boolean;
}

/**
 * The §14 rules over every frame each socket received, up to and including
 * the round's unmask (the word is still secret then, the faker public from
 * the unmask `state` on):
 * - `private` only for the socket's own player, never another's token;
 * - the word never on the faker's socket, an observer's, or in any `state`;
 * - the faker role only on the faker's socket; `state.round.faker` null
 *   before unmask;
 * - no `state` carries a token or stroke data;
 * - no `drawing` frame before the slideshow's `state` on that socket;
 * - every socket's `state` frames are the same bytes: each socket's list is
 *   a run of the longest list, ending on the same frame.
 */
export function assertRecordedSecrecy(all: readonly Recorded[], tokens: readonly string[]): void {
  for (const { socket, id, faker } of all) {
    for (const view of privates(socket)) expect(view.you.id).toBe(id);
    let unmasked = false;
    let slideshow = false;
    for (const raw of socket.raw) {
      const msg = JSON.parse(raw) as ServerMessage;
      if (msg.type === 'state' || id === null || faker) expect(raw).not.toContain(SECRET.word);
      if (msg.type === 'private' && !faker) expect(msg.view.round?.role).not.toBe('faker');
      if (msg.type === 'state') {
        if (!unmasked) unmasked = msg.state.phase.name === 'unmask';
        if (!unmasked) expect(msg.state.round?.faker ?? null).toBeNull();
        if (msg.state.round?.cards) slideshow = true;
        expect(raw).not.toContain('"strokes"');
        expect(raw).not.toMatch(/"p":\[/);
        for (const t of tokens) expect(raw).not.toContain(t);
      }
      if (msg.type === 'drawing') expect(slideshow).toBe(true);
      const own = msg.type === 'private' ? msg.view.you.token : null;
      for (const t of tokens) if (t !== own) expect(raw).not.toContain(t);
    }
  }
  const lists = all.map(({ socket }) => stateFrames(socket));
  const longest = lists.reduce((a, b) => (b.length > a.length ? b : a));
  for (const list of lists) {
    if (list.length === 0) continue;
    const start = longest.indexOf(list[0]!);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(longest.slice(start, start + list.length)).toEqual(list);
  }
  const open = all.filter(({ socket }) => socket.closed === null).map(({ socket }) => stateFrames(socket).at(-1));
  expect(new Set(open).size).toBe(1);
}

/** Everything the room logs through `console` while the capture runs, one string per call. */
export function captureConsole(): { lines: () => string[]; stop: () => void } {
  const methods = ['log', 'info', 'warn', 'debug', 'error'] as const;
  const spies = methods.map((m) => vi.spyOn(console, m));
  return {
    lines: () => spies.flatMap((s) => s.mock.calls.map((c) => c.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))),
    // `console.error` stays spied: `failOnRoomErrors` restores it after the test.
    stop: () => spies.slice(0, 4).forEach((s) => s.mockRestore()),
  };
}

/** No captured line names the word, the faker's id or the faker's name (word-bounded, so `p1` does not match `p10`). */
export function assertLogsClean(lines: readonly string[], faker: { id: string; name: string }): void {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const id = new RegExp(`\\b${esc(faker.id)}\\b`);
  const name = new RegExp(`${esc(faker.name)}(?!\\d)`);
  for (const line of lines) {
    expect(line).not.toContain(SECRET.word);
    expect(line).not.toMatch(id);
    expect(line).not.toMatch(name);
  }
}
