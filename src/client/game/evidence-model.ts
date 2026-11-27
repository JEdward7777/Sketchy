/**
 * The evidence screens' pure logic (phase 9, `SPEC.md` §4 phases 3–4, §7,
 * §8): which slide is up, how far the slideshow has run, what each card
 * shows, and what this player may do with their vote. No DOM, so the unit
 * leg pins it.
 *
 * The slide comes from the public `slideshow {startsAt, perSlideMs}` and
 * the measured clock offset through the shared `slideIndex`, never from a
 * per-slide message (harness/AGENTS.md §5). While the room is paused the
 * slideshow stands at `paused.since` (decision 0011); on resume the room
 * moves `startsAt` by the pause, so the same formula picks up where it
 * stopped.
 */

import type { PublicRound } from '../../shared/core/views';
import type { ErrorCode } from '../../shared/protocol';
import { SLIDESHOW_PASSES, slideIndex } from '../../shared/slideshow';
import type { Stroke } from '../../shared/stroke-codec';
import type { DrawingBuffer } from '../net/drawing-buffer';
import type { Paused } from './countdown';

export interface SlideshowTiming {
  readonly startsAt: number;
  readonly perSlideMs: number;
}

export interface SlideView {
  /** Index into `round.cards`. */
  readonly card: number;
  /** 0 or 1. */
  readonly pass: number;
  /** Slide number over both passes, 0-based: `pass × cards + card`. */
  readonly slide: number;
  readonly total: number;
  /** How far through this slide, 0–1. */
  readonly within: number;
  /** Milliseconds until the next slide (or the end), for the re-render timer. */
  readonly untilNext: number;
  readonly status: 'before' | 'showing' | 'ended';
}

/**
 * The slide on screen at server time `now`. Before `startsAt` (a clock a
 * little behind) it holds the first slide at 0; after the end (browse not
 * yet arrived) it holds the last one, full.
 */
export function slideView(t: SlideshowTiming, cards: number, now: number, paused: Paused | null): SlideView {
  const total = cards * SLIDESHOW_PASSES;
  if (cards === 0) return { card: 0, pass: 0, slide: 0, total: 0, within: 0, untilNext: Infinity, status: 'ended' };
  const at = paused ? paused.since : now;
  const pos = slideIndex(at, t.startsAt, t.perSlideMs, cards);
  const frozen = paused !== null;
  if (pos.status === 'before') {
    return { card: 0, pass: 0, slide: 0, total, within: 0, untilNext: frozen ? Infinity : t.startsAt - at, status: 'before' };
  }
  if (pos.status === 'ended') {
    return { card: cards - 1, pass: SLIDESHOW_PASSES - 1, slide: total - 1, total, within: 1, untilNext: Infinity, status: 'ended' };
  }
  const slide = pos.pass * cards + pos.card;
  const into = at - (t.startsAt + slide * t.perSlideMs);
  return {
    card: pos.card,
    pass: pos.pass,
    slide,
    total,
    within: Math.min(1, Math.max(0, into / t.perSlideMs)),
    untilNext: frozen ? Infinity : t.perSlideMs - into,
    status: 'showing',
  };
}

export type CardContent =
  /** The artist's strokes are here. */
  | { readonly kind: 'drawing'; readonly strokes: readonly Stroke[] }
  /** Filed (in `round.done`), but its `drawing` frame has not arrived yet. */
  | { readonly kind: 'loading' }
  /** A card holder who never filed a drawing: "Agent went dark" (§7). */
  | { readonly kind: 'dark' };

/** What the card for `playerId` shows. Strokes from another round's buffer never count. */
export function cardContent(round: Pick<PublicRound, 'no' | 'done'>, playerId: string, drawings: DrawingBuffer | null): CardContent {
  if (!round.done.includes(playerId)) return { kind: 'dark' };
  const strokes = drawings && drawings.roundNo === round.no ? drawings.byPlayer[playerId] : undefined;
  return strokes ? { kind: 'drawing', strokes } : { kind: 'loading' };
}

export type VoteRound = Pick<PublicRound, 'roster' | 'cards' | 'votes' | 'locked'>;

export interface MyVote {
  /** On the roster this round: only roster players vote (the faker included, §4). */
  readonly canVote: boolean;
  /** Who this player has picked, if anyone. */
  readonly target: string | null;
  readonly locked: boolean;
}

export function myVote(round: VoteRound, you: string): MyVote {
  return {
    canVote: round.roster.includes(you),
    target: round.votes[you] ?? null,
    locked: round.locked.includes(you),
  };
}

/** Can this player vote for `target` now? Any card holder but yourself (0015), until locked (§4). */
export function canVoteFor(round: VoteRound, you: string, target: string): boolean {
  const me = myVote(round, you);
  return me.canVote && !me.locked && target !== you && (round.cards ?? []).includes(target);
}

/** The card holders this player may accuse, in card order: never themselves (§4, 0015). */
export function voteTargets(round: VoteRound, you: string): readonly string[] {
  return (round.cards ?? []).filter((id) => id !== you);
}

export interface VoteChip {
  readonly voter: string;
  readonly locked: boolean;
}

/** Who is voting for `target`, live (§4: votes are public), in roster order. */
export function votesFor(round: VoteRound, target: string): readonly VoteChip[] {
  return round.roster.filter((v) => round.votes[v] === target).map((voter) => ({ voter, locked: round.locked.includes(voter) }));
}

/**
 * "2 of 3 locked": out of the roster players who still count for the early
 * end (0016: connected ones), plus anyone who locked before dropping.
 */
export function lockCount(round: VoteRound, connected: (id: string) => boolean): { readonly locked: number; readonly of: number } {
  const counted = round.roster.filter((id) => connected(id) || round.locked.includes(id));
  return { locked: round.locked.filter((id) => counted.includes(id)).length, of: counted.length };
}

/** Whether a lock this device sent is still unanswered: true until the state shows it locked or an error arrives after it. */
export interface LockSent {
  /** `GameError.n` when it was sent; an error with a higher `n` answers it. */
  readonly errorN: number;
}
export function lockPending(sent: LockSent | null, locked: boolean, errorN: number): boolean {
  return sent !== null && !locked && errorN <= sent.errorN;
}

/** A refusal worth showing: `vote_locked` for a player whose lock already shows is just a double tap. */
export function showVoteError(code: ErrorCode, locked: boolean): boolean {
  return !(code === 'vote_locked' && locked);
}

/** The browse card after a step of `delta`, wrapping at both ends. */
export function stepCard(index: number, delta: number, cards: number): number {
  if (cards <= 0) return 0;
  return (((index + delta) % cards) + cards) % cards;
}

/** A horizontal swipe: at least `SWIPE_MIN_PX` sideways and more sideways than down. Returns the step, or 0. */
export const SWIPE_MIN_PX = 40;
export function swipeStep(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

/** The voting refusals this screen explains, in the spy voice; anything else gets the generic text. */
const VOTE_ERRORS: Partial<Record<ErrorCode, string>> = {
  bad_target: "You can't accuse that agent. Pick someone else with a card.",
  vote_locked: 'Your vote is locked in. No take-backs, agent.',
  no_vote: 'Pick a suspect before you lock in.',
  paused: 'The mission is paused.',
  wrong_phase: 'Voting just closed.',
  not_in_round: "You're on deck this round, so you can't vote.",
};

export function voteErrorText(code: ErrorCode): string | null {
  return VOTE_ERRORS[code] ?? null;
}

/** Device pixels per CSS pixel, capped: past 3 a canvas costs memory and looks no sharper. */
export const MAX_DPR = 3;

/**
 * The backing store in device pixels for a canvas whose layout box is
 * `cssW × cssH`. Layout sizes (clientWidth, ResizeObserver's content box)
 * ignore CSS transforms, so the slide-in's scale never shrinks it.
 */
export function backingSize(cssW: number, cssH: number, dpr: number): { w: number; h: number } {
  const d = Math.min(dpr || 1, MAX_DPR);
  return { w: Math.max(1, Math.round(cssW * d)), h: Math.max(1, Math.round(cssH * d)) };
}
