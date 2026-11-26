/**
 * The reveal slideshow and free browse (stage 3.3.3): SPEC §4 phases 3–4,
 * §8, decisions 0007 items 2, 6 and 7, 0015, 0016 and 0019 items 4–5.
 *
 * - The slideshow starts when the draw ends. Its cards are the roster minus
 *   anyone removed by then, fixed from that moment (0007 item 7, 0019
 *   item 5), in a fresh random order (0007 item 2) drawn from `orderRng`,
 *   never from the faker's generator (see `RoomState.orderRng`). It ends at
 *   `start + cards × 2 × perSlide` (§8, `slideshowEnd`).
 * - Free browse runs until slideshow end + the vote timer (§8).
 * - Voting (`vote:set`, `vote:lock`) is open in both. Voters are roster
 *   players; a target is any card holder but the voter (0015, 0019 item 5).
 *   A selection can change until locked; a lock is final (§4).
 * - Once every connected roster player has locked, voting ends at once,
 *   mid-slideshow included (0016); `settle` (reduce.ts) checks it.
 * - Unmask follows: a short fixed beat with the faker public (§4 phase 5).
 *
 * The voting window for 0003 item 2 is the slideshow plus browse (0007
 * item 6), read from `connectedDuring` by `presentInVotingWindow`.
 */

import type { PlayerIntent } from '../protocol';
import { shuffle } from '../rng';
import { slideshowEnd } from '../slideshow';
import { sendError, type Fx } from './io';
import { UNMASK_BEAT_MS } from './rules';
import { currentTimers, enterPhase, findPlayer, isConnected, type ConnId, type PlayerId, type RoomState } from './state';

/** The draw is over at `at` (everyone connected done, or submissions closed): start the slideshow. */
export function startSlideshow(state: RoomState, at: number): RoomState {
  const round = state.round;
  if (!round) throw new Error('startSlideshow without a round');
  const live = round.roster.filter((id) => !findPlayer(state, id)?.removed);
  const order = shuffle(state.orderRng, live);
  const endsAt = slideshowEnd(at, currentTimers(state).perSlideMs, order.value.length);
  return enterPhase(
    { ...state, orderRng: order.state, round: { ...round, cards: order.value } },
    { name: 'slideshow', startsAt: at, endsAt },
  );
}

/** The second pass ended at `at`: free browse runs for the vote timer (§8). */
export function startBrowse(state: RoomState, at: number): RoomState {
  return enterPhase(state, { name: 'browse', endsAt: at + currentTimers(state).voteMs });
}

/** Voting is over at `at` (timer, or everyone connected locked, 0016): the faker is shown. */
export function startUnmask(state: RoomState, at: number): RoomState {
  const round = state.round;
  if (!round) throw new Error('startUnmask without a round');
  return enterPhase({ ...state, round: { ...round, unmasked: true } }, { name: 'unmask', endsAt: at + UNMASK_BEAT_MS });
}

export function votingOpen(state: RoomState): boolean {
  return state.phase.name === 'slideshow' || state.phase.name === 'browse';
}

/** Every connected roster player has locked a vote (0016 item 2; inside the blip grace counts as connected). */
export function everyoneConnectedLocked(state: RoomState): boolean {
  const round = state.round;
  if (!round) return false;
  return round.roster.every((id) => !isConnected(state, id) || round.locked.includes(id));
}

/** Connected at any moment of the slideshow or free browse (0007 item 6). */
export function presentInVotingWindow(state: RoomState, id: PlayerId): boolean {
  const during = state.round?.connectedDuring ?? {};
  return (during.slideshow ?? []).includes(id) || (during.browse ?? []).includes(id);
}

/** Checks shared by both vote intents: true, with the error sent, when this voter may not act now. */
function refuseVoter(state: RoomState, conn: ConnId, player: PlayerId, fx: Fx): boolean {
  const round = state.round;
  if (!votingOpen(state) || !round) return (sendError(fx, conn, 'wrong_phase', 'voting is not open'), true);
  if (!round.roster.includes(player)) return (sendError(fx, conn, 'not_in_round', 'you are waiting for the next round'), true);
  if (round.locked.includes(player)) return (sendError(fx, conn, 'vote_locked', 'your vote is locked in'), true);
  return false;
}

function setVote(state: RoomState, conn: ConnId, player: PlayerId, target: PlayerId, fx: Fx): RoomState {
  if (refuseVoter(state, conn, player, fx)) return state;
  const round = state.round!;
  // Any card holder but yourself (§4, 0015 item 1, 0019 item 5).
  if (target === player || !round.cards!.includes(target)) {
    return (sendError(fx, conn, 'bad_target', 'pick another agent with a drawing'), state);
  }
  return { ...state, round: { ...round, votes: { ...round.votes, [player]: target } } };
}

function lockVote(state: RoomState, conn: ConnId, player: PlayerId, fx: Fx): RoomState {
  if (refuseVoter(state, conn, player, fx)) return state;
  const round = state.round!;
  if (!(player in round.votes)) return (sendError(fx, conn, 'no_vote', 'pick a suspect first'), state);
  return { ...state, round: { ...round, locked: [...round.locked, player] } };
}

/** `vote:set` and `vote:lock`; null for intents another module handles. */
export function voteIntent(state: RoomState, conn: ConnId, player: PlayerId, intent: PlayerIntent, fx: Fx): RoomState | null {
  switch (intent.type) {
    case 'vote:set':
      return setVote(state, conn, player, intent.targetId, fx);
    case 'vote:lock':
      return lockVote(state, conn, player, fx);
    default:
      return null;
  }
}
