/**
 * The room state the reducer owns (stage 3.2): SPEC §14's persisted list
 * plus presence (decision 0006 item 2). It is plain JSON, so `RoomDO` can
 * store it whole and rebuild everything after hibernation; every deadline is
 * an absolute epoch-ms number inside it (harness/AGENTS.md §5).
 *
 * Secret fields: `round.word`, `round.faker`, `rng`, `usedWords`, `bag`,
 * every `token` and each rejoin request's `conn` and `token`. Of the projections, only `projectPrivate` reads the first two and the token;
 * the rest never leave the room. Stroke data is never here — only drawing
 * references (decisions 0006, 0009).
 */

import type { Difficulty, DifficultySetting } from '../difficulty-bag';
import { CYCLES_DEFAULT, type GameProgress } from '../game-length';
import type { WordEntry } from '../guess';
import { rngFromSeed, type RngState } from '../rng';
import type { PlayerId } from '../scoring';
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
   * TODO(3b): a stub so the draw phase has somewhere to end. Unit 3b replaces
   * it with the real slideshow (card set, order, end time, voting).
   */
  | { readonly name: 'slideshow'; readonly startsAt: number };

export type PhaseName = Phase['name'];

/** Where a submitted drawing's strokes live; the strokes themselves never enter state. */
export interface DrawingRef {
  /** The adapter's storage key, from `drawingKey`. */
  readonly key: string;
  /** The adapter confirmed the store (`drawingStored` input). */
  readonly stored: boolean;
}

export interface Round {
  /** Rounds started this game, cancelled ones included (1-based). */
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
   * connected at any moment of each phase this round has entered. 3b reads
   * it for the voting window (0007 item 6).
   */
  readonly connectedDuring: Readonly<Partial<Record<PhaseName, readonly PlayerId[]>>>;
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
  /** Seeded at room creation; every random choice advances it (2.1, 0020 item 5: never public). */
  readonly rng: RngState;
  /** The first player to join (the creator, §3) until a claim moves it (0010). */
  readonly hostId: PlayerId | null;
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

/** A fresh room (stage 4.2 creates one per code). `seed` comes from a CSPRNG in the adapter. */
export function createRoom(code: string, seed: number, now: number): RoomState {
  return {
    schema: 1,
    code,
    rng: rngFromSeed(seed),
    hostId: null,
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
