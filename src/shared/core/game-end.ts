/**
 * Host continue points, the end of a round, game length and the end of the
 * game (stages 3.3.4–3.3.5): SPEC §4 phase 7 and "Final results", decisions
 * 0004, 0007 item 4, 0010, 0011, 0014 item 2, 0017, 0019 and 0020.
 *
 * - `host:next {seq}` continues the briefing (into the draw), round results
 *   (into the next round, or final results once `totalRounds` rounds are
 *   complete, 0020 item 2) and final results (Play again, into the lobby).
 *   A `seq` from a phase the room has left is ignored, so a duplicate tap
 *   never skips a phase (0004 rule 6).
 * - `host:hold` and `host:narration` hold the 0004 fill on the briefing and
 *   round results; they are no-ops elsewhere and from anyone but the host.
 * - `host:end` ends the game from any phase but the lobby and final results
 *   (0011 item 3: also while paused). A round not yet scored is dropped: no
 *   points, nothing revealed that was still secret.
 * - Play again (0014 item 2): back to the lobby with every player; scores,
 *   game length and the used-word list reset; settings editable again.
 *   Removed players stay removed, keeping their seat and color (0019).
 */

import { isGameOver } from '../game-length';
import type { PlayerIntent } from '../protocol';
import { holdAuto, narrateAuto } from './auto-continue';
import { sendError, type Fx } from './io';
import { startDraw, startRound } from './round';
import { enterPhase, type ConnId, type PlayerId, type RoomState } from './state';

/** Round results are over at `at`: the next round, or final results when the game length is reached. */
export function afterResults(state: RoomState, at: number, fx: Fx): RoomState {
  if (state.progress && isGameOver(state.progress)) return toFinal(state);
  return startRound(state, at, fx);
}

/** Final results (§4). A pause ends with the game. */
function toFinal(state: RoomState): RoomState {
  return enterPhase({ ...state, pause: null }, { name: 'final' });
}

/** Play again (0014 item 2): the lobby, same room and players, scores reset. */
function playAgain(state: RoomState, fx: Fx): RoomState {
  if (state.round) fx.push({ type: 'clearDrawings', roundNo: state.round.no });
  return {
    ...state,
    players: state.players.map((p) => (p.score === 0 ? p : { ...p, score: 0 })),
    usedWords: [],
    progress: null,
    round: null,
    pause: null,
    phase: { name: 'lobby' },
    phaseSeq: state.phaseSeq + 1,
  };
}

/** `host:end`: final results now (0011 item 3: the host can end a paused game). */
function endGame(state: RoomState, conn: ConnId, fx: Fx): RoomState {
  const name = state.phase.name;
  if (name === 'lobby' || name === 'final') return (sendError(fx, conn, 'wrong_phase', 'no game to end'), state);
  return toFinal(state);
}

function next(state: RoomState, conn: ConnId, seq: number, now: number, fx: Fx): RoomState {
  // 0004 rule 6: a continue tapped in a phase the room has left is a no-op.
  if (seq !== state.phaseSeq) return state;
  if (state.pause) return (sendError(fx, conn, 'paused', 'the game is paused'), state);
  switch (state.phase.name) {
    case 'briefing':
      return startDraw(state, now);
    case 'results':
      return afterResults(state, now, fx);
    case 'final':
      return playAgain(state, fx);
    default:
      return (sendError(fx, conn, 'wrong_phase', 'nothing to continue'), state);
  }
}

/** Host continue intents and `host:end`; null for intents another module handles. */
export function hostIntent(state: RoomState, conn: ConnId, player: PlayerId, intent: PlayerIntent, now: number, fx: Fx): RoomState | null {
  const isHost = state.hostId === player;
  switch (intent.type) {
    case 'host:next':
      if (!isHost) return (sendError(fx, conn, 'not_host', 'only the host can continue'), state);
      return next(state, conn, intent.seq, now, fx);
    case 'host:end':
      if (!isHost) return (sendError(fx, conn, 'not_host', 'only the host can end the game'), state);
      return endGame(state, conn, fx);
    case 'host:hold':
    case 'host:narration': {
      // Only the host's own taps and narrator count; elsewhere they are no-ops (0004, 0017).
      const phase = state.phase;
      if (!isHost || state.pause || (phase.name !== 'briefing' && phase.name !== 'results')) return state;
      const auto = intent.type === 'host:hold' ? holdAuto(phase.auto, now) : narrateAuto(phase.auto, intent.speaking, now);
      return { ...state, phase: { ...phase, auto } };
    }
    default:
      return null;
  }
}
