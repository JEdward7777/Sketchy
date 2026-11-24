/**
 * Round scoring (stage 2.2): `SPEC.md` §5, with the edge cases of decisions
 * 0003, 0007 items 6–7, 0012 item 6, 0015 and 0019 items 4–5.
 *
 * | Who         | Earns                                                       |
 * |-------------|-------------------------------------------------------------|
 * | Real player | +1 for voting for the faker                                 |
 * | Faker       | +1 for each real player who did not vote for them           |
 * | Faker       | +2 for a correct word guess                                 |
 * | Faker       | +1 if the faker's vote target has the most votes (ties count)|
 *
 * Scoring runs over the round roster only (3.2): the players seated when the
 * round started. Late joiners are not in it (decision 0020 item 4); a player
 * removed mid-round still is (0019 item 4). Building that roster, and each
 * player's presence and card, is the reducer's job; this module only reads
 * them.
 *
 * Guess judging (decision 0013) happens before scoring: `guessCorrect` is the
 * final verdict, whether auto-accepted (§4) or judged.
 */

export type PlayerId = string;

/** One roster player as scoring sees them. */
export interface RoundPlayer {
  readonly id: PlayerId;
  /**
   * Connected at any instant of the voting window, which is the slideshow
   * plus free browse (decision 0007 item 6). False means "disconnected for
   * the whole voting phase": a real player with `false` is excluded from the
   * tally, neither side scoring from them (0003 item 2). The faker's flag is
   * ignored — a faker absent for the whole window still scores as usual
   * (0012 item 6).
   */
  readonly presentInVotingWindow: boolean;
  /**
   * Has a slideshow card: not removed by the time the slideshow started
   * (0007 item 7). A player without a card is not a valid vote target
   * (0019 item 5). Disconnected players keep their ("went dark") card.
   */
  readonly hasCard: boolean;
}

export type RoundOutcome =
  /** Faker disconnected in briefing or draw (§7, 0012 item 1): nobody scores (0003 item 4). */
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'completed';
      readonly fakerId: PlayerId;
      /**
       * voter → target for every vote that counts as cast: locked, or still
       * selected when voting ended (§4). A missing key is "no vote".
       */
      readonly votes: Readonly<Record<PlayerId, PlayerId>>;
      readonly guessCorrect: boolean;
    };

export interface RoundScoringInput {
  readonly roster: readonly RoundPlayer[];
  readonly outcome: RoundOutcome;
}

/** The faker's points, by §5 row, for the round-results screen. */
export interface FakerBreakdown {
  /** +1 per present real player who did not vote for the faker. */
  readonly undetected: number;
  /** 2 for a correct guess, else 0. */
  readonly guess: number;
  /** 1 when the faker's vote target has the most votes, else 0. */
  readonly framing: number;
}

export interface RoundScore {
  /** Points this round for every roster player (0 included). */
  readonly points: Readonly<Record<PlayerId, number>>;
  /** Absent for a cancelled round. */
  readonly faker?: FakerBreakdown;
  /** Votes received per roster player, counting only votes that count (see `countedVotes`). */
  readonly tally: Readonly<Record<PlayerId, number>>;
}

export const CORRECT_GUESS_POINTS = 2;

/**
 * The votes that count, as voter → target. A vote is dropped when:
 * - the voter is not on the roster, or is a real player absent for the
 *   whole voting window (0003 item 2; such a player could not have voted,
 *   since voting opens with the slideshow, §4);
 * - the target is the voter (§4: nobody votes for themselves), is not on the
 *   roster, or has no card (0019 item 5).
 * A target who disconnected or was removed after the slideshow started still
 * counts (0015 items 1–2): their card exists, so `hasCard` is true.
 */
export function countedVotes(
  roster: readonly RoundPlayer[],
  fakerId: PlayerId,
  votes: Readonly<Record<PlayerId, PlayerId>>,
): Map<PlayerId, PlayerId> {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const out = new Map<PlayerId, PlayerId>();
  for (const [voterId, targetId] of Object.entries(votes)) {
    const voter = byId.get(voterId);
    const target = byId.get(targetId);
    if (!voter || !target) continue;
    if (voterId === targetId) continue;
    if (!target.hasCard) continue;
    if (voterId !== fakerId && !voter.presentInVotingWindow) continue;
    out.set(voterId, targetId);
  }
  return out;
}

/** Score one round. Pure; throws only on a malformed roster or faker. */
export function scoreRound(input: RoundScoringInput): RoundScore {
  const { roster, outcome } = input;
  const ids = roster.map((p) => p.id);
  if (new Set(ids).size !== ids.length) throw new Error('scoreRound: duplicate roster ids');

  const points: Record<PlayerId, number> = {};
  const tally: Record<PlayerId, number> = {};
  for (const id of ids) {
    points[id] = 0;
    tally[id] = 0;
  }
  if (outcome.kind === 'cancelled') return { points, tally };

  const { fakerId, guessCorrect } = outcome;
  if (!ids.includes(fakerId)) throw new Error('scoreRound: faker is not on the round roster');

  const votes = countedVotes(roster, fakerId, outcome.votes);
  // "Most votes" tallies every counted vote, the faker's own included (0003 item 3).
  for (const target of votes.values()) tally[target] = (tally[target] ?? 0) + 1;

  let undetected = 0;
  for (const p of roster) {
    if (p.id === fakerId) continue;
    if (!p.presentInVotingWindow) continue; // excluded: neither side scores (0003 item 2)
    if (votes.get(p.id) === fakerId) points[p.id] = 1;
    else undetected += 1; // includes a connected player who cast no vote (0003 item 1)
  }

  const guess = guessCorrect ? CORRECT_GUESS_POINTS : 0;

  // A faker with no counted vote has no target, so no framing (0015 item 3).
  const fakerTarget = votes.get(fakerId);
  const most = Math.max(0, ...Object.values(tally));
  const framing = fakerTarget !== undefined && tally[fakerTarget] === most ? 1 : 0;

  points[fakerId] = undetected + guess + framing;
  return { points, tally, faker: { undetected, guess, framing } };
}
