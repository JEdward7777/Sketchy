/**
 * The faker's guess, judging and scoring (stage 3.3.4): SPEC §4 phases 5–7,
 * §5, decisions 0003, 0007 items 6–7, 0012 items 1 and 6, 0013 and 0015.
 *
 * - After the unmask beat the guess opens for the guess timer (§8). Only the
 *   faker may `guess:submit`, once. A guess that matches the word or an
 *   `alt` after normalization is accepted at once (§4, `guessMatches`); any
 *   other guess opens judging. No guess by the deadline is wrong (§4), an
 *   absent faker included (0012 item 1).
 * - Judging (0013): roster non-fakers tap accept or reject, once and final;
 *   it runs for the guess timer again from when it opens, and ends early
 *   once every connected roster non-faker has judged. Whoever judged counts;
 *   a tie, 0–0 included, accepts.
 * - The word stays out of public state and out of the faker's private view
 *   until the guess resolves (§4, §14); from then `round.result` is set and
 *   the word is public.
 * - Resolving scores the round with `scoreRound` (§5) over the roster, with
 *   each player's presence in the voting window (0003 item 2, 0007 item 6)
 *   and card (0007 item 7), adds the points, counts the round toward the
 *   game length (0020 item 2) and opens round results.
 */

import { recordRoundEnd } from '../game-length';
import { guessMatches, normalizeGuess } from '../guess';
import type { PlayerIntent } from '../protocol';
import { scoreRound } from '../scoring';
import { startAuto } from './auto-continue';
import { sendError, type Fx } from './io';
import { RESULTS_BEAT_MS } from './rules';
import { currentTimers, enterPhase, isConnected, timeBase, type ConnId, type GuessVerdict, type PlayerId, type RoomState } from './state';
import { presentInVotingWindow } from './voting';

/** The unmask beat ended at `at`: the faker's guess opens for the guess timer (§8). */
export function startGuess(state: RoomState, at: number): RoomState {
  return enterPhase(state, { name: 'guess', endsAt: at + currentTimers(state).guessMs });
}

/** Roster players other than the faker (0013 item 2). */
function judges(state: RoomState): PlayerId[] {
  const round = state.round;
  return round ? round.roster.filter((id) => id !== round.faker) : [];
}

/** Every connected roster non-faker has judged (0013 item 3; inside the blip grace counts as connected). */
export function everyoneConnectedJudged(state: RoomState): boolean {
  const round = state.round;
  if (!round) return false;
  return judges(state).every((id) => !isConnected(state, id) || id in round.judgments);
}

/**
 * Score the round and open round results, with the results beat counted
 * from `base` (the instant, or the pause start while paused).
 */
function finishRound(state: RoomState, base: number, verdict: GuessVerdict, correct: boolean): RoomState {
  const round = state.round;
  if (!round || !round.cards || !state.progress) throw new Error('finishRound outside a voted round');
  const cards = round.cards;
  const score = scoreRound({
    roster: round.roster.map((id) => ({ id, presentInVotingWindow: presentInVotingWindow(state, id), hasCard: cards.includes(id) })),
    outcome: { kind: 'completed', fakerId: round.faker, votes: round.votes, guessCorrect: correct },
  });
  const judged = Object.values(round.judgments);
  const accepts = judged.filter((a) => a).length;
  const result = {
    correct,
    verdict,
    accepts,
    rejects: judged.length - accepts,
    points: score.points,
    tally: score.tally,
    faker: score.faker!,
  };
  const players = state.players.map((p) => (p.id in score.points ? { ...p, score: p.score + score.points[p.id]! } : p));
  return enterPhase(
    { ...state, players, progress: recordRoundEnd(state.progress, 'completed'), round: { ...round, result } },
    { name: 'results', auto: startAuto(base, RESULTS_BEAT_MS) },
  );
}

/**
 * The guess or judging deadline passed at `at`: no guess is wrong (§4);
 * judging counts whoever judged, ties accepting (0013 items 2, 5).
 */
export function guessTimedOut(state: RoomState, at: number): RoomState {
  if (state.phase.name === 'guess') return finishRound(state, at, 'none', false);
  return endJudging(state, at);
}

/** Judging is over at `at` (deadline, or everyone connected judged). */
export function endJudging(state: RoomState, at: number): RoomState {
  const judged = Object.values(state.round?.judgments ?? {});
  const accepts = judged.filter((a) => a).length;
  return finishRound(state, at, 'judged', accepts >= judged.length - accepts);
}

function submitGuess(state: RoomState, conn: ConnId, player: PlayerId, text: string, now: number, fx: Fx): RoomState {
  const round = state.round;
  if (state.phase.name !== 'guess' || !round || !round.word) return (sendError(fx, conn, 'wrong_phase', 'no guess is open'), state);
  if (player !== round.faker) return (sendError(fx, conn, 'not_faker', 'only the faker guesses'), state);
  const guess = text.trim().replace(/\s+/g, ' ');
  if (normalizeGuess(guess) === '') return (sendError(fx, conn, 'bad_guess', 'type a word'), state);
  const next = { ...state, round: { ...round, guess } };
  const base = timeBase(state, now);
  if (guessMatches(guess, round.word)) return finishRound(next, base, 'auto', true);
  return enterPhase(next, { name: 'judging', endsAt: base + currentTimers(state).guessMs });
}

function judge(state: RoomState, conn: ConnId, player: PlayerId, accept: boolean, fx: Fx): RoomState {
  const round = state.round;
  if (state.phase.name !== 'judging' || !round) return (sendError(fx, conn, 'wrong_phase', 'nothing to judge'), state);
  if (!round.roster.includes(player)) return (sendError(fx, conn, 'not_in_round', 'you are waiting for the next round'), state);
  if (player === round.faker) return (sendError(fx, conn, 'not_judge', 'the faker does not judge their own guess'), state);
  if (player in round.judgments) return (sendError(fx, conn, 'already_judged', 'your verdict is in'), state);
  return { ...state, round: { ...round, judgments: { ...round.judgments, [player]: accept } } };
}

/** `guess:submit` and `guess:judge`; null for intents another module handles. */
export function guessIntent(state: RoomState, conn: ConnId, player: PlayerId, intent: PlayerIntent, now: number, fx: Fx): RoomState | null {
  if ((intent.type === 'guess:submit' || intent.type === 'guess:judge') && state.pause) {
    // 0027 item 3: defensive (no pause reaches the guess); checked first, for any sender alike.
    return (sendError(fx, conn, 'paused', 'the game is paused'), state);
  }
  switch (intent.type) {
    case 'guess:submit':
      return submitGuess(state, conn, player, intent.text, now, fx);
    case 'guess:judge':
      return judge(state, conn, player, intent.accept, fx);
    default:
      return null;
  }
}
