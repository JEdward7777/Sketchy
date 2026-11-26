import { describe, expect, it } from 'vitest';
import { nextDeadline, projectPrivate, projectPublic } from '../../../src/shared/core';
import { ROOM_EXPIRY_MS } from '../../../src/shared/core/rules';
import type { PhaseName, RoomState } from '../../../src/shared/core/state';
import type { WordEntry } from '../../../src/shared/guess';
import type { GameIntent } from '../../../src/shared/protocol';
import { RoomDriver, STROKES, T0 } from '../../helpers/room';
import { seededRng, type TestRng } from '../../helpers/seeded-rng';

/**
 * Stage 3.7: property tests over seeded random sequences of intents, alarm
 * ticks and presence events. After every step:
 * - before unmask, public state is the same whoever the faker is and
 *   whatever the word (same category) and the secret RNG (3.6.1);
 * - until the guess resolves, the word is in neither public state nor the
 *   faker's private view, and both are the same for another word (3.6.1);
 * - nobody has a vote for themselves; a locked vote never changes (§4);
 * - scores change only when a round is scored, by exactly its points, or
 *   reset to zero by Play again (§5, 0014 item 2);
 * and, from checkpoints, alarm ticks alone (with the deal answered) bring
 * every game to final results or a pause.
 *
 * Every call gets random entropy, as from the adapter's CSPRNG (O-10).
 *
 * Time moves either to the next deadline or by less than the gap to it, so
 * each step fires the deadlines of at most one instant.
 */

const SEEDS = 40;
const STEPS = 400;
const CATEGORY = 'Things';
/** Words that cannot occur by accident in ids, tokens or guesses. */
const wordFor = (no: number): WordEntry => ({ word: `zebracorn${no}x`, category: CATEGORY, alt: [`unizeb${no}q`] });
const OTHER: WordEntry = { word: 'quokkaplane', category: CATEGORY };

const pub = (s: RoomState): string => JSON.stringify(projectPublic(s));

function answerDeal(r: RoomDriver): void {
  const round = r.state.round!;
  r.step({ kind: 'wordDealt', roundNo: round.no, entry: wordFor(round.no) });
}

function variant(s: RoomState, faker: string | null, word: WordEntry | null): RoomState {
  const round = s.round!;
  return {
    ...s,
    rng: { s: (s.rng.s ^ 0x9e3779b9) >>> 0 },
    bag: [...s.bag].reverse(),
    round: { ...round, faker: faker ?? round.faker, word: word && round.word ? word : round.word },
  };
}

/**
 * An independent reading of the pause rules (0011 as amended by 0023 and
 * 0027): where a pause may start, and who counts toward the 3.
 */
function mayPause(s: RoomState): boolean {
  return !['lobby', 'unmask', 'guess', 'judging', 'final'].includes(s.phase.name) && !unpausable(s);
}
function playable(s: RoomState): number {
  const between = ['scrubbed', 'results'].includes(s.phase.name);
  return s.players.filter((p) => p.presence.connected && !p.removed && (between || s.round === null || s.round.roster.includes(p.id))).length;
}

/** Invariants of one state on its own; returns the problems found. */
function checkState(s: RoomState): string[] {
  const out: string[] = [];
  if (!s.expired && !s.pause && mayPause(s) && playable(s) < 3) out.push(`unpaused in ${s.phase.name} with ${playable(s)} playable`);
  const round = s.round;
  if (!round || s.phase.name === 'lobby') return out;
  const base = pub(s);
  if (!round.unmasked) {
    for (const f of round.roster) if (pub(variant(s, f, OTHER)) !== base) out.push(`public depends on faker/word/rng (faker ${f})`);
  }
  if (round.word && !round.result) {
    if (base.includes(round.word.word)) out.push('word in public state');
    if (pub(variant(s, null, OTHER)) !== base) out.push('public depends on the word');
    const fakerView = JSON.stringify(projectPrivate(s, round.faker));
    if (fakerView.includes(round.word.word)) out.push('word in the faker view');
    if (JSON.stringify(projectPrivate(variant(s, null, OTHER), round.faker)) !== fakerView) out.push('faker view depends on the word');
  }
  for (const [voter, target] of Object.entries(round.votes)) if (voter === target) out.push(`${voter} votes for themselves`);
  if (s.pause && unpausable(s)) out.push(`paused in ${s.phase.name} (0027)`);
  return out;
}

/** Invariants of one step (`a` → `b`). */
function checkStep(a: RoomState, b: RoomState): string[] {
  const out: string[] = [];
  const ra = a.round;
  const rb = b.round;
  if (rb && rb.no !== ra?.no) {
    const present = (rb.connectedDuring.dealing ?? []).length;
    if (present < 3) out.push(`round ${rb.no} started with ${present} connected`);
  }
  if (ra && rb && ra.no === rb.no) {
    for (const v of ra.locked) {
      if (!rb.locked.includes(v) || rb.votes[v] !== ra.votes[v]) out.push(`locked vote of ${v} changed`);
    }
  }
  const before = new Map(a.players.map((p) => [p.id, p.score]));
  const changed = b.players.some((p) => (before.get(p.id) ?? 0) !== p.score);
  if (!changed) return out;
  if (b.phase.name === 'lobby' && b.players.every((p) => p.score === 0)) return out; // Play again
  const scored = rb?.result && (!ra || ra.no !== rb.no || !ra.result);
  if (!scored) return [...out, 'scores changed outside scoring'];
  for (const p of b.players) {
    const delta = p.score - (before.get(p.id) ?? 0);
    if (delta !== (rb.result!.points[p.id] ?? 0)) out.push(`${p.id} gained ${delta}, not their round points`);
  }
  return out;
}

/** Phases a pause must never be in (0027 items 1–2). */
function unpausable(s: RoomState): boolean {
  const name = s.phase.name;
  const lastResults = name === 'results' && s.progress !== null && s.progress.completedRounds >= s.progress.totalRounds;
  return name === 'unmask' || name === 'guess' || name === 'judging' || name === 'final' || lastResults;
}

/** Ticks alone (answering deals) reach final results, or a pause where one is allowed. */
function reachesEndOrPause(r0: RoomDriver): string | null {
  if (r0.state.phase.name === 'lobby') return null;
  const r = new RoomDriver();
  r.state = r0.state;
  r.now = r0.now;
  for (let i = 0; i < 2000; i++) {
    if (r.state.phase.name === 'final') return null;
    if (r.state.pause) return unpausable(r.state) ? `paused in ${r.state.phase.name} (0027)` : null;
    if (r.state.expired) return 'expired before final results';
    if (r.state.phase.name === 'dealing') {
      answerDeal(r);
      continue;
    }
    if (nextDeadline(r.state) === null) return `stuck in ${r.state.phase.name}`;
    r.fireNext();
  }
  return `no end after 2000 ticks, in ${r.state.phase.name}`;
}

function randomIntent(rng: TestRng, r: RoomDriver, ids: string[]): [string, GameIntent] {
  const who = rng.pick(ids);
  const any = () => rng.pick([...ids, 'p99']);
  const seq = rng.next() < 0.8 ? r.state.phaseSeq : r.state.phaseSeq - 1;
  const intents: GameIntent[] = [
    { type: 'draw:done', strokes: STROKES },
    { type: 'vote:set', targetId: any() },
    { type: 'vote:lock' },
    { type: 'guess:submit', text: rng.pick(['nope', 'rain hat', '', r.state.round?.word?.word ?? 'x', `unizeb${r.state.round?.no ?? 0}q`]) },
    { type: 'guess:judge', accept: rng.next() < 0.5 },
    { type: 'host:next', seq },
    { type: 'host:hold' },
    { type: 'host:narration', speaking: rng.next() < 0.5 },
    { type: 'host:remove', playerId: any() },
    { type: 'host:claim' },
    { type: 'host:start' },
  ];
  if (rng.next() < 0.02) intents.push({ type: 'host:end' });
  const hostish = rng.next() < 0.4 && r.state.hostId ? r.state.hostId : who;
  // Half the time, the move the phase is waiting for, so games get through every phase.
  const round = r.state.round;
  if (round && rng.next() < 0.5) {
    switch (r.state.phase.name) {
      case 'guess':
        return [round.faker, rng.pick(intents.filter((x) => x.type === 'guess:submit'))];
      case 'judging':
        return [rng.pick(round.roster), rng.pick(intents.filter((x) => x.type === 'guess:judge'))];
      case 'slideshow':
      case 'browse':
        return [rng.pick(round.roster), rng.pick(intents.filter((x) => x.type.startsWith('vote:')))];
      case 'draw':
        return [rng.pick(round.roster), intents[0]!];
    }
  }
  return [hostish, rng.pick(intents)];
}

function step(rng: TestRng, r: RoomDriver, ids: string[]): void {
  const roll = rng.next();
  const due = nextDeadline(r.state);
  if (r.state.phase.name === 'dealing' && roll < 0.5) {
    answerDeal(r);
    return;
  }
  // Never tick into the inactivity expiry: it ends the walk (tested in 3a).
  if (roll < 0.3 && due !== null && due < r.state.lastActivityAt + ROOM_EXPIRY_MS) {
    // Either to the next deadline, or strictly short of it.
    if (rng.next() < 0.6) r.fireNext();
    else r.advance(Math.floor(rng.next() * Math.max(0, due - r.now)));
    return;
  }
  if (roll < 0.36) {
    const p = rng.pick(ids);
    const online = r.state.players.find((q) => q.id === p)!.presence.online;
    if (online) r.offline(p);
    else if (rng.next() < 0.5) r.online(p);
    else r.step({ kind: 'intent', conn: `c-${p}-${r.now}`, player: null, intent: { type: 'rejoin', token: r.state.players.find((q) => q.id === p)!.token } });
    return;
  }
  if (roll < 0.42 && ids.length < 8) {
    ids.push(r.join(`L${ids.length}`, ['teal', 'sky', 'blue', 'purple', 'pink'][ids.length - 3]!));
    return;
  }
  const [who, intent] = randomIntent(rng, r, ids);
  r.intent(who, intent);
}

describe('3.7 property tests over seeded random sequences', () => {
  it(`hold the secrecy, voting and scoring invariants at every step, and ticks alone end every game (${SEEDS} seeds × ${STEPS} steps)`, () => {
    const visited = new Set<PhaseName>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = seededRng(seed * 7919);
      const r = new RoomDriver(seed, T0, 'ABCD', seed * 31 + 7);
      // Entropy varies per call, as from the adapter's CSPRNG; the invariants must hold whatever it is.
      r.entropy = () => Math.floor(rng.next() * 2 ** 32);
      const ids = r.joinMany(3 + rng.int(3));
      r.intent(ids[0]!, { type: 'host:settings', settings: { cycles: 1, timers: 'quick' } });
      r.intent(ids[0]!, { type: 'host:start' });
      for (let i = 0; i < STEPS && !r.state.expired; i++) {
        const before = r.state;
        step(rng, r, ids);
        visited.add(r.state.phase.name);
        const problems = [...checkState(r.state), ...checkStep(before, r.state)];
        expect(problems, `seed ${seed}, step ${i}, phase ${r.state.phase.name}`).toEqual([]);
        if (i % 40 === 0) expect(reachesEndOrPause(r), `seed ${seed}, step ${i}`).toBeNull();
      }
      expect(reachesEndOrPause(r), `seed ${seed}, end`).toBeNull();
    }
    // The random walk must actually exercise every phase, or the invariants prove little.
    const all: PhaseName[] = ['lobby', 'dealing', 'briefing', 'draw', 'scrubbed', 'slideshow', 'browse', 'unmask', 'guess', 'judging', 'results', 'final'];
    expect([...visited].sort()).toEqual([...all].sort());
  });
});
