/**
 * The two projections (stage 3.4): `projectPublic` for the broadcast
 * `state` message and `projectPrivate` for one player's socket.
 *
 * `projectPublic` is written field by field from an allow-list, never by
 * spreading state objects, so a secret field added to the state later cannot
 * leak by accident. Before unmask it reads nothing that depends on the word
 * (beyond its public category, §6), the faker, the RNG, the Mixed bag, the
 * used-word list or any token (stage 3.6).
 */

import { autoDue, autoFillStart } from './auto-continue';
import { DRAW_SUBMIT_GRACE_MS } from './rules';
import { findPlayer, isSeated, type Phase, type RoomState } from './state';
import type { PrivateRound, PrivateView, PublicPhase, PublicState } from './views';

function publicPhase(phase: Phase): PublicPhase {
  switch (phase.name) {
    case 'lobby':
    case 'dealing':
      return { name: phase.name };
    case 'briefing':
      return {
        name: 'briefing',
        continueAt: autoDue(phase.auto),
        fillFrom: autoFillStart(phase.auto),
        hostSpeaking: phase.auto.speakingCapAt !== null,
      };
    case 'draw':
      return { name: 'draw', endsAt: phase.endsAt, closesAt: phase.endsAt + DRAW_SUBMIT_GRACE_MS };
    case 'scrubbed':
      return { name: 'scrubbed', endsAt: phase.endsAt };
    case 'slideshow':
      return { name: 'slideshow', startsAt: phase.startsAt };
  }
}

export function projectPublic(state: RoomState): PublicState {
  const round = state.round;
  return {
    code: state.code,
    phase: publicPhase(state.phase),
    seq: state.phaseSeq,
    hostId: state.hostId,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      icon: p.icon,
      connected: p.presence.connected,
      removed: p.removed,
      seated: isSeated(state, p.id),
      score: p.score,
    })),
    settings: {
      difficulty: state.settings.difficulty,
      cycles: state.settings.cycles,
      timers: state.settings.timers,
      custom: state.settings.custom,
    },
    progress: state.progress && { completed: state.progress.completedRounds, total: state.progress.totalRounds },
    round: round && {
      no: round.no,
      roster: [...round.roster],
      category: round.word ? round.word.category : null,
      // Roster order, not submission order, so the list depends only on who is done.
      done: round.roster.filter((id) => id in round.drawings),
    },
    paused: state.pause && { since: state.pause.since },
    // Who is asked for, never by which socket; room order, not request order (0024 item 4).
    rejoinRequests: state.players.filter((p) => state.rejoinRequests.some((r) => r.player === p.id)).map((p) => p.id),
  };
}

/** Phases in which a roster player holds their round secret. TODO(3b): extend through the guess. */
function holdsSecret(phase: Phase): boolean {
  return phase.name === 'briefing' || phase.name === 'draw' || phase.name === 'slideshow';
}

/**
 * One player's view, or null for an unknown id. The word goes only to
 * roster non-fakers and the faker role only to the faker (§14); a waiting
 * late joiner gets no round view (0014, 0020 item 4); the token only ever
 * reaches its own player's view.
 */
export function projectPrivate(state: RoomState, playerId: string): PrivateView | null {
  const p = findPlayer(state, playerId);
  if (!p) return null;
  const round = state.round;
  let view: PrivateRound | null = null;
  if (round && round.word && holdsSecret(state.phase) && round.roster.includes(p.id)) {
    const { category } = round.word;
    view = round.faker === p.id
      ? { no: round.no, category, role: 'faker' }
      : { no: round.no, category, role: 'agent', word: round.word.word };
  }
  return { you: { id: p.id, token: p.token }, round: view };
}
