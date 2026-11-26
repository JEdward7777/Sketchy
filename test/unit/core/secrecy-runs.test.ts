import { describe, expect, it } from 'vitest';
import { nextDeadline, projectPrivate, projectPublic } from '../../../src/shared/core';
import type { Input } from '../../../src/shared/core/io';
import type { RoomState } from '../../../src/shared/core/state';
import type { WordEntry } from '../../../src/shared/guess';
import type { GameIntent } from '../../../src/shared/protocol';
import { RoomDriver, STROKES } from '../../helpers/room';
import { seededRng, type TestRng } from '../../helpers/seeded-rng';

/**
 * Secrecy along whole runs (stage 3.6.1, unit 3b review round 1). Two rooms
 * get identical random inputs — presence flips, valid and refused intents,
 * "Rejoin as…" and admissions, removals, `host:end`, ticks — and differ in
 * one secret:
 * - the faker, swapped right after `host:start`: public state, the next
 *   deadline, every effect (error replies included) and every non-faker's
 *   private view must match at every step until unmask, or until the
 *   faker-disconnect cancel (§7), the one exempt transition;
 * - the word (same category): public state, deadlines, effects and the
 *   faker's private view must match until the guess resolves.
 * The snapshot tests compare single states; this catches behaviour that
 * depends on a secret, such as an error only the faker would get.
 */

const SEEDS = 150;
const CATEGORY = 'Things';
const wordA = (no: number): WordEntry => ({ word: `zebracorn${no}x`, category: CATEGORY, alt: [`unizeb${no}q`] });
const wordB = (no: number): WordEntry => ({ word: `quokka${no}y`, category: CATEGORY, alt: [`plane${no}z`] });
/** Make room B's snapshot comparable with A's: its word strings become A's. */
const asA = (json: string): string => json.replace(/quokka(\d+)y/g, 'zebracorn$1x').replace(/plane(\d+)z/g, 'unizeb$1q');

type Move = Input | 'deal' | { readonly tickTo: number };

function snapshot(r: RoomDriver, skip: ReadonlySet<string>): string {
  const views: Record<string, unknown> = {};
  for (const p of r.state.players) if (!skip.has(p.id)) views[p.id] = projectPrivate(r.state, p.id);
  return JSON.stringify({ pub: projectPublic(r.state), deadline: nextDeadline(r.state), fx: r.last, views });
}

function nextMove(rng: TestRng, r: RoomDriver, ids: readonly string[], minted: { n: number }): Move | null {
  const roll = rng.next();
  if (r.state.phase.name === 'dealing' && roll < 0.5) return 'deal';
  if (roll < 0.3) {
    const due = nextDeadline(r.state);
    if (due === null) return null;
    // To the deadline, or strictly short of it.
    return { tickTo: rng.next() < 0.6 ? Math.max(r.now, due) : r.now + Math.floor(rng.next() * Math.max(0, due - r.now)) };
  }
  const who = rng.pick(ids);
  if (roll < 0.38) return { kind: 'presence', player: who, connected: !r.state.players.find((q) => q.id === who)!.presence.online };
  if (roll < 0.42) {
    return { kind: 'intent', conn: `ra-${rng.int(3)}`, player: null, intent: { type: 'rejoinAs', playerId: rng.pick(ids) }, mintedToken: `mt-${++minted.n}` };
  }
  const any = () => rng.pick([...ids, 'p99']);
  const intents: GameIntent[] = [
    { type: 'draw:done', strokes: STROKES },
    { type: 'vote:set', targetId: any() },
    { type: 'vote:lock' },
    { type: 'guess:submit', text: rng.pick(['nope', 'rain hat', '']) },
    { type: 'guess:judge', accept: rng.next() < 0.5 },
    { type: 'host:next', seq: r.state.phaseSeq },
    { type: 'host:hold' },
    { type: 'host:remove', playerId: any() },
    { type: 'host:admit', playerId: any(), approve: rng.next() < 0.7 },
    { type: 'host:claim' },
  ];
  if (rng.next() < 0.03) intents.push({ type: 'host:end' });
  let player = rng.next() < 0.4 && r.state.hostId ? r.state.hostId : who;
  let intent = rng.pick(intents);
  const round = r.state.round;
  if (round && rng.next() < 0.5) {
    // Half the time, what the phase waits for, so runs reach every phase.
    const name = r.state.phase.name;
    if (name === 'draw' || name === 'slideshow' || name === 'browse' || name === 'guess' || name === 'judging') player = rng.pick(round.roster);
    if (name === 'draw') intent = intents[0]!;
    if (name === 'slideshow' || name === 'browse') intent = rng.pick(intents.slice(1, 3));
    if (name === 'guess') intent = intents[3]!;
    if (name === 'judging') intent = intents[4]!;
  }
  return { kind: 'intent', conn: `conn-${player}`, player, intent };
}

function apply(r: RoomDriver, move: Move, word: (no: number) => WordEntry): void {
  if (move === 'deal') {
    r.step({ kind: 'wordDealt', roundNo: r.state.round!.no, entry: word(r.state.round!.no) });
  } else if ('tickTo' in move) {
    r.now = move.tickTo;
    r.step({ kind: 'tick' });
  } else {
    r.step(move);
  }
}

/** Two rooms on the same seed and timers, in the first round's dealing phase. */
function twins(seed: number, rng: TestRng) {
  const A = new RoomDriver(seed);
  const B = new RoomDriver(seed);
  const n = 3 + rng.int(4);
  const ids = A.joinMany(n);
  B.joinMany(n);
  for (const d of [A, B]) {
    d.intent(ids[0]!, { type: 'host:settings', settings: { cycles: 1, timers: 'quick' } });
    d.intent(ids[0]!, { type: 'host:start' });
  }
  return { A, B, ids };
}

/**
 * The faker-disconnect cancel (§7) is the one exempt transition: stop when
 * exactly one twin has been scrubbed by it. Until then — a disconnected
 * faker whose cancel waits behind a pause included — the twins are compared.
 */
const oneScrubbed = (a: RoomState, b: RoomState): boolean => (a.phase.name === 'scrubbed') !== (b.phase.name === 'scrubbed');

describe('3.6.1 run-to-run: identical inputs, one secret swapped', () => {
  it('another faker: same public state, deadlines, effects and agent views until unmask or the cancel', () => {
    let compared = 0;
    let deferredCancel = 0;
    const phases = new Set<string>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = seededRng(seed * 104729);
      const { A, B, ids } = twins(seed, rng);
      const swapped = rng.pick(B.state.round!.roster.filter((id) => id !== A.faker));
      B.state = { ...B.state, round: { ...B.state.round!, faker: swapped } };
      const skip = new Set([A.faker, B.faker]);
      const minted = { n: 0 };
      for (let i = 0; i < 300; i++) {
        const move = nextMove(rng, A, ids, minted);
        if (move === null) continue;
        apply(A, move, wordA);
        apply(B, move, wordB);
        const ra = A.state.round;
        if (!ra || ra.no !== 1 || ra.unmasked || oneScrubbed(A.state, B.state)) break;
        compared++;
        phases.add(A.state.phase.name + (A.state.pause ? '/paused' : ''));
        for (const d of [A, B]) if (d.state.pause && !d.state.players.find((p) => p.id === d.faker)!.presence.connected) deferredCancel++;
        expect(asA(snapshot(B, skip)), `seed ${seed} step ${i} ${A.state.phase.name} ${JSON.stringify(move)}`).toBe(snapshot(A, skip));
      }
    }
    expect(compared).toBeGreaterThan(5000);
    for (const p of ['dealing', 'briefing', 'draw', 'slideshow', 'browse']) expect([...phases]).toContain(p);
    expect([...phases].some((p) => p.endsWith('/paused'))).toBe(true);
    expect(deferredCancel).toBeGreaterThan(0); // the paused window before a deferred cancel was compared
  });

  it('another word of the same category: same public state, deadlines, effects and faker view until the guess resolves', () => {
    let compared = 0;
    const phases = new Set<string>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = seededRng(seed * 7907);
      const { A, B, ids } = twins(seed, rng);
      const skip = new Set(ids.filter((id) => id !== A.faker));
      const minted = { n: 0 };
      for (let i = 0; i < 400; i++) {
        const move = nextMove(rng, A, ids, minted);
        if (move === null) continue;
        apply(A, move, wordA);
        apply(B, move, wordB);
        const ra = A.state.round;
        if (!ra || ra.no !== 1 || ra.result || B.state.round!.result) break;
        compared++;
        phases.add(A.state.phase.name);
        const sa = snapshot(A, skip);
        expect(sa).not.toContain('zebracorn');
        expect(asA(snapshot(B, skip)), `seed ${seed} step ${i} ${A.state.phase.name}`).toBe(sa);
      }
    }
    expect(compared).toBeGreaterThan(5000);
    for (const p of ['briefing', 'draw', 'slideshow', 'browse', 'unmask', 'guess', 'judging']) expect([...phases]).toContain(p);
  });
});
