/**
 * What clients see (stage 3.1): the broadcast `PublicState` and the
 * per-socket `PrivateView`. Built from the room state by `projectPublic` and
 * `projectPrivate` (src/shared/core/project.ts). Reference:
 * harness/reference/protocol.md.
 *
 * Secrecy (SPEC §14, harness/AGENTS.md §5): nothing in `PublicState` may
 * depend on the word, the faker or the RNG state before unmask, nor on the
 * word until the faker's guess is submitted or times out; no player token is
 * ever in it. Stroke data is in neither view (decisions 0006, 0009).
 */

import type { DifficultySetting } from '../difficulty-bag';
import type { PlayerId } from '../scoring';
import type { TimerChoice, TimerSettings } from '../timers';

export interface PublicPlayer {
  readonly id: PlayerId;
  readonly name: string;
  readonly color: string;
  readonly icon: string;
  /** Connected for game rules: false only once a disconnect outlasts the blip grace (0012 item 2). */
  readonly connected: boolean;
  /** Removed by the host; greyed out, color kept (0019 item 1). */
  readonly removed: boolean;
  /** In the current round's roster, or the game has not started; false = waiting to be seated (0020 item 4). */
  readonly seated: boolean;
  readonly score: number;
}

export interface PublicSettings {
  readonly difficulty: DifficultySetting;
  readonly cycles: number;
  readonly timers: TimerChoice;
  /** The Custom timers, once the host has set some (§8, decision 0022). */
  readonly custom: TimerSettings | null;
}

/** Each phase with the public times a client counts down to (epoch ms, §14). */
export type PublicPhase =
  | { readonly name: 'lobby' }
  /** A round has started and the word is being dealt (§6). */
  | { readonly name: 'dealing' }
  | {
      readonly name: 'briefing';
      /** When the briefing auto-continues (decision 0004 rule 5). */
      readonly continueAt: number;
      /** When the host's Continue fill starts (rules 2–3); `continueAt − fillFrom` is the fill length. */
      readonly fillFrom: number;
      /** The host's narrator is speaking, so the fill waits (rule 2). */
      readonly hostSpeaking: boolean;
    }
  | {
      readonly name: 'draw';
      /** The draw countdown shown to players (§8). */
      readonly endsAt: number;
      /** Submissions are accepted until here; a timeout starts the slideshow here (3.3.2). */
      readonly closesAt: number;
    }
  /** The round was cancelled (§7); the next round starts at `endsAt`. */
  | { readonly name: 'scrubbed'; readonly endsAt: number }
  /**
   * Two passes over `round.cards` (§4 phase 3). Slide `i` shows from
   * `startsAt + i × perSlideMs` (§14, `slideIndex`); `endsAt = startsAt +
   * cards × 2 × perSlideMs`. Voting is open. The room may end it early when
   * everyone connected has locked (0016).
   */
  | { readonly name: 'slideshow'; readonly startsAt: number; readonly perSlideMs: number; readonly endsAt: number }
  /** Free browse (§4 phase 4), voting open, until `endsAt` = slideshow end + vote timer. */
  | { readonly name: 'browse'; readonly endsAt: number }
  /** Votes and the faker are shown (`round.faker`); the guess opens at `endsAt`. */
  | { readonly name: 'unmask'; readonly endsAt: number }
  /** The faker types a guess until `endsAt`; no guess = wrong (§4). */
  | { readonly name: 'guess'; readonly endsAt: number }
  /** Roster non-fakers accept or reject `round.guess` until `endsAt` (decision 0013). */
  | { readonly name: 'judging'; readonly endsAt: number }
  /** Round results (§4 phase 7) with the host's 0004 continue, as on the briefing. */
  | {
      readonly name: 'results';
      readonly continueAt: number;
      readonly fillFrom: number;
      readonly hostSpeaking: boolean;
    }
  /**
   * Final results (§4): every non-removed player with shared placement
   * (1, 1, 3; decision 0007 item 4), highest first, ties in room order.
   * The host's `host:next` here is Play again.
   */
  | { readonly name: 'final'; readonly standings: readonly { readonly id: PlayerId; readonly score: number; readonly place: number }[] };

/** The round's outcome, public once the guess resolves (§4 phases 6–7, §5). */
export interface PublicRoundResult {
  readonly word: string;
  readonly correct: boolean;
  /** `auto`: matched the word (§4 normalization); `judged`: by the 0013 vote; `none`: no guess in time. */
  readonly verdict: 'auto' | 'judged' | 'none';
  readonly accepts: number;
  readonly rejects: number;
  /** Points this round for every roster player (§5). */
  readonly points: Readonly<Record<PlayerId, number>>;
  /** Counted votes received per roster player (§5, `countedVotes`). */
  readonly tally: Readonly<Record<PlayerId, number>>;
  /** The faker's points by §5 row. */
  readonly faker: { readonly undetected: number; readonly guess: number; readonly framing: number };
}

export interface PublicRound {
  /** Room-wide round number: every round started in this room, cancelled ones and earlier games included (1-based, never resets, 0027 item 4). */
  readonly no: number;
  /** The players seated for this round (3.2), in room order. */
  readonly roster: readonly PlayerId[];
  /** Public to everyone, the faker included (§6); null until the word is dealt. */
  readonly category: string | null;
  /** Roster players who have submitted a drawing, in roster order. */
  readonly done: readonly PlayerId[];
  /**
   * Slideshow and browse order (0007 item 2): the roster minus anyone
   * removed before the slideshow (0007 item 7); a card whose player has no
   * drawing is "went dark" (§7). Null before the slideshow.
   */
  readonly cards: readonly PlayerId[] | null;
  /** Live, public votes (§4): voter → target, in roster order. */
  readonly votes: Readonly<Record<PlayerId, PlayerId>>;
  /** Voters who locked in, in roster order. */
  readonly locked: readonly PlayerId[];
  /** The faker, from unmask on; null before (§14). */
  readonly faker: PlayerId | null;
  /** The faker's guess text once submitted. */
  readonly guess: string | null;
  /** Roster non-fakers who have judged the guess, in roster order (decision 0013). */
  readonly judged: readonly PlayerId[];
  /** Set once the guess resolves; the word is public from then (§4, §14). */
  readonly result: PublicRoundResult | null;
}

export interface PublicState {
  readonly code: string;
  readonly phase: PublicPhase;
  /** Increments on every phase change; `host:next` echoes it so a duplicate continue is ignored (0004 rule 6). */
  readonly seq: number;
  readonly hostId: PlayerId | null;
  /** Every player who ever joined, in join order. */
  readonly players: readonly PublicPlayer[];
  readonly settings: PublicSettings;
  /** Null in the lobby. `total = cycles × roster size at host:start` (0020 item 2). */
  readonly progress: { readonly completed: number; readonly total: number } | null;
  readonly round: PublicRound | null;
  /**
   * Set while fewer than 3 active players remain (§7, decision 0011). Every
   * phase time above is frozen: the time left on it is `time − since`, and
   * on resume each is re-armed from the resume instant plus that remainder.
   */
  readonly paused: { readonly since: number } | null;
  /** Players a device has asked to "Rejoin as…" mid-round, awaiting the host (0024 item 2); never who asked. */
  readonly rejoinRequests: readonly PlayerId[];
}

/** A roster player's secret for the round (§4 briefing, §14). */
export type PrivateRound =
  | { readonly no: number; readonly category: string; readonly role: 'agent'; readonly word: string }
  | { readonly no: number; readonly category: string; readonly role: 'faker' };

export interface PrivateView {
  /** Who this socket is, with the token the device keeps in localStorage (§7). */
  readonly you: { readonly id: PlayerId; readonly token: string };
  /**
   * Null unless this player is on the roster of a round whose word is dealt,
   * from the briefing until the guess is resolved (judging included, 0026
   * item 5); then the word is public in `round.result`.
   */
  readonly round: PrivateRound | null;
}
