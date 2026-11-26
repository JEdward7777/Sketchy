/**
 * A round from its start to the end of drawing (stage 3.3.2): seat the
 * roster and pick the faker (0020), deal the word (§6, 5.3), the briefing
 * beat with the 0004 continue (0017), drawing with `draw:done` (§4, 0009),
 * the early end over connected roster players (0012 item 5), and the
 * faker-disconnect cancel (§7, 0003 item 4, 0012). The draw ends in the
 * slideshow (voting.ts, `startSlideshow`).
 */

import { nextDifficulty } from '../difficulty-bag';
import { connectedRoster, pickFaker, seatRoundRoster } from '../game-length';
import type { WordEntry } from '../guess';
import type { PlayerIntent } from '../protocol';
import { decodeStrokes, encodeStrokes } from '../stroke-codec';
import { startAuto } from './auto-continue';
import { sendError, type Fx } from './io';
import { readyCount } from './presence';
import { BRIEFING_BEAT_MS, MIN_PLAYERS, SCRUBBED_BEAT_MS } from './rules';
import {
  currentTimers,
  drawingKey,
  enterPhase,
  isConnected,
  timeBase,
  type ConnId,
  type PlayerId,
  type RoomState,
} from './state';

/**
 * Start a round: seat every non-removed player (late joiners and
 * returned players included, 0020 item 4), pick the faker from the connected
 * roster with the room RNG (0020 item 1, `fakerCandidates`), take the round's difficulty (2.8),
 * and ask the adapter for a word. The previous round's drawings are cleared
 * (§14). The deal has no deadline; the briefing beat starts when the word
 * arrives. Callers guarantee at least 3 active players, so the pick has
 * candidates.
 */
export function startRound(state: RoomState, at: number, fx: Fx): RoomState {
  // Never start a round fewer than 3 could play (§7, 0011): its faker would
  // be picked from too few, and a single candidate is announced to everyone.
  // `settle` pauses first in every known path; this is the backstop. Between
  // rounds it pauses the current phase (its deadline resumes it); the lobby
  // checks before calling, so there it is a bug.
  if (readyCount(state) < MIN_PLAYERS) {
    if (state.phase.name === 'lobby') throw new Error('startRound: host:start must check the player count');
    return state.pause ? state : { ...state, pause: { since: at } };
  }
  const prev = state.round;
  if (prev) fx.push({ type: 'clearDrawings', roundNo: prev.no });
  const roster = seatRoundRoster(state.players);
  const faker = pickFaker(state.rng, fakerCandidates(state, roster));
  const diff = nextDifficulty(state.settings.difficulty, state.bag, faker.state);
  const no = state.nextRoundNo;
  fx.push({ type: 'dealWord', roundNo: no, difficulty: diff.difficulty, exclude: state.usedWords });
  return enterPhase(
    {
      ...state,
      rng: diff.state,
      bag: diff.bag,
      nextRoundNo: no + 1,
      round: {
        no,
        roster,
        faker: faker.value,
        difficulty: diff.difficulty,
        word: null,
        drawings: {},
        connectedDuring: {},
        cards: null,
        votes: {},
        locked: [],
        unmasked: false,
        guess: null,
        judgments: {},
        result: null,
      },
    },
    { name: 'dealing' },
  );
}

/**
 * The roster players the faker is picked from: every `connected` one, those
 * inside the blip grace included (0020 item 1, decision 0025 item 2).
 * Excluding visibly reloading players would tell the table who is not the
 * faker; a pick who never returns is cancelled by §7.
 */
export function fakerCandidates(state: RoomState, roster: readonly PlayerId[]): PlayerId[] {
  return connectedRoster(roster, (id) => isConnected(state, id));
}

function isWordEntry(entry: WordEntry): boolean {
  return typeof entry.word === 'string' && entry.word.length > 0 && typeof entry.category === 'string';
}

/**
 * The adapter's answer to `dealWord`. A stale answer (another round) is
 * ignored; a word already used this game is dealt again (§6 "skip it and deal
 * the next one"). Otherwise the briefing starts, its beat counted from now.
 */
export function wordDealt(state: RoomState, roundNo: number, entry: WordEntry, now: number, fx: Fx): RoomState {
  const round = state.round;
  if (state.phase.name !== 'dealing' || !round || round.no !== roundNo || !isWordEntry(entry)) return state;
  if (state.usedWords.includes(entry.word)) {
    fx.push({ type: 'dealWord', roundNo, difficulty: round.difficulty, exclude: state.usedWords });
    return state;
  }
  const next = { ...state, usedWords: [...state.usedWords, entry.word], round: { ...round, word: entry } };
  return enterPhase(next, { name: 'briefing', auto: startAuto(timeBase(state, now), BRIEFING_BEAT_MS) });
}

/** Briefing → draw, at `at` (auto-continue or the host's tap). */
export function startDraw(state: RoomState, at: number): RoomState {
  return enterPhase(state, { name: 'draw', endsAt: at + currentTimers(state).drawMs });
}

/**
 * §7: the faker disconnected during briefing or draw. The round is
 * cancelled: no points (0003 item 4), not counted toward the game length
 * (0020 item 3), its drawings cleared. The scrubbed screen does not name
 * the faker (0012 item 3).
 */
export function cancelRound(state: RoomState, at: number, fx: Fx): RoomState {
  if (state.round) fx.push({ type: 'clearDrawings', roundNo: state.round.no });
  return enterPhase({ ...state, round: state.round && { ...state.round, drawings: {} } }, { name: 'scrubbed', endsAt: at + SCRUBBED_BEAT_MS });
}

/**
 * True in the phases where §7's faker-disconnect cancel applies: briefing and
 * draw, with dealing counted as the start of the briefing.
 */
export function cancellable(state: RoomState): boolean {
  const name = state.phase.name;
  return name === 'dealing' || name === 'briefing' || name === 'draw';
}

/** Every connected roster player has submitted (0012 item 5). */
export function everyoneConnectedDone(state: RoomState): boolean {
  const round = state.round;
  if (!round) return false;
  return round.roster.every((id) => !isConnected(state, id) || id in round.drawings);
}

/** `draw:done` (§4, 0009): validate the strokes, record the reference, store them. */
function drawDone(state: RoomState, conn: ConnId, player: PlayerId, strokes: unknown, fx: Fx): RoomState {
  const round = state.round;
  if (state.phase.name !== 'draw' || !round) {
    sendError(fx, conn, 'wrong_phase', 'not drawing now');
    return state;
  }
  if (!round.roster.includes(player)) {
    sendError(fx, conn, 'not_in_round', 'you are waiting for the next round');
    return state;
  }
  if (player in round.drawings) {
    sendError(fx, conn, 'already_done', 'drawing already submitted');
    return state;
  }
  const decoded = decodeStrokes(strokes);
  if (!decoded.ok) {
    sendError(fx, conn, 'bad_strokes', decoded.error);
    return state;
  }
  const key = drawingKey(round.no, player);
  fx.push({ type: 'storeDrawing', key, strokes: encodeStrokes(decoded.strokes) });
  return { ...state, round: { ...round, drawings: { ...round.drawings, [player]: { key, stored: false } } } };
}

/** The adapter stored a drawing; unknown or stale keys are ignored. */
export function drawingStored(state: RoomState, key: string): RoomState {
  const round = state.round;
  if (!round) return state;
  const entry = Object.entries(round.drawings).find(([, ref]) => ref.key === key);
  if (!entry || entry[1].stored) return state;
  return { ...state, round: { ...round, drawings: { ...round.drawings, [entry[0]]: { key, stored: true } } } };
}

/** `draw:done`; null for intents another module handles. */
export function roundIntent(state: RoomState, conn: ConnId, player: PlayerId, intent: PlayerIntent, fx: Fx): RoomState | null {
  return intent.type === 'draw:done' ? drawDone(state, conn, player, intent.strokes, fx) : null;
}
