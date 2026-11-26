/**
 * The room state the reducer owns (stage 3.2): SPEC §14's persisted list
 * plus presence (decision 0006 item 2). It is plain JSON, so `RoomDO` can
 * store it whole and rebuild everything after hibernation; every deadline is
 * an absolute epoch-ms number inside it (harness/AGENTS.md §5).
 *
 * Secret fields: `round.word` (until the guess resolves), `round.faker`
 * (until unmask), `rng`, `orderRng`, `usedWords`, `bag`, every `token` and
 * each rejoin request's `conn` and `token`. Before those reveal points only
 * `projectPrivate` reads the word, the faker and the token; the rest never
 * leave the room. Stroke data is never here — only drawing
 * references (decisions 0006, 0009).
 */

import type { Difficulty, DifficultySetting } from '../difficulty-bag';
import { CYCLES_DEFAULT, type GameProgress } from '../game-length';
import type { WordEntry } from '../guess';
import { rngFromSeed, type RngState } from '../rng';
import type { FakerBreakdown, PlayerId } from '../scoring';
import { DEFAULT_TIMER_PRESET, timersFor, type TimerChoice, type TimerSettings } from '../timers';
import { DEFAULT_DIFFICULTY } from './rules';

export type { PlayerId } from '../scoring';

/** The adapter's id for one socket; opaque to the reducer. */
export type ConnId = string;

export interface Presence {
  /** A socket bound to this player is open (the adapter reports it). */
  readonly online: boolean;
  /**
   * Connected for game rules (§4, §7, 0003): stays true through a socket
   * close until `graceUntil` passes, so a reload is not a disconnect
   * (0012 item 2).
   */
  readonly connected: boolean;
  /** Set while offline but still `connected`: when the blip grace runs out. */
  readonly graceUntil: number | null;
}

export interface Player {
  readonly id: PlayerId;
  readonly name: string;
  readonly color: string;
  readonly icon: string;
  /** Secret to this player's devices (§7). Kept when removed (0019 item 1). */
  readonly token: string;
  /** Removed by the host (§7). Cleared when the player returns (0019 item 1). */
  readonly removed: boolean;
  readonly score: number;
  readonly presence: Presence;
}

export interface Settings {
  readonly difficulty: DifficultySetting;
  readonly cycles: number;
  readonly timers: TimerChoice;
  readonly custom: TimerSettings | null;
}

/**
 * A host "continue" point that auto-advances unless held (decision 0004).
 * Due at `max(fillFrom, speakingCapAt) + beatMs`: the fill starts at
 * `fillFrom` (pushed out by holds) and waits while the narrator speaks,
 * but never past the server-side cap `speakingCapAt`.
 */
export interface AutoContinue {
  /** When the fill would start with no holds or narration: the normal deadline is `startedAt + beatMs`. */
  readonly startedAt: number;
  readonly fillFrom: number;
  /** Non-null while the host's narrator is speaking: the latest the fill may wait for it. */
  readonly speakingCapAt: number | null;
  readonly beatMs: number;
}

export type Phase =
  | { readonly name: 'lobby' }
  /** Waiting for the adapter to answer the deal-word effect (§6, stage 5.3). */
  | { readonly name: 'dealing' }
  | { readonly name: 'briefing'; readonly auto: AutoContinue }
  /** Submissions close at `endsAt + DRAW_SUBMIT_GRACE_MS`. */
  | { readonly name: 'draw'; readonly endsAt: number }
  /** After a faker-disconnect cancel (§7); the next round starts at `endsAt`. */
  | { readonly name: 'scrubbed'; readonly endsAt: number }
  /**
   * Two passes over `round.cards`, voting open (§4 phase 3):
   * `endsAt = startsAt + cards × 2 × perSlide` (§8, `slideshowEnd`).
   */
  | { readonly name: 'slideshow'; readonly startsAt: number; readonly endsAt: number }
  /** Free browse, voting open (§4 phase 4): `endsAt` = slideshow end + vote timer. */
  | { readonly name: 'browse'; readonly endsAt: number }
  /** Votes and faker shown (§4 phase 5): a short fixed beat. */
  | { readonly name: 'unmask'; readonly endsAt: number }
  /** The faker types a guess (§4 phase 6); no guess by `endsAt` = wrong. */
  | { readonly name: 'guess'; readonly endsAt: number }
  /** Roster non-fakers accept or reject the guess (decision 0013); `endsAt` = opening + guess timer. */
  | { readonly name: 'judging'; readonly endsAt: number }
  /** Round results with the 0004 continue (§4 phase 7). */
  | { readonly name: 'results'; readonly auto: AutoContinue }
  /** Final results (§4): no deadline; the host's Play again returns to the lobby (0014 item 2). */
  | { readonly name: 'final' };

export type PhaseName = Phase['name'];

/** Where a submitted drawing's strokes live; the strokes themselves never enter state. */
export interface DrawingRef {
  /** The adapter's storage key, from `drawingKey`. */
  readonly key: string;
  /** The adapter confirmed the store (`drawingStored` input). */
  readonly stored: boolean;
}

export interface Round {
  /** Room-wide round number from `RoomState.nextRoundNo` (0027 item 4). */
  readonly no: number;
  /** Seated when the round started, fixed for the round (3.2, 0020 item 4). */
  readonly roster: readonly PlayerId[];
  readonly faker: PlayerId;
  readonly difficulty: Difficulty;
  /** Null while dealing. */
  readonly word: WordEntry | null;
  /** Roster player → their submitted drawing. Having one is "done" (§4). */
  readonly drawings: Readonly<Record<PlayerId, DrawingRef>>;
  /**
   * Per-phase connection history (0006 item 2): the roster players
   * connected at any moment of each phase this round has entered. Scoring
   * reads it for the voting window (0007 item 6, `presentInVotingWindow`).
   */
  readonly connectedDuring: Readonly<Partial<Record<PhaseName, readonly PlayerId[]>>>;
  /**
   * The slideshow cards in display order, fixed when the slideshow starts:
   * the roster minus anyone removed by then (0007 items 2 and 7, 0019
   * item 5). Null before the slideshow.
   */
  readonly cards: readonly PlayerId[] | null;
  /** Voter → selected target (§4). Every entry counts as cast when voting ends, locked or not. */
  readonly votes: Readonly<Record<PlayerId, PlayerId>>;
  /** Voters who locked in, in lock order; a locked vote is final (§4). */
  readonly locked: readonly PlayerId[];
  /** True from unmask on: the faker's identity is public (§4 phase 5). */
  readonly unmasked: boolean;
  /** The faker's submitted guess text (§4 phase 6), or null. */
  readonly guess: string | null;
  /** Judge → accept, one final tap each (decision 0013 item 4). */
  readonly judgments: Readonly<Record<PlayerId, boolean>>;
  /** Set when the guess resolves and the round is scored; from then the word is public. */
  readonly result: RoundResult | null;
}

/** How the guess was settled (§4 phase 6, decision 0013). */
export type GuessVerdict =
  /** Matched the word or an `alt` after normalization (§4 "Guess normalization"). */
  | 'auto'
  /** Went to the accept/reject vote; ties, 0–0 included, accept (0013 item 5). */
  | 'judged'
  /** No guess before the guess timer ran out: wrong (§4). */
  | 'none';

export interface RoundResult {
  readonly correct: boolean;
  readonly verdict: GuessVerdict;
  readonly accepts: number;
  readonly rejects: number;
  /** `scoreRound`'s points and tally (§5), for every roster player. */
  readonly points: Readonly<Record<PlayerId, number>>;
  readonly tally: Readonly<Record<PlayerId, number>>;
  readonly faker: FakerBreakdown;
}

/**
 * A mid-round "Rejoin as…" waiting for the host (decision 0024 item 2). The
 * requesting socket and its freshly minted token are secret to the room;
 * public state shows only which player is asked for.
 */
export interface RejoinRequest {
  readonly player: PlayerId;
  readonly conn: ConnId;
  /** Becomes the player's token if admitted (0024 item 3). */
  readonly token: string;
}

export interface RoomState {
  /** Shape version of this object in storage. */
  readonly schema: 1;
  readonly code: string;
  /**
   * Seeded at room creation; the faker pick and the Mixed bag advance it
   * (2.1, 0020 item 5: never public).
   */
  readonly rng: RngState;
  /**
   * A second, independently seeded stream for the one random choice that is
   * public before unmask: the slideshow order (0007 item 2), so the order
   * never shows the faker generator's output. Both streams also absorb
   * fresh entropy on every `reduce` call (O-10).
   */
  readonly orderRng: RngState;
  /** The first player to join (the creator, §3) until a claim moves it (0010). */
  readonly hostId: PlayerId | null;
  /**
   * The next round's number. Room-wide and never reset, Play again
   * included, so a late `wordDealt` or drawing key from an earlier game
   * never matches the current round (0027 item 4).
   */
  readonly nextRoundNo: number;
  /** Ids are `p1`, `p2`, … in join order. */
  readonly nextPlayerNo: number;
  readonly players: readonly Player[];
  readonly settings: Settings;
  /** What is left of the Mixed-difficulty bag (2.8, 0007 item 3). */
  readonly bag: readonly Difficulty[];
  /** Words dealt this game: the `exclude` list for the deal (§6, 5.3). */
  readonly usedWords: readonly string[];
  /** Null in the lobby; fixed at host:start (0020 item 2). */
  readonly progress: GameProgress | null;
  readonly phase: Phase;
  /** Increments on every phase change. */
  readonly phaseSeq: number;
  /** The current (or last) round; null in the lobby. */
  readonly round: Round | null;
  /**
   * Set while paused (0011); phase and auto-continue deadlines are frozen
   * from `since`. `waited` is set once the 0025 restart wait has elapsed (the
   * alarm at `since + RESTART_WAIT_MS` fired), so that deadline fires once.
   */
  readonly pause: { readonly since: number; readonly waited?: boolean } | null;
  /** Pending "Rejoin as…" requests, at most one per player (0024). */
  readonly rejoinRequests: readonly RejoinRequest[];
  /** Last input other than an alarm tick; the room expires `ROOM_EXPIRY_MS` after it (§14). */
  readonly lastActivityAt: number;
  readonly expired: boolean;
}

/**
 * A fresh room (stage 4.2 creates one per code). `seed` and `orderSeed` come
 * from a CSPRNG in the adapter, independently: `orderSeed` must not be
 * derived from `seed` (see `orderRng`).
 */
export function createRoom(code: string, seed: number, now: number, orderSeed: number): RoomState {
  return {
    schema: 1,
    code,
    rng: rngFromSeed(seed),
    orderRng: rngFromSeed(orderSeed),
    hostId: null,
    nextRoundNo: 1,
    nextPlayerNo: 1,
    players: [],
    settings: { difficulty: DEFAULT_DIFFICULTY, cycles: CYCLES_DEFAULT, timers: DEFAULT_TIMER_PRESET, custom: null },
    bag: [],
    usedWords: [],
    progress: null,
    phase: { name: 'lobby' },
    phaseSeq: 0,
    round: null,
    pause: null,
    rejoinRequests: [],
    lastActivityAt: now,
    expired: false,
  };
}

export function findPlayer(state: RoomState, id: PlayerId): Player | undefined {
  return state.players.find((p) => p.id === id);
}

export function updatePlayer(state: RoomState, id: PlayerId, f: (p: Player) => Player): RoomState {
  return { ...state, players: state.players.map((p) => (p.id === id ? f(p) : p)) };
}

/** The timers in force. */
export function currentTimers(state: RoomState): TimerSettings {
  return timersFor(state.settings.timers, state.settings.custom ?? undefined);
}

/**
 * Seated (0011 item 1, 0020 item 4): in the lobby everyone is; during a game
 * it is exactly membership of the current round's roster. A stored flag
 * would duplicate the roster, so it is derived.
 */
export function isSeated(state: RoomState, id: PlayerId): boolean {
  return state.round === null || state.round.roster.includes(id);
}

/** Active (0011 item 1): connected, not removed, and seated. */
export function isActive(state: RoomState, p: Player): boolean {
  return p.presence.connected && !p.removed && isSeated(state, p.id);
}

export function activeCount(state: RoomState): number {
  return state.players.filter((p) => isActive(state, p)).length;
}

export function isConnected(state: RoomState, id: PlayerId): boolean {
  return findPlayer(state, id)?.presence.connected ?? false;
}

/**
 * The instant new game deadlines (phase, auto-continue) count from. While
 * paused that is the pause start, so the resume shift (`unpause` in
 * presence.ts) re-arms them from the resume instant with their full length
 * (0011 item 3). Blip graces do not use it: they run on wall time.
 */
export function timeBase(state: RoomState, now: number): number {
  return state.pause ? state.pause.since : now;
}

/** The storage key for one player's drawing in one round. */
export function drawingKey(roundNo: number, id: PlayerId): string {
  return `${roundNo}:${id}`;
}

/** Enter a phase: bump `phaseSeq` and start that phase's connection history. */
export function enterPhase(state: RoomState, phase: Phase): RoomState {
  let round = state.round;
  if (round && phase.name !== 'lobby') {
    const present = round.roster.filter((id) => isConnected(state, id));
    round = { ...round, connectedDuring: { ...round.connectedDuring, [phase.name]: present } };
  }
  return { ...state, phase, phaseSeq: state.phaseSeq + 1, round };
}

/** Add a roster player who has just connected to the current phase's history. */
export function noteConnected(state: RoomState, id: PlayerId): RoomState {
  const round = state.round;
  if (!round || !round.roster.includes(id)) return state;
  const seen = round.connectedDuring[state.phase.name] ?? [];
  if (seen.includes(id)) return state;
  return { ...state, round: { ...round, connectedDuring: { ...round.connectedDuring, [state.phase.name]: [...seen, id] } } };
}
