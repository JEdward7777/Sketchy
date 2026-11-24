/**
 * Stage 2.2 — `scoreRound`, encoding SPEC §5 (2.2.1), decision 0003 with the
 * voting window of 0007 item 6 (2.2.2), 0012 item 6, and the owner's answer
 * to 0.8.6 in decision 0015 plus 0019 item 5 (2.2.3).
 */
import { describe, expect, it } from 'vitest';
import {
  CORRECT_GUESS_POINTS,
  scoreRound,
  type PlayerId,
  type RoundPlayer,
  type RoundScoringInput,
} from '../../src/shared/scoring';
import { seededRng } from '../helpers/seeded-rng';

const present = (id: PlayerId): RoundPlayer => ({ id, presentInVotingWindow: true, hasCard: true });
const absent = (id: PlayerId): RoundPlayer => ({ id, presentInVotingWindow: false, hasCard: true });

/** Five present players; F is the faker unless a test says otherwise. */
const FIVE = ['F', 'A', 'B', 'C', 'D'].map(present);

function completed(
  roster: readonly RoundPlayer[],
  votes: Record<PlayerId, PlayerId>,
  guessCorrect = false,
  fakerId: PlayerId = 'F',
): RoundScoringInput {
  return { roster, outcome: { kind: 'completed', fakerId, votes, guessCorrect } };
}

describe('SPEC §5 table (2.2.1)', () => {
  it('real player +1 for voting the faker; faker +1 per real player not voting them', () => {
    // A, B catch the faker; C, D vote A; F votes B.
    const r = scoreRound(completed(FIVE, { A: 'F', B: 'F', C: 'A', D: 'A', F: 'B' }));
    expect(r.points.A).toBe(1);
    expect(r.points.B).toBe(1);
    expect(r.points.C).toBe(0);
    expect(r.points.D).toBe(0);
    expect(r.faker?.undetected).toBe(2);
  });

  it('faker +2 for a correct guess', () => {
    const votes = { A: 'F', B: 'F', C: 'F', D: 'F', F: 'A' };
    expect(scoreRound(completed(FIVE, votes, false)).points.F).toBe(0 + 0 + 0);
    const r = scoreRound(completed(FIVE, votes, true));
    expect(r.faker).toEqual({ undetected: 0, guess: CORRECT_GUESS_POINTS, framing: 0 });
    expect(r.points.F).toBe(CORRECT_GUESS_POINTS);
  });

  it('faker +1 framing when their target has the most votes', () => {
    // F votes A; A has 3 votes (C, D, F), the faker 2 (A, B).
    const r = scoreRound(completed(FIVE, { A: 'F', B: 'F', C: 'A', D: 'A', F: 'A' }));
    expect(r.tally.A).toBe(3);
    expect(r.faker?.framing).toBe(1);
    expect(r.points.F).toBe(2 + 1);
  });

  it('no framing when the target is not on top', () => {
    // F votes B (1 vote: F's own); A has 2.
    const r = scoreRound(completed(FIVE, { C: 'A', D: 'A', F: 'B' }));
    expect(r.faker?.framing).toBe(0);
  });

  it('a tie for most votes counts as most', () => {
    // A: C, D → 2; B: A, F → 2; faker: 0.
    const r = scoreRound(completed(FIVE, { A: 'B', C: 'A', D: 'A', F: 'B', B: 'C' }));
    expect(r.tally.A).toBe(2);
    expect(r.tally.B).toBe(2);
    expect(r.faker?.framing).toBe(1);
  });

  it('everyone on the roster gets an entry, and only real players who caught the faker score', () => {
    const r = scoreRound(completed(FIVE, { A: 'F' }));
    expect(Object.keys(r.points).sort()).toEqual(['A', 'B', 'C', 'D', 'F']);
    expect(r.points).toEqual({ F: 3, A: 1, B: 0, C: 0, D: 0 });
  });

  it('nobody can vote for themselves: a self-vote is ignored', () => {
    const r = scoreRound(completed(FIVE, { A: 'A', F: 'F' }));
    expect(r.tally.A).toBe(0);
    expect(r.tally.F).toBe(0);
    expect(r.faker?.framing).toBe(0);
  });
});

describe('decision 0003 edge cases (2.2.2)', () => {
  it('item 1: a connected real player with no vote → faker +1', () => {
    const r = scoreRound(completed(FIVE, {}));
    expect(r.faker?.undetected).toBe(4);
    expect(r.points.F).toBe(4);
  });

  it('item 2: a real player absent for the whole voting window is excluded from both sides', () => {
    const roster = [present('F'), present('A'), absent('B'), present('C')];
    const r = scoreRound(completed(roster, { A: 'F' }));
    // C did not vote → +1; B is excluded, so no +1 for the faker from B.
    expect(r.faker?.undetected).toBe(1);
    expect(r.points.B).toBe(0);
  });

  it('item 2: an absent player cannot have voted — a vote recorded for them is ignored', () => {
    const roster = [present('F'), present('A'), absent('B'), present('C')];
    const r = scoreRound(completed(roster, { B: 'F', A: 'C', C: 'A', F: 'C' }));
    expect(r.points.B).toBe(0);
    expect(r.tally.F).toBe(0);
    // Without B's vote, C and A each have one other vote; F's vote puts C on top.
    expect(r.tally.C).toBe(2);
    expect(r.faker?.framing).toBe(1);
  });

  it('item 3: "most votes" includes the faker\'s own vote', () => {
    // A: C, D → 2. B: A → 1, plus the faker's own vote → 2, tying A.
    // Counting only real players' votes, B (1) would trail A (2): no framing.
    const r = scoreRound(completed(FIVE, { C: 'A', D: 'A', A: 'B', F: 'B' }));
    expect(r.tally.A).toBe(2);
    expect(r.tally.B).toBe(2);
    expect(r.faker?.framing).toBe(1);
  });

  it('item 4: a cancelled round awards zero to everyone', () => {
    const r = scoreRound({ roster: FIVE, outcome: { kind: 'cancelled' } });
    expect(r.points).toEqual({ F: 0, A: 0, B: 0, C: 0, D: 0 });
    expect(r.faker).toBeUndefined();
  });

  it('0012 item 6: a faker absent for the whole voting window still scores normally', () => {
    const roster = [absent('F'), present('A'), present('B'), present('C')];
    const r = scoreRound(completed(roster, { A: 'F', B: 'C' }, false));
    expect(r.points.A).toBe(1); // real players who voted the faker still score
    expect(r.faker?.undetected).toBe(2); // B and C did not vote the faker
    expect(r.faker?.framing).toBe(0); // no vote cast → no framing (0015 item 3)
    expect(r.points.F).toBe(2);
  });
});

describe("decision 0015 — the owner's answer to 0.8.6, and 0019 item 5 (2.2.3)", () => {
  it('0015 item 3: a faker who casts no vote earns no framing bonus, even when everyone ties at 0', () => {
    const r = scoreRound(completed(FIVE, {}));
    expect(r.faker?.framing).toBe(0);
    const r2 = scoreRound(completed(FIVE, { A: 'B', B: 'A' }));
    expect(r2.faker?.framing).toBe(0);
  });

  it('0015 items 1–2: a vote for a disconnected player counts, and can frame them', () => {
    // A was absent all window (went dark) but still has a card: a valid target.
    const roster = [present('F'), absent('A'), present('B'), present('C')];
    const r = scoreRound(completed(roster, { B: 'A', C: 'A', F: 'A' }));
    expect(r.tally.A).toBe(3);
    expect(r.faker?.framing).toBe(1);
    expect(r.faker?.undetected).toBe(2); // B and C; A excluded
  });

  it('0015 item 2: a vote for a player removed after the slideshow started still counts', () => {
    // Removed mid-round: still on the roster with a card (0019 item 4).
    const r = scoreRound(completed(FIVE, { A: 'D', B: 'D', F: 'D' }));
    expect(r.tally.D).toBe(3);
    expect(r.faker?.framing).toBe(1);
  });

  it('0019 item 5: a player removed before the slideshow has no card and is not a valid target', () => {
    const roster = [present('F'), present('A'), present('B'), { id: 'R', presentInVotingWindow: false, hasCard: false }];
    const r = scoreRound(completed(roster, { A: 'R', B: 'R', F: 'R' }));
    expect(r.tally.R).toBe(0);
    expect(r.faker?.framing).toBe(0); // F's vote did not count
    expect(r.faker?.undetected).toBe(2); // A and B have no counted vote, so did not vote the faker
  });

  it('votes from or for players outside the roster are ignored', () => {
    const r = scoreRound(completed(FIVE, { LATE: 'F', A: 'LATE' }));
    expect(r.tally.F).toBe(0);
    expect('LATE' in r.points).toBe(false);
    expect(r.faker?.undetected).toBe(4);
  });
});

describe('input validation and invariants', () => {
  it('throws on a faker outside the roster or duplicate ids', () => {
    expect(() => scoreRound(completed(FIVE, {}, false, 'X'))).toThrow();
    expect(() => scoreRound(completed([present('F'), present('F'), present('A')], {}))).toThrow();
  });

  it('seeded random rounds: totals match the §5 table with every drop rule applied independently', () => {
    const rng = seededRng(55);
    const dropped = { absentVoter: 0, self: 0, noCard: 0, offRoster: 0 };
    for (let trial = 0; trial < 400; trial++) {
      const n = 3 + rng.int(8);
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const fakerId = rng.pick(ids);
      const roster: RoundPlayer[] = ids.map((id) => ({
        id,
        presentInVotingWindow: rng.next() < 0.75,
        // The faker always drew, so keeps a card; others are sometimes removed before the slideshow.
        hasCard: id === fakerId || rng.next() < 0.85,
      }));
      // Votes from everyone, absent players and outsiders included, at any id
      // (self, card-less players, outsiders) — the generator emits every case
      // the drop rules exist for.
      const outsiders = ['late1', 'late2'];
      const anyId = [...ids, ...outsiders];
      const votes: Record<string, string> = {};
      for (const voter of anyId) if (rng.next() < 0.8) votes[voter] = rng.pick(anyId);
      const guessCorrect = rng.next() < 0.5;
      const r = scoreRound(completed(roster, votes, guessCorrect, fakerId));

      // Independent oracle, straight from the decisions.
      const byId = new Map(roster.map((p) => [p.id, p]));
      const counted: Record<string, string> = {};
      for (const [v, t] of Object.entries(votes)) {
        const voter = byId.get(v);
        const target = byId.get(t);
        if (!voter || !target) { dropped.offRoster++; continue; } // either id off the roster
        if (v === t) { dropped.self++; continue; } // §4: nobody votes for themselves
        if (!target.hasCard) { dropped.noCard++; continue; } // 0019 item 5
        if (!voter.presentInVotingWindow && v !== fakerId) { dropped.absentVoter++; continue; } // 0003 item 2, 0012 item 6
        counted[v] = t;
      }
      const tally: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
      for (const t of Object.values(counted)) tally[t]! += 1;
      const reals = roster.filter((p) => p.id !== fakerId && p.presentInVotingWindow);
      let faker = reals.filter((p) => counted[p.id] !== fakerId).length;
      if (guessCorrect) faker += 2;
      const target = counted[fakerId];
      if (target !== undefined && tally[target] === Math.max(...Object.values(tally))) faker += 1;

      expect(r.tally).toEqual(tally);
      expect(r.points[fakerId]).toBe(faker);
      for (const p of roster) {
        if (p.id === fakerId) continue;
        expect(r.points[p.id]).toBe(p.presentInVotingWindow && counted[p.id] === fakerId ? 1 : 0);
      }
    }
    // The generator really exercised every drop rule.
    for (const [rule, count] of Object.entries(dropped)) expect(count, rule).toBeGreaterThan(20);
  });
});
