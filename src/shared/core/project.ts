/**
 * The two projections (stage 3.4): `projectPublic` for the broadcast
 * `state` message and `projectPrivate` for one player's socket.
 *
 * `projectPublic` is written field by field from an allow-list, never by
 * spreading state objects, so a secret field added to the state later cannot
 * leak by accident. It never reads the RNGs, the Mixed bag, the used-word
 * list or any token; it reads the faker only from unmask on and the word
 * (beyond its public category, §6) only once the guess resolves (stage 3.6).
 */

import { placements } from '../placement';
import { autoDue, autoFillStart } from './auto-continue';
import { DRAW_SUBMIT_GRACE_MS } from './rules';
import { currentTimers, findPlayer, isSeated, type AutoContinue, type Phase, type RoomState, type Round } from './state';
import type { PrivateRound, PrivateView, PublicPhase, PublicRound, PublicState } from './views';

function continuePoint(auto: AutoContinue) {
  return { continueAt: autoDue(auto), fillFrom: autoFillStart(auto), hostSpeaking: auto.speakingCapAt !== null };
}

function publicPhase(state: RoomState): PublicPhase {
  const phase = state.phase;
  switch (phase.name) {
    case 'lobby':
    case 'dealing':
      return { name: phase.name };
    case 'briefing':
      return { name: 'briefing', ...continuePoint(phase.auto) };
    case 'results':
      return { name: 'results', ...continuePoint(phase.auto) };
    case 'draw':
      return { name: 'draw', endsAt: phase.endsAt, closesAt: phase.endsAt + DRAW_SUBMIT_GRACE_MS };
    case 'slideshow':
      return { name: 'slideshow', startsAt: phase.startsAt, perSlideMs: currentTimers(state).perSlideMs, endsAt: phase.endsAt };
    case 'scrubbed':
    case 'browse':
    case 'unmask':
    case 'guess':
    case 'judging':
      return { name: phase.name, endsAt: phase.endsAt };
    case 'final': {
      const standing = state.players.filter((p) => !p.removed).map((p) => ({ id: p.id, score: p.score }));
      return { name: 'final', standings: placements(standing).map((p) => ({ id: p.id, score: p.score, place: p.place })) };
    }
  }
}

/**
 * The public round. Before unmask nothing here depends on the faker, and
 * until the guess resolves nothing depends on the word beyond its category
 * (3.6.1): votes, locks and judgments are players' own public acts, and the
 * card order comes from `orderRng`.
 */
function publicRound(round: Round): PublicRound {
  const inRosterOrder = (has: (id: string) => boolean) => round.roster.filter(has);
  const result = round.result;
  return {
    no: round.no,
    roster: [...round.roster],
    category: round.word ? round.word.category : null,
    // Roster order, not submission order, so the list depends only on who is done.
    done: inRosterOrder((id) => id in round.drawings),
    cards: round.cards && [...round.cards],
    votes: Object.fromEntries(inRosterOrder((id) => id in round.votes).map((id) => [id, round.votes[id]!])),
    locked: inRosterOrder((id) => round.locked.includes(id)),
    faker: round.unmasked ? round.faker : null,
    guess: round.guess,
    judged: inRosterOrder((id) => id in round.judgments),
    result: result && round.word && {
      word: round.word.word,
      correct: result.correct,
      verdict: result.verdict,
      accepts: result.accepts,
      rejects: result.rejects,
      points: { ...result.points },
      tally: { ...result.tally },
      faker: { undetected: result.faker.undetected, guess: result.faker.guess, framing: result.faker.framing },
    },
  };
}

export function projectPublic(state: RoomState): PublicState {
  const round = state.round;
  return {
    code: state.code,
    phase: publicPhase(state),
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
    round: round && publicRound(round),
    paused: state.pause && { since: state.pause.since },
    // Who is asked for, never by which socket; room order, not request order (0024 item 4).
    rejoinRequests: state.players.filter((p) => state.rejoinRequests.some((r) => r.player === p.id)).map((p) => p.id),
  };
}

/**
 * Phases in which a roster player holds their round view: from the briefing
 * until the guess resolves. Agents keep the word to judge the guess; the
 * faker never gets it here, and from round results it is public.
 */
function holdsSecret(phase: Phase): boolean {
  switch (phase.name) {
    case 'briefing':
    case 'draw':
    case 'slideshow':
    case 'browse':
    case 'unmask':
    case 'guess':
    case 'judging':
      return true;
    case 'lobby':
    case 'dealing':
    case 'scrubbed':
    case 'results':
    case 'final':
      return false;
  }
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
