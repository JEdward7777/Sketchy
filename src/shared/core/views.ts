/**
 * What clients see (stage 3.1): the broadcast `PublicState` and the
 * per-socket `PrivateView`. Built from the room state by `projectPublic` and
 * `projectPrivate` (src/shared/core/project.ts). Reference:
 * harness/reference/protocol.md.
 *
 * Secrecy (SPEC §14, harness/AGENTS.md §5): nothing in `PublicState` may
 * depend on the word, the faker or the RNG state before unmask, and no player
 * token is ever in it. Stroke data is in neither view (decisions 0006, 0009).
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
  /** Unit 3b stub: the slideshow has started; its card set and timing arrive with 3.3.3. */
  | { readonly name: 'slideshow'; readonly startsAt: number };

export interface PublicRound {
  /** Rounds started this game, cancelled ones included (1-based). */
  readonly no: number;
  /** The players seated for this round (3.2), in room order. */
  readonly roster: readonly PlayerId[];
  /** Public to everyone, the faker included (§6); null until the word is dealt. */
  readonly category: string | null;
  /** Roster players who have submitted a drawing, in roster order. */
  readonly done: readonly PlayerId[];
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
  /** Null unless this player is on the roster of a round whose word is dealt. */
  readonly round: PrivateRound | null;
}
