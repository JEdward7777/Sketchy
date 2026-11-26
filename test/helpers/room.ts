import type { WordEntry } from '../../src/shared/guess';
import type { GameIntent } from '../../src/shared/protocol';
import { mix32 } from '../../src/shared/rng';
import { createRoom, nextDeadline, projectPrivate, projectPublic, reduce } from '../../src/shared/core';
import type { Effect, Input } from '../../src/shared/core/io';
import type { RoomState } from '../../src/shared/core/state';

/** A fixed start instant, so tests read in offsets from it. */
export const T0 = 1_700_000_000_000;

/** A word entry like data/words.json's. */
export const WORD: WordEntry = { word: 'umbrella', category: 'Things', alt: ['brolly'] };
/** Another word with the same category, for the indistinguishability tests (3.6.1). */
export const OTHER_WORD: WordEntry = { word: 'ladder', category: 'Things' };

/** A valid one-stroke drawing in wire form (decision 0009). */
export const STROKES = [{ c: 1, s: 0, p: [10, 10, 20, 20] }];

/**
 * Drives the pure reducer the way `RoomDO` will: one socket id per player,
 * a test clock, and every effect kept for assertions. Tokens are minted as
 * `token-<n>`, standing in for the adapter's CSPRNG.
 */
export class RoomDriver {
  state: RoomState;
  now: number;
  effects: Effect[] = [];
  /** Effects of the last step only. */
  last: Effect[] = [];
  private minted = 0;
  private calls = 0;
  /**
   * Stands in for the adapter's CSPRNG entropy on every `reduce` call.
   * Default: a fixed sequence by call count, the same for every room, so a
   * test stays reproducible and two rooms driven through the same script
   * get the same entropy. Replace it to vary entropy per call.
   */
  entropy: () => number = () => mix32(++this.calls);

  /**
   * `orderSeed` seeds the slideshow-order stream separately from `seed`
   * (`RoomState.orderRng`); it has a fixed default so two rooms that differ
   * only in `seed` (the faker) show the same card order.
   */
  constructor(seed = 1, now = T0, code = 'ABCD', orderSeed = 0x5eed) {
    this.state = createRoom(code, seed, now, orderSeed);
    this.now = now;
  }

  step(input: Input): Effect[] {
    const out = reduce(this.state, input, this.now, this.entropy());
    this.state = out.state;
    this.last = [...out.effects];
    this.effects.push(...out.effects);
    return this.last;
  }

  /** Join as a new player; returns the id from the `bind` effect. */
  join(name: string, color: string, icon = 'fedora'): string {
    const fx = this.step({
      kind: 'intent',
      conn: `c-${name}`,
      player: null,
      intent: { type: 'join', name, color, icon },
      mintedToken: `token-${++this.minted}`,
    });
    const bind = fx.find((e) => e.type === 'bind');
    if (!bind || bind.type !== 'bind') throw new Error(`join refused: ${JSON.stringify(fx)}`);
    return bind.player;
  }

  /** Join `n` players named a, b, c… with distinct colors. */
  joinMany(n: number): string[] {
    const colors = ['red', 'orange', 'yellow', 'lime', 'green', 'teal', 'sky', 'blue', 'purple', 'pink', 'brown', 'slate'];
    return Array.from({ length: n }, (_, i) => this.join(String.fromCharCode(97 + i), colors[i]!));
  }

  intent(player: string, intent: GameIntent): Effect[] {
    return this.step({ kind: 'intent', conn: `conn-${player}`, player, intent });
  }

  /** Move the clock and fire the alarm. */
  advance(ms: number): Effect[] {
    this.now += ms;
    return this.step({ kind: 'tick' });
  }

  /** Move the clock to the pending alarm and fire it. */
  fireNext(): Effect[] {
    const at = nextDeadline(this.state);
    if (at === null) throw new Error('no deadline pending');
    this.now = Math.max(this.now, at);
    return this.step({ kind: 'tick' });
  }

  offline(player: string): Effect[] {
    return this.step({ kind: 'presence', player, connected: false });
  }

  online(player: string): Effect[] {
    return this.step({ kind: 'presence', player, connected: true });
  }

  /** Answer the most recent `dealWord` effect. */
  deal(entry: WordEntry = WORD): Effect[] {
    const req = [...this.effects].reverse().find((e) => e.type === 'dealWord');
    if (!req || req.type !== 'dealWord') throw new Error('no dealWord effect');
    return this.step({ kind: 'wordDealt', roundNo: req.roundNo, entry });
  }

  /** host:start then deal: the room is in the briefing. */
  start(host: string, entry: WordEntry = WORD): void {
    this.intent(host, { type: 'host:start' });
    this.deal(entry);
  }

  /** Connected roster players who have not drawn yet. */
  private pendingRoster(has: (id: string) => boolean): string[] {
    const round = this.state.round;
    if (!round) throw new Error('no round');
    return round.roster.filter((id) => this.state.players.find((p) => p.id === id)!.presence.connected && !has(id));
  }

  /** Every connected roster player who has not drawn submits `STROKES`. */
  drawAll(): void {
    for (const id of this.pendingRoster((id) => id in this.state.round!.drawings)) {
      this.intent(id, { type: 'draw:done', strokes: STROKES });
    }
  }

  /**
   * Every connected roster player who has not locked votes and locks; by
   * default for the next card after their own (never themselves).
   */
  voteAll(pick?: (voter: string) => string): void {
    for (const id of this.pendingRoster((id) => this.state.round!.locked.includes(id))) {
      this.intent(id, { type: 'vote:set', targetId: pick ? pick(id) : this.nextCard(id) });
      this.intent(id, { type: 'vote:lock' });
    }
  }

  /** The card after `id`'s in slideshow order (any card for a player without one). */
  nextCard(id: string): string {
    const cards = this.state.round!.cards!;
    return cards[(cards.indexOf(id) + 1) % cards.length]!;
  }

  get phase(): string {
    return this.state.phase.name;
  }

  get faker(): string {
    if (!this.state.round) throw new Error('no round');
    return this.state.round.faker;
  }

  publicJson(): string {
    return JSON.stringify(projectPublic(this.state));
  }

  privateOf(player: string) {
    return projectPrivate(this.state, player);
  }

  errors(): string[] {
    return this.last.flatMap((e) => (e.type === 'send' && e.msg.type === 'error' ? [e.msg.code] : []));
  }
}

/**
 * While `scrubbed` nobody holds a round secret (stage 3.6.2), and public
 * state is the same whoever the faker was and whatever the word (3.6.1).
 */
export function checkScrubbedSecretless(s: RoomState): string[] {
  const problems: string[] = [];
  if (s.phase.name !== 'scrubbed') problems.push(`phase is ${s.phase.name}`);
  for (const p of s.players) if (projectPrivate(s, p.id)?.round !== null) problems.push(`${p.id} has a round view`);
  const base = JSON.stringify(projectPublic(s));
  for (const f of s.round?.roster ?? []) {
    const variant: RoomState = { ...s, rng: { s: 99 }, round: { ...s.round!, faker: f, word: s.round!.word ? OTHER_WORD : null } };
    if (JSON.stringify(projectPublic(variant)) !== base) problems.push(`public differs with faker ${f}`);
  }
  return problems;
}
