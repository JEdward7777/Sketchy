/**
 * The briefing envelope (stage 8.3, `SPEC.md` §4 and §12): press and hold
 * to read, let go to hide. Pure state, so the unit leg can pin every way a
 * hold ends.
 *
 * - One pointer holds it at a time; a second finger changes nothing, and
 *   only the holding pointer's release closes it.
 * - A cancelled pointer, a lost pointer capture, the window losing focus
 *   and the page being hidden all close it at once (8.3.1): a phone handed
 *   to a neighbour or locked mid-hold never stays open.
 * - The keyboard can hold it too (Space or Enter held down), for players
 *   who do not use touch.
 *
 * The letter's text is produced only while held (`envelopeLetter`), and
 * the screen renders it only then, so the word or role is never in the
 * DOM of a closed envelope (8.3.3).
 */

import type { PrivateRound } from '../../shared/core/views';

export type EnvelopeEvent =
  | { readonly type: 'press'; readonly pointerId: number }
  | { readonly type: 'release'; readonly pointerId: number }
  | { readonly type: 'keyDown' }
  | { readonly type: 'keyUp' }
  /** Pointer cancel, lost capture, blur, page hidden, or the round's view went away. */
  | { readonly type: 'cancel' };

export interface EnvelopeState {
  /** The pointer holding it, if any. */
  readonly pointerId: number | null;
  /** A key is holding it. */
  readonly key: boolean;
}

export const CLOSED: EnvelopeState = { pointerId: null, key: false };

export function isOpen(s: EnvelopeState): boolean {
  return s.pointerId !== null || s.key;
}

export function envelopeReducer(s: EnvelopeState, e: EnvelopeEvent): EnvelopeState {
  switch (e.type) {
    case 'press':
      return s.pointerId === null ? { ...s, pointerId: e.pointerId } : s;
    case 'release':
      return s.pointerId === e.pointerId ? { ...s, pointerId: null } : s;
    case 'keyDown':
      return s.key ? s : { ...s, key: true };
    case 'keyUp':
      return s.key ? { ...s, key: false } : s;
    case 'cancel':
      return isOpen(s) ? CLOSED : s;
  }
}

/** The faker's line (§4). Tests search every DOM for it outside a held envelope. */
export const FAKER_LINE = 'You are the faker!';

export interface Letter {
  readonly category: string;
  /** The small heading above the big line. */
  readonly kicker: string;
  /** The word, or the faker line. */
  readonly line: string;
  readonly hint: string;
}

/** What the open envelope says (§4): category and word, or category and "You are the faker!". */
export function envelopeLetter(round: PrivateRound): Letter {
  if (round.role === 'faker') {
    return {
      category: round.category,
      kicker: 'Your cover story',
      line: FAKER_LINE,
      hint: 'Nobody told you the word. Draw something that fits the category and blend in.',
    };
  }
  return {
    category: round.category,
    kicker: 'The secret word',
    line: round.word,
    hint: 'Draw it clearly enough for your fellow agents, vaguely enough to fool the faker.',
  };
}
