/**
 * Phase 7 DO-leg driver: whole games through real sockets, round by round,
 * with a scripted deck, and an independent statement of the §5 table to
 * check the room's scores against.
 *
 * Ordering: the driver never waits on a predicate that a stale frame could
 * satisfy. After sending intents it calls `sync`, a `ping` / `pong` on each
 * sender and then on the watcher: the room handles one socket's frames in
 * order and the watcher's `pong` leaves after every frame the room sent it
 * before, so `watch.lastState()` is then the room's state.
 */
import { expect } from 'vitest';
import type { WordEntry } from '../../src/shared/guess';
import type { PublicRoundResult } from '../../src/shared/core/views';
import { PROTOCOL_VERSION, type PrivateView, type PublicState } from '../../src/shared/protocol';
import { setWordSourceForTests } from '../../src/worker/words';
import { Socket, farFuture, fireAlarmAtScheduledTime, join, openSockets, pinClock, roomWithPlayers, storedRoom } from './helpers';
import type { RoundTruth } from './game-secrecy';
import { privates, strokesFor } from './round-helpers';

/**
 * Words no frame could contain by accident, all the same length so none is
 * a substring of another: `zx000quill`, `zx001quill`, …
 */
export function scriptedWords(n: number, alt = false): WordEntry[] {
  return Array.from({ length: n }, (_, i) => {
    const word = `zx${String(i).padStart(3, '0')}quill`;
    return alt ? { word, category: 'Gadgets', alt: [`mq${String(i).padStart(3, '0')}fern`] } : { word, category: 'Gadgets' };
  });
}

export interface Game {
  readonly code: string;
  /** The live socket of each player, by join order (replaced on a reconnect). */
  readonly sockets: Socket[];
  readonly you: { id: string; token: string }[];
  readonly ids: string[];
  /** The host's player index (moves on a claim, 0010). */
  host: number;
  /** An unbound socket that watches everything; the driver's view of the room. */
  readonly watch: Socket;
  /** Every socket ever opened by this game (closed ones included), for the secrecy check. */
  readonly opened: { socket: Socket; id: string | null }[];
  /** The deck's answers, in order. */
  readonly dealt: WordEntry[];
  readonly truth: Map<number, RoundTruth>;
  /** Game intents sent through `send`, by type (for the 7.10 budget). */
  readonly sent: Map<string, number>;
  /** Alarms fired through `fireTo` / `fireUntil` (for the 7.10 budget). */
  alarms: number;
}

/** `n` players and a watcher, a scripted deck, the clock pinned an hour ahead; still in the lobby. */
export async function newGame(n: number, words: readonly WordEntry[] = scriptedWords(40)): Promise<Game> {
  const dealt: WordEntry[] = [];
  setWordSourceForTests({
    deal: async () => {
      const entry = words[dealt.length];
      if (!entry) throw new Error('scripted deck ran out');
      dealt.push(entry);
      return { entry, repeat: false };
    },
  });
  pinClock(farFuture());
  const { code, sockets, you } = await roomWithPlayers(n);
  const [watch] = await openSockets(code, 1);
  const opened = [...sockets.map((socket, i) => ({ socket, id: you[i]!.id })), { socket: watch!, id: null }];
  return { code, sockets, you, ids: you.map((y) => y.id), host: 0, watch: watch!, opened, dealt, truth: new Map(), sent: new Map(), alarms: 0 };
}

/** A socket that completed `hello {display: true}` (stage 7.11). */
export async function openDisplay(code: string): Promise<Socket> {
  const s = await Socket.connect(code);
  s.send({ type: 'hello', v: PROTOCOL_VERSION, display: true });
  await s.next((m) => m.type === 'welcome');
  return s;
}

/** Player `i`'s socket is open (a dropped player's is not). */
export function isOpen(game: Game, i: number): boolean {
  const s = game.sockets[i]!;
  return s.closed === null && s.ws.readyState === WebSocket.OPEN;
}

/** Send a game intent from player `i`, counting it. */
export function send(game: Game, i: number, msg: { type: string } & Record<string, unknown>): void {
  game.sent.set(msg.type, (game.sent.get(msg.type) ?? 0) + 1);
  game.sockets[i]!.send(msg);
}

let pingNo = 0;
async function barrier(s: Socket): Promise<void> {
  const t = ++pingNo;
  s.send({ type: 'ping', t });
  await s.next((m) => m.type === 'pong' && m.t === t);
}

/** Wait until the room has handled everything `senders` sent, and the watcher has every frame that caused. */
export async function sync(game: Game, senders: readonly number[] = []): Promise<PublicState> {
  for (const i of new Set(senders)) if (isOpen(game, i)) await barrier(game.sockets[i]!);
  await barrier(game.watch);
  return game.watch.lastState();
}

/** Fire the room's alarm (bounded) until `done` holds for the watcher's state. */
export async function fireUntil(game: Game, done: (s: PublicState) => boolean, max = 8): Promise<PublicState> {
  let st = await sync(game);
  for (let i = 0; i < max && !done(st); i++) {
    await fireAlarmAtScheduledTime(game.code);
    game.alarms++;
    st = await sync(game);
  }
  expect(done(st), `state after ${max} alarms: ${st.phase.name}`).toBe(true);
  return st;
}

/** Fire the room's alarm (bounded) until the watcher sees one of `phases`. */
export function fireTo(game: Game, phases: readonly string[], max = 8): Promise<PublicState> {
  return fireUntil(game, (s) => phases.includes(s.phase.name), max);
}

/**
 * Wait out `dealing`: the deck answers in an event of its own, after the
 * one that asked (protocol.md "Dealing"), so no barrier covers it; firing
 * the alarm here would ask the deck again.
 */
export async function dealt(game: Game): Promise<PublicState> {
  await expect.poll(() => game.watch.lastState().phase.name, { timeout: 2_000, interval: 5 }).not.toBe('dealing');
  return sync(game);
}

/** Start the game (from the host), with `cycles` if given. */
export async function start(game: Game, cycles?: number): Promise<void> {
  if (cycles !== undefined) send(game, game.host, { type: 'host:settings', settings: { cycles } });
  send(game, game.host, { type: 'host:start' });
  await sync(game, [game.host]);
}

/**
 * Close player `i`'s socket and wait until the room has handled it. The
 * close changes nothing public until the blip grace ends (0012 item 2), so
 * this reads the stored presence.
 */
export async function close(game: Game, i: number): Promise<void> {
  game.sockets[i]!.ws.close(1000, 'phone died');
  await expect.poll(async () => (await storedRoom(game.code))!.state.players[i]!.presence.online, { timeout: 2_000, interval: 5 }).toBe(false);
}

/** `close`, then fire alarms until the blip grace has run out and player `i` shows disconnected. */
export async function drop(game: Game, i: number): Promise<PublicState> {
  await close(game, i);
  return fireUntil(game, (s) => !s.players[i]!.connected);
}

/** Player `i` comes back on a new socket with their token (§7); returns their first private view. */
export async function rejoin(game: Game, i: number): Promise<PrivateView> {
  const [s] = await openSockets(game.code, 1);
  s!.send({ type: 'rejoin', token: game.you[i]!.token });
  const view = await s!.nextPrivate();
  game.sockets[i] = s!;
  game.opened.push({ socket: s!, id: game.ids[i]! });
  await sync(game, [i]);
  return view;
}

/** A late joiner (§7, 0020 item 4) on a new socket, added to the game's players; returns their index. */
export async function joinLate(game: Game, name: string, color: string): Promise<number> {
  const [s] = await openSockets(game.code, 1);
  const you = await join(s!, name, color);
  game.sockets.push(s!);
  game.you.push(you);
  game.ids.push(you.id);
  game.opened.push({ socket: s!, id: you.id });
  await sync(game, [game.ids.length - 1]);
  return game.ids.length - 1;
}

export interface RoundPlan {
  /** Runs once the draw has started, before anyone submits (e.g. to drop a player). */
  readonly duringDraw?: (faker: number) => Promise<void>;
  /** Player indices who submit a drawing (default: every connected roster player with an open socket). */
  readonly drawers?: (faker: number) => readonly number[];
  /** Runs once the round is in slideshow or browse, before votes. */
  readonly beforeVotes?: (faker: number) => Promise<void>;
  /** Per player index: the target index, or null for no vote (default: agents vote the faker, the faker the next roster player). */
  readonly votes?: (faker: number) => readonly (number | null)[];
  /** Lock every selection (default true); false leaves voting to its timers. */
  readonly lock?: boolean;
  /** Runs in unmask, before the guess opens. */
  readonly atUnmask?: (faker: number) => Promise<void>;
  /** Stop in this phase instead of playing on (returns with `result` null). */
  readonly stopAt?: 'draw' | 'guess';
  /** The faker's guess text, or null to let the guess time out (default null). */
  readonly guess?: (entry: WordEntry) => string | null;
  /** Per player index: accept, reject, or null for no judgment (default: no one judges). */
  readonly judge?: (faker: number) => readonly (boolean | null)[];
}

export interface Played {
  readonly no: number;
  readonly faker: number;
  readonly entry: WordEntry;
  /** The votes cast, voter index → target index. */
  readonly votes: ReadonlyMap<number, number>;
  /** Round results (or the state where `stopAt` stopped). */
  readonly results: PublicState;
  readonly result: PublicRoundResult | null;
  /** Alarms fired from the guess opening to round results. */
  readonly guessAlarms: number;
}

/** Roster players with an open socket who are connected for game rules. */
const activeIdx = (game: Game, st: PublicState, roster: readonly string[]) =>
  game.ids.map((_, i) => i).filter((i) => roster.includes(game.ids[i]!) && st.players[i]!.connected && isOpen(game, i));

/**
 * Play the round now in its briefing to round results (§4 phases 1–7),
 * through every player's own socket. The faker is whoever the room picked;
 * the plan is written relative to them.
 */
export async function playRound(game: Game, plan: RoundPlan = {}): Promise<Played> {
  let st = await dealt(game);
  expect(st.phase.name).toBe('briefing');
  const no = st.round!.no;
  const roster = st.round!.roster;
  const rosterIdx = game.ids.map((_, i) => i).filter((i) => roster.includes(game.ids[i]!));
  const entry = game.dealt.at(-1)!;
  for (const i of rosterIdx) await sync(game, [i]);
  const roles = rosterIdx.map((i) => privates(game.sockets[i]!).findLast((v) => v.round?.no === no)?.round);
  const faker = rosterIdx[roles.findIndex((r) => r?.role === 'faker')]!;
  expect(roles.filter((r) => r?.role === 'faker')).toHaveLength(1);
  for (const r of roles) if (r && r.role === 'agent') expect(r.word).toBe(entry.word);
  game.truth.set(no, { word: entry.word, alt: entry.alt, faker: game.ids[faker]!, roster: [...roster], unmasked: false });
  const stopped = (): Played => ({ no, faker, entry, votes: new Map(), results: game.watch.lastState(), result: null, guessAlarms: 0 });

  send(game, game.host, { type: 'host:next', seq: st.seq });
  st = await sync(game, [game.host]);
  expect(st.phase.name).toBe('draw');
  await plan.duringDraw?.(faker);
  if (plan.stopAt === 'draw') return stopped();
  const drawers = plan.drawers?.(faker) ?? activeIdx(game, await sync(game), roster);
  for (const i of drawers) send(game, i, { type: 'draw:done', strokes: strokesFor(i) });
  await sync(game, drawers);
  await fireTo(game, ['slideshow', 'browse']);
  await plan.beforeVotes?.(faker);

  const votes = new Map<number, number>();
  const next = rosterIdx[(rosterIdx.indexOf(faker) + 1) % rosterIdx.length]!;
  const wanted = plan.votes?.(faker) ?? game.ids.map((_, i) => (i === faker ? next : faker));
  const voters = activeIdx(game, await sync(game), roster);
  for (const i of voters) {
    const target = wanted[i];
    if (target === null || target === undefined) continue;
    send(game, i, { type: 'vote:set', targetId: game.ids[target]! });
    if (plan.lock !== false) send(game, i, { type: 'vote:lock' });
    votes.set(i, target);
  }
  await sync(game, voters);
  st = await fireTo(game, ['unmask']);
  expect(st.round!.faker).toBe(game.ids[faker]);
  game.truth.set(no, { ...game.truth.get(no)!, unmasked: true });
  await plan.atUnmask?.(faker);

  st = await fireTo(game, ['guess']);
  if (plan.stopAt === 'guess') return stopped();
  const before = game.alarms;
  const text = plan.guess?.(entry) ?? null;
  if (text !== null) {
    send(game, faker, { type: 'guess:submit', text });
    st = await sync(game, [faker]);
  }
  if (st.phase.name === 'judging') {
    const judgments = plan.judge?.(faker) ?? [];
    const judges = rosterIdx.filter((i) => i !== faker && typeof judgments[i] === 'boolean' && isOpen(game, i));
    for (const i of judges) send(game, i, { type: 'guess:judge', accept: judgments[i]! });
    await sync(game, judges);
  }
  const results = await fireTo(game, ['results', 'final']);
  expect(results.round!.no).toBe(no);
  return { no, faker, entry, votes, results, result: results.round!.result!, guessAlarms: game.alarms - before };
}

/** The host's continue on round results: the next round (or final results). */
export async function continueRound(game: Game): Promise<PublicState> {
  const st = game.watch.lastState();
  send(game, game.host, { type: 'host:next', seq: st.seq });
  return sync(game, [game.host]);
}

/**
 * `SPEC.md` §5, written out again from the table (not from `scoreRound`),
 * for a round whose voting window every roster player except `absent`
 * was present for:
 * - a real player +1 for voting for the faker;
 * - the faker +1 per present real player who did not vote for them;
 * - the faker +2 for a correct guess;
 * - the faker +1 when their vote target has the most votes, ties counting,
 *   the faker's own vote included (0003 item 3); no vote, no bonus (0015).
 */
export function section5(ids: readonly string[], faker: number, votes: ReadonlyMap<number, number>, correct: boolean, absent: ReadonlySet<number> = new Set()): Record<string, number> {
  const points: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  const fid = ids[faker]!;
  for (const [i] of ids.entries()) {
    if (i === faker || absent.has(i)) continue;
    if (votes.get(i) === faker) points[ids[i]!]! += 1;
    else points[fid]! += 1;
  }
  if (correct) points[fid]! += 2;
  const tally = new Map<number, number>();
  for (const [, t] of votes) tally.set(t, (tally.get(t) ?? 0) + 1);
  const target = votes.get(faker);
  if (target !== undefined && tally.get(target) === Math.max(...tally.values())) points[fid]! += 1;
  return points;
}

/** Standard competition ranking (1, 1, 3; decision 0007 item 4), highest first, ties in room order. */
export function expectedStandings(ids: readonly string[], scores: readonly number[]): { id: string; score: number; place: number }[] {
  const rows = ids.map((id, i) => ({ id, score: scores[i]!, i })).sort((a, b) => b.score - a.score || a.i - b.i);
  return rows.map((r) => ({ id: r.id, score: r.score, place: 1 + rows.filter((o) => o.score > r.score).length }));
}
