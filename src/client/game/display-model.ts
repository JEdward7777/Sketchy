/**
 * The big-screen display's pure logic (stage 12.4, `SPEC.md` §3): what a
 * TV or laptop in the room shows for each public phase — the headline,
 * the countdown it runs, the round line, who has filed a drawing, and how
 * to tile the round's drawings on a 16:9 screen. No DOM, so the unit leg
 * pins it.
 *
 * Public state only: a display socket never receives `private`
 * (protocol.md "Display sockets"), and nothing here reads the word or the
 * faker before the public state carries them (`round.result.word` from
 * results on, `round.faker` from unmask on).
 */

import type { PublicPhase, PublicPlayer, PublicState } from '../../shared/core/views';
import { verdictOf, winnerLine } from './results-model';

/** The id the shared screens get for "you" on the display: no player has it, so nothing is marked as the viewer's own. */
export const SPECTATOR = '';

export interface DisplayHeadline {
  /** The small stamp-style line above the title. */
  readonly kicker: string;
  readonly title: string;
}

const nameOf = (players: readonly PublicPlayer[], id: string | null) => players.find((p) => p.id === id)?.name ?? 'The faker';

/** The headline for the public phase, in the spy voice. Never names the word, and names the faker only from unmask on. */
export function displayHeadline(state: PublicState): DisplayHeadline {
  const phase = state.phase;
  const round = state.round;
  switch (phase.name) {
    case 'lobby':
      return { kicker: 'Recruiting', title: 'Scan the code to join the mission' };
    case 'dealing':
      return { kicker: 'Incoming transmission', title: "HQ is sealing this round's envelopes" };
    case 'briefing':
      return { kicker: 'Briefing', title: 'Agents are reading their briefings' };
    case 'draw':
      return { kicker: 'Pens up', title: 'Agents are drawing' };
    case 'scrubbed':
      return { kicker: 'Called off', title: 'Mission scrubbed' };
    case 'slideshow':
      return { kicker: 'Evidence', title: "Let's review the evidence" };
    case 'browse':
      return { kicker: 'Free browse', title: 'Who is bluffing?' };
    case 'unmask':
      return { kicker: 'The reveal', title: 'The votes are in' };
    case 'guess':
      return { kicker: 'Last chance', title: `${nameOf(state.players, round?.faker ?? null)} is cracking the code` };
    case 'judging':
      return { kicker: 'The jury is out', title: 'Does the guess count?' };
    case 'results':
      return { kicker: 'Debrief', title: round?.result ? verdictOf(round.result).title : 'Round over' };
    case 'final':
      return { kicker: 'Case closed', title: winnerLine(phase.standings, state.players) };
  }
}

export interface DisplayDeadline {
  readonly at: number;
  readonly label: string;
}

/** The deadline the display counts down in this phase, if any. The slideshow shows its progress bar instead. */
export function displayDeadline(phase: PublicPhase): DisplayDeadline | null {
  switch (phase.name) {
    case 'briefing':
      return { at: phase.continueAt, label: 'Drawing starts in' };
    case 'draw':
      return { at: phase.endsAt, label: 'Pens down in' };
    case 'scrubbed':
      return { at: phase.endsAt, label: 'Next briefing in' };
    case 'browse':
      return { at: phase.endsAt, label: 'Voting closes in' };
    case 'unmask':
      return { at: phase.endsAt, label: "The faker's guess opens in" };
    case 'guess':
      return { at: phase.endsAt, label: 'Guess time left' };
    case 'judging':
      return { at: phase.endsAt, label: 'Judging closes in' };
    case 'results':
      return { at: phase.continueAt, label: 'Next up in' };
    default:
      return null;
  }
}

/**
 * "Round 2 of 6": rounds that count (0020 item 3: a scrubbed one does not),
 * so mid-round it is the completed count plus one, and on the results the
 * round just scored. Null outside a game.
 */
export function roundLine(state: PublicState): string | null {
  const p = state.progress;
  if (!p || state.phase.name === 'lobby' || state.phase.name === 'final') return null;
  const n = state.phase.name === 'results' ? p.completed : Math.min(p.completed + 1, p.total);
  return `Round ${Math.max(1, n)} of ${p.total}`;
}

export interface DrawStatus {
  readonly id: string;
  readonly done: boolean;
}

/** Each seated agent and whether their drawing is filed (`round.done` is public during the draw). */
export function drawStatus(state: PublicState): readonly DrawStatus[] {
  const round = state.round;
  if (!round) return [];
  return round.roster.map((id) => ({ id, done: round.done.includes(id) }));
}

/**
 * Columns for tiling `n` cards in a box of `w × h` with `gap` between
 * them: each card is a 4:3 picture plus `chrome` (its name tag and vote
 * chips) of fixed height. Returns the count that makes each card widest;
 * ties go to fewer columns.
 */
export function gridColumns(n: number, w: number, h: number, chrome = 0, gap = 0): number {
  if (n <= 1 || w <= 0 || h <= 0) return 1;
  let best = 1;
  let bestW = 0;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    // Limited by the box width, or by its height: a card is width × 3/4 + chrome tall.
    const cardW = Math.max(0, Math.min((w - (cols - 1) * gap) / cols, (((h - (rows - 1) * gap) / rows - chrome) * 4) / 3));
    if (cardW > bestW + 1e-9) {
      bestW = cardW;
      best = cols;
    }
  }
  return best;
}
