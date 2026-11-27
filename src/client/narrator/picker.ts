/**
 * What the narrator says, and when (stage 12.1.1, `SPEC.md` §10). Pure, so
 * the unit leg pins it.
 *
 * Public state only. Every function here takes `PublicState` and nothing
 * else about the room: never the device's `private` view, so the same public
 * state gives the same line on the faker's phone and on an agent's, and a
 * narrator can never say the word before `round.result` makes it public, or
 * name the faker before `round.faker` does (unmask). This file must not
 * import `PrivateView`/`PrivateRound`; test/unit/client/narrator.test.ts
 * checks that.
 *
 * Variety: `PhrasePicker` deals each bank as a shuffled deck, so every line
 * plays once before any repeats, and a redeal never starts with the line
 * that just played (after confess_n_guess's `announcer.ts`).
 */

import type { PublicState } from '../../shared/core/views';
import { countedVotes } from '../../shared/scoring';
import { TIMER_PRESETS, type TimerSettings } from '../../shared/timers';
import { BANKS, type BankName, type LineVars } from './phrases';

/** The moments the narrator speaks. `drawLast` is timed by the caller, not a state change. */
export type NarrationEvent =
  | 'gameStart'
  | 'briefing'
  | 'drawStart'
  | 'drawLast'
  | 'slideshow'
  | 'browse'
  | 'unmask'
  | 'guess'
  | 'judging'
  | 'results'
  | 'final'
  | 'scrubbed'
  | 'paused'
  | 'resumed'
  | 'lobbyReturn'
  | 'toggleOn';

/** When the draw's "ten seconds" line plays, before the draw's `endsAt`. */
export const DRAW_LAST_MS = 10_000;
/** Draws shorter than this get no "ten seconds" line: it would land right on top of "draw now". */
export const DRAW_LAST_MIN_DRAW_MS = 2 * DRAW_LAST_MS;
/** A guess is the player's own text: only this much of it is read out. */
export const GUESS_SPOKEN_MAX = 40;

/** A no-repeat shuffle per bank. `random` returns [0, 1), like `Math.random`. */
export class PhrasePicker {
  private readonly decks = new Map<string, number[]>();
  private readonly last = new Map<string, number>();

  constructor(private readonly random: () => number) {}

  /** The next index for `bank` out of `size` entries. */
  next(bank: string, size: number): number {
    if (size <= 1) return 0;
    let deck = this.decks.get(bank);
    if (!deck || deck.length === 0) {
      deck = this.shuffled(size);
      // The deck is dealt from the end: never open a fresh deal with the line that just played.
      if (deck[deck.length - 1] === this.last.get(bank)) deck.unshift(deck.pop()!);
      this.decks.set(bank, deck);
    }
    const i = deck.pop()!;
    this.last.set(bank, i);
    return i;
  }

  /** One of `items`, uniformly. */
  any<T>(items: readonly T[]): T | undefined {
    return items[Math.floor(this.random() * items.length)];
  }

  private shuffled(n: number): number[] {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
}

/**
 * The state the next comparison starts from: the `dealing` beat (§6, the
 * word being fetched) is skipped, so lobby → dealing → briefing reads as
 * the game starting, and the briefing line comes once the category is known.
 */
export function baseline(prev: PublicState | null, next: PublicState): PublicState | null {
  return next.phase.name === 'dealing' ? prev : next;
}

/** Which moment `prev` → `next` is, if any. No line for the first state a device sees (a join or reload mid-game). */
export function eventFor(prev: PublicState | null, next: PublicState): NarrationEvent | null {
  if (!prev) return null;
  const phase = next.phase.name;
  const moved = prev.phase.name !== phase || (prev.round?.no ?? 0) !== (next.round?.no ?? 0);
  if (moved) {
    switch (phase) {
      case 'dealing':
        return null;
      case 'lobby':
        return 'lobbyReturn';
      case 'briefing':
        return prev.phase.name === 'lobby' ? 'gameStart' : 'briefing';
      case 'draw':
        return 'drawStart';
      case 'slideshow':
      case 'browse':
      case 'unmask':
      case 'guess':
      case 'judging':
      case 'results':
      case 'final':
      case 'scrubbed':
        return phase;
    }
  }
  if (!prev.paused && next.paused) return 'paused';
  if (prev.paused && !next.paused) return 'resumed';
  return null;
}

/** The line for `prev` → `next`, or null when nothing happened worth saying. */
export function narrate(prev: PublicState | null, next: PublicState, picker: PhrasePicker): string | null {
  const event = eventFor(prev, next);
  return event ? lineFor(event, next, picker) : null;
}

/** The game's timers as the lobby set them (§8). */
function timers(state: PublicState): TimerSettings {
  const t = state.settings.timers;
  return t === 'custom' ? (state.settings.custom ?? TIMER_PRESETS.normal) : TIMER_PRESETS[t];
}

function nameOf(state: PublicState, id: string | null | undefined): string {
  return state.players.find((p) => p.id === id)?.name ?? 'our mystery agent';
}

function joinNames(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function pointsText(n: number): string {
  return `${n} ${n === 1 ? 'point' : 'points'}`;
}

/** Top score among players still in the game (removed ones keep a greyed score, 0019, but are not leaders). */
function leaders(state: PublicState): { names: string[]; score: number } {
  const live = state.players.filter((p) => !p.removed);
  const score = Math.max(0, ...live.map((p) => p.score));
  return { names: live.filter((p) => p.score === score).map((p) => p.name), score };
}

/**
 * The faker drew the most counted votes (a tie for most counts as caught),
 * from the public votes at unmask. Uses the §5 `countedVotes` filter (no
 * self-votes, targets with a card); who was absent for the whole voting
 * window is not public, so every voter is taken as present.
 */
export function fakerCaught(state: PublicState): boolean {
  const round = state.round;
  const faker = round?.faker;
  if (!round || !faker) return false;
  const cards = new Set(round.cards ?? round.roster);
  const roster = round.roster.map((id) => ({ id, presentInVotingWindow: true, hasCard: cards.has(id) }));
  const tally = new Map<string, number>();
  for (const target of countedVotes(roster, faker, round.votes).values()) tally.set(target, (tally.get(target) ?? 0) + 1);
  const theirs = tally.get(faker) ?? 0;
  return theirs > 0 && [...tally.values()].every((n) => n <= theirs);
}

/** Every value a line may use, from the public state alone. */
function vars(state: PublicState, picker: PhrasePicker): LineVars {
  const round = state.round;
  const seated = state.players.filter((p) => !p.removed && (round ? round.roster.includes(p.id) : true));
  const lead = leaders(state);
  const t = timers(state);
  const secondsFor = (): number => {
    switch (state.phase.name) {
      case 'draw':
        return t.drawMs / 1000;
      case 'browse':
        return t.voteMs / 1000;
      default:
        return t.guessMs / 1000;
    }
  };
  return {
    agent: picker.any(seated)?.name ?? 'Smith',
    category: round?.category ?? 'classified',
    seconds: String(Math.round(secondsFor())),
    // The faker only once the room has made it public (unmask on).
    faker: round?.faker ? nameOf(state, round.faker) : 'our mystery agent',
    guess: (round?.guess ?? '').slice(0, GUESS_SPOKEN_MAX),
    // The word only once the guess has resolved and the room has made it public.
    word: round?.result?.word ?? 'classified',
    leader: joinNames(lead.names),
    points: pointsText(lead.score),
  };
}

function say(bank: BankName, v: LineVars, picker: PhrasePicker): string {
  const lines = BANKS[bank];
  return lines[picker.next(bank, lines.length)]!(v);
}

/** The line for `event` in `state`. */
export function lineFor(event: NarrationEvent, state: PublicState, picker: PhrasePicker): string | null {
  const v = vars(state, picker);
  const round = state.round;
  switch (event) {
    case 'unmask':
      if (!round?.faker) return null;
      return say(fakerCaught(state) ? 'unmaskCaught' : 'unmaskEscaped', v, picker);
    case 'guess':
      return round?.faker ? say('guess', v, picker) : null;
    case 'judging':
      return round?.faker && round.guess ? say('judging', v, picker) : null;
    case 'results': {
      const result = round?.result;
      if (!result) return null;
      const bank = result.correct ? 'verdictRight' : result.verdict === 'none' ? 'verdictNone' : 'verdictWrong';
      const tied = leaders(state).names.length > 1;
      return `${say(bank, v, picker)} ${say(tied ? 'standingsTied' : 'standings', v, picker)}`;
    }
    case 'final':
      return say(leaders(state).names.length > 1 ? 'finalTied' : 'final', v, picker);
    default:
      return say(event, v, picker);
  }
}

/**
 * When the draw's "ten seconds" line is due (server time), or null: not in
 * the draw, paused (deadlines are frozen; resuming re-arms them), or a draw
 * shorter than `DRAW_LAST_MIN_DRAW_MS`.
 */
export function drawLastAt(state: PublicState): number | null {
  const phase = state.phase;
  if (phase.name !== 'draw' || state.paused) return null;
  if (timers(state).drawMs < DRAW_LAST_MIN_DRAW_MS) return null;
  return phase.endsAt - DRAW_LAST_MS;
}
