/**
 * The round-end screens' pure logic (phase 10, `SPEC.md` §4 phases 5–7,
 * §5, decisions 0007 item 4, 0013, 0014): who voted for whom at unmask,
 * who may judge the guess and how far judging has got, the round's
 * verdict, the points this round with the running scoreboard, and the
 * final podium. No DOM, so the unit leg pins it.
 *
 * Secrecy (0026 item 5): nothing here reads the private view. The word
 * comes only from `round.result.word`, which the room publishes once the
 * guess resolves.
 */

import type { PublicPlayer, PublicRound, PublicState } from '../../shared/core/views';
import { placements } from '../../shared/placement';
import type { ErrorCode } from '../../shared/protocol';

type Players = readonly PublicPlayer[];

const nameOf = (players: Players, id: string) => players.find((p) => p.id === id)?.name ?? 'Unknown agent';

/** One line of the unmask board: a voter and who they accused (null: no vote cast). */
export interface VoteLine {
  readonly voter: string;
  readonly target: string | null;
  /** The voter is the faker (public from unmask on). */
  readonly voterIsFaker: boolean;
  /** They accused the faker. */
  readonly caught: boolean;
}

/** Every roster player's vote, in roster order (§4 phase 5: "who voted for whom"). */
export function voteLines(round: Pick<PublicRound, 'roster' | 'votes' | 'faker'>): readonly VoteLine[] {
  return round.roster.map((voter) => {
    const target = round.votes[voter] ?? null;
    return { voter, target, voterIsFaker: voter === round.faker, caught: target !== null && target === round.faker };
  });
}

/** How many players accused the faker: the "caught" count the unmask shows. */
export function votesOnFaker(round: Pick<PublicRound, 'roster' | 'votes' | 'faker'>): number {
  return voteLines(round).filter((l) => l.caught).length;
}

/** The judges (0013 item 2): roster players other than the faker. */
export function judgesOf(round: Pick<PublicRound, 'roster' | 'faker'>): readonly string[] {
  return round.roster.filter((id) => id !== round.faker);
}

/** May this player tap accept/reject now? A roster non-faker who has not judged (0013 item 4: one final tap). */
export function canJudge(round: Pick<PublicRound, 'roster' | 'faker' | 'judged'>, you: string): boolean {
  return judgesOf(round).includes(you) && !round.judged.includes(you);
}

/**
 * "2 of 3 judged": out of the judges who still count for the early end
 * (0013 item 3: connected ones), plus anyone who judged before dropping.
 */
export function judgeCount(round: Pick<PublicRound, 'roster' | 'faker' | 'judged'>, connected: (id: string) => boolean): { readonly judged: number; readonly of: number } {
  const counted = judgesOf(round).filter((id) => connected(id) || round.judged.includes(id));
  return { judged: round.judged.filter((id) => counted.includes(id)).length, of: counted.length };
}

export type VerdictKind = 'auto' | 'accepted' | 'rejected' | 'none';

export interface Verdict {
  readonly kind: VerdictKind;
  /** The headline, in the spy voice. */
  readonly title: string;
  /** One line under it: the jury's count, or why. */
  readonly detail: string;
}

/** What the results say about the guess (§4 phase 6, 0013 item 5: a tie, 0–0 included, accepts). */
export function verdictOf(result: NonNullable<PublicRound['result']>): Verdict {
  const { verdict, correct, accepts, rejects } = result;
  if (verdict === 'none') return { kind: 'none', title: 'No guess filed', detail: 'The clock ran out before the faker named the word.' };
  if (verdict === 'auto') return { kind: 'auto', title: 'Bullseye!', detail: 'The guess matched the secret word exactly.' };
  const count = `${accepts}–${rejects}`;
  if (correct) {
    return {
      kind: 'accepted',
      title: 'The jury lets it slide',
      detail: accepts === rejects ? `Tied ${count}, and a tie goes to the faker.` : `Accepted ${count}.`,
    };
  }
  return { kind: 'rejected', title: 'Objection sustained', detail: `Rejected ${count}. Close, but no dossier.` };
}

export interface ScoreRow {
  readonly id: string;
  readonly name: string;
  readonly score: number;
  /** Points this round; null for a player not on the round's roster. */
  readonly gained: number | null;
  readonly place: number;
  readonly removed: boolean;
}

/**
 * The running scoreboard: every player, highest score first with shared
 * placement (1, 1, 3; 0007 item 4), ties in room order; removed players
 * (0019) last and unplaced. `points` is this round's (§5), when known.
 */
export function scoreRows(players: Players, points: Readonly<Record<string, number>> | null): readonly ScoreRow[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const rows: ScoreRow[] = placements(players.filter((p) => !p.removed).map((p) => ({ id: p.id, score: p.score }))).map((s) => ({
    id: s.id,
    name: byId.get(s.id)!.name,
    score: s.score,
    gained: points?.[s.id] ?? null,
    place: s.place,
    removed: false,
  }));
  for (const p of players.filter((q) => q.removed)) rows.push({ id: p.id, name: p.name, score: p.score, gained: points?.[p.id] ?? null, place: 0, removed: true });
  return rows;
}

/** "+2", "+0", or "" for a player who sat this round out. */
export function gainedText(gained: number | null): string {
  return gained === null ? '' : `+${gained}`;
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export interface PodiumEntry {
  readonly id: string;
  readonly score: number;
  readonly place: number;
  /** "1st", or "Tied 1st" when someone shares the place. */
  readonly label: string;
}

export interface Podium {
  /** Places 1–3 by standing, grouped by step: step 0 is first place. A tie puts several agents on one step. */
  readonly steps: readonly (readonly PodiumEntry[])[];
  /** Everyone placed below the podium, in standings order. */
  readonly rest: readonly PodiumEntry[];
}

/**
 * The final podium from `final.standings` (already ordered and placed by
 * the room, 0007 item 4). Agents whose place is 1, 2 or 3 stand on the
 * step of that place; with ties a step can be empty (1, 1, 3 leaves second
 * empty), which the podium shows as such rather than promoting anyone.
 */
export function podium(standings: readonly { readonly id: string; readonly score: number; readonly place: number }[]): Podium {
  const count = new Map<number, number>();
  for (const s of standings) count.set(s.place, (count.get(s.place) ?? 0) + 1);
  const entries = standings.map((s) => ({ ...s, label: `${(count.get(s.place) ?? 0) > 1 ? 'Tied ' : ''}${ordinal(s.place)}` }));
  return {
    steps: [1, 2, 3].map((place) => entries.filter((e) => e.place === place)),
    rest: entries.filter((e) => e.place > 3),
  };
}

/** The headline over the podium: the winner(s) by name. */
export function winnerLine(standings: readonly { readonly id: string; readonly place: number }[], players: Players): string {
  const top = standings.filter((s) => s.place === 1).map((s) => nameOf(players, s.id));
  if (top.length === 0) return 'Mission complete';
  if (top.length === 1) return `Agent ${top[0]} takes the case!`;
  return `A dead heat: ${top.slice(0, -1).join(', ')} and ${top.at(-1)} share the top spot`;
}

/** The host's continue label on round results: the last round goes to the podium (0020 item 2). */
export function resultsContinueLabel(progress: PublicState['progress']): string {
  return progress && progress.completed >= progress.total ? 'Final results' : 'Next round';
}

/** The guess and judging refusals these screens explain; anything else gets the generic text. */
const GUESS_ERRORS: Partial<Record<ErrorCode, string>> = {
  not_faker: 'Only the faker gets to guess, agent.',
  bad_guess: 'Type a word first. Silence is not a guess.',
  not_judge: "Nice try. You can't judge your own guess.",
  already_judged: 'Your verdict is already in.',
  paused: 'The mission is paused.',
  wrong_phase: 'Too late: that moment has passed.',
  not_in_round: "You're on deck this round, so you sit this one out.",
};

export function guessErrorText(code: ErrorCode): string | null {
  return GUESS_ERRORS[code] ?? null;
}

/** The guess field's limit: generous for any word in the deck, far under the protocol's FIELD_MAX_LENGTH. */
export const GUESS_MAX_LENGTH = 60;
