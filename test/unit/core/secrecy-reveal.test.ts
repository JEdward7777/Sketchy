import { describe, expect, it } from 'vitest';
import { nextDeadline, projectPrivate, projectPublic } from '../../../src/shared/core';
import { BLIP_GRACE_MS, BRIEFING_BEAT_MS } from '../../../src/shared/core/rules';
import type { RoomState } from '../../../src/shared/core/state';
import type { WordEntry } from '../../../src/shared/guess';
import { OTHER_WORD, RoomDriver, WORD } from '../../helpers/room';

/**
 * Secrecy from the slideshow to the guess — stage 3.6 (unit 3b's part);
 * SPEC §4, §14, harness/AGENTS.md §5, decisions 0007 item 2, 0020 item 5.
 *
 * - Before unmask: public state is identical whatever the faker, the word
 *   (same category) and the secret RNG (3.6.1).
 * - From unmask until the guess is submitted or times out: public state and
 *   the faker's private view are identical whatever the word (same
 *   category). The room is stricter and keeps the word hidden until the
 *   guess resolves (through judging), which these tests pin too.
 */

const pub = (s: RoomState): string => JSON.stringify(projectPublic(s));

function withWord(s: RoomState, word: WordEntry): RoomState {
  const old = s.round!.word!;
  return { ...s, usedWords: s.usedWords.map((w) => (w === old.word ? word.word : w)), round: { ...s.round!, word } };
}

/** Another faker, word, secret RNG, Mixed bag, and order-stream state (whose output is already in `cards`). */
function withOtherSecrets(s: RoomState, faker: string, word: WordEntry): RoomState {
  const v = withWord(s, word);
  return { ...v, rng: { s: (s.rng.s ^ 0x5bd1e995) >>> 0 }, orderRng: { s: (s.orderRng.s ^ 0x1234) >>> 0 }, bag: [...s.bag].reverse(), round: { ...v.round!, faker } };
}

/** One room captured in the slideshow and free browse, with votes, a lock and a removed player. */
function votingStates(): RoomState[] {
  const r = new RoomDriver(9);
  const [host, b, c, d, e] = r.joinMany(5);
  r.start(host!);
  r.advance(BRIEFING_BEAT_MS);
  // e goes dark during the draw and is removed: no card (0019 item 5).
  r.offline(e!);
  r.advance(BLIP_GRACE_MS);
  if (r.phase !== 'draw') throw new Error('seed must not make e the faker');
  r.intent(host!, { type: 'host:remove', playerId: e! });
  r.drawAll();
  const out = [r.state];
  r.intent(b!, { type: 'vote:set', targetId: c! });
  r.intent(c!, { type: 'vote:set', targetId: d! });
  r.intent(c!, { type: 'vote:lock' });
  r.intent(host!, { type: 'vote:set', targetId: b! });
  r.join('Late', 'teal');
  out.push(r.state);
  r.fireNext();
  expect(r.phase).toBe('browse');
  r.intent(d!, { type: 'vote:set', targetId: host! });
  out.push(r.state);
  return out;
}

describe('3.6.1 before unmask: public state is independent of faker, word and RNG', () => {
  it('in the slideshow and free browse, for every roster player as faker', () => {
    for (const s of votingStates()) {
      const base = pub(s);
      for (const f of s.round!.roster) expect(pub(withOtherSecrets(s, f, OTHER_WORD)), `${s.phase.name}, faker ${f}`).toBe(base);
    }
  });

  it('a scripted game with different fakers and words: identical public state and alarms until unmask; then only the faker differs', () => {
    const fakerFor = (seed: number): string => {
      const r = new RoomDriver(seed);
      const [h] = r.joinMany(4);
      r.intent(h!, { type: 'host:start' });
      return r.faker;
    };
    const seedA = 1;
    const seedB = [2, 3, 4, 5, 6, 7, 8, 9].find((s) => fakerFor(s) !== fakerFor(seedA))!;
    const play = (seed: number, word: WordEntry) => {
      const r = new RoomDriver(seed);
      const pubs: string[] = [];
      const alarms: (number | null)[] = [];
      const snap = () => {
        pubs.push(pub(r.state));
        alarms.push(nextDeadline(r.state));
      };
      const [a, b, c, d] = r.joinMany(4);
      r.start(a!, word);
      r.advance(BRIEFING_BEAT_MS);
      r.drawAll();
      snap();
      r.intent(a!, { type: 'vote:set', targetId: b! });
      r.intent(b!, { type: 'vote:set', targetId: c! });
      r.intent(b!, { type: 'vote:lock' });
      snap();
      // A blip and a disconnect past the grace: the faker or not, they look the same (0012 item 2).
      r.offline(c!);
      r.advance(1000);
      r.online(c!);
      r.offline(d!);
      r.advance(BLIP_GRACE_MS);
      snap();
      r.fireNext(); // slideshow end
      snap();
      r.intent(c!, { type: 'vote:set', targetId: a! });
      r.intent(a!, { type: 'vote:lock' });
      snap();
      r.intent(c!, { type: 'vote:lock' }); // the last connected lock (0016)
      snap();
      return { pubs, alarms, phase: r.phase };
    };
    const A = play(seedA, WORD);
    const B = play(seedB, OTHER_WORD);
    expect(A.phase).toBe('unmask');
    expect(B.alarms).toEqual(A.alarms);
    expect(B.pubs.slice(0, -1)).toEqual(A.pubs.slice(0, -1));
    const strip = (json: string) => JSON.stringify({ ...JSON.parse(json), round: { ...JSON.parse(json).round, faker: null } });
    expect(strip(B.pubs.at(-1)!)).toBe(strip(A.pubs.at(-1)!));
    expect(B.pubs.at(-1)).not.toBe(A.pubs.at(-1));
  });
});

/** One room at unmask, in the guess, and in judging. */
function revealStates(): { r: RoomDriver; states: RoomState[] } {
  const r = new RoomDriver(9);
  const [host] = r.joinMany(4);
  r.start(host!);
  r.advance(BRIEFING_BEAT_MS);
  r.drawAll();
  r.voteAll();
  const states = [r.state];
  r.fireNext();
  states.push(r.state);
  r.intent(r.faker, { type: 'guess:submit', text: 'parasol' });
  expect(r.phase).toBe('judging');
  const judge = r.state.round!.roster.find((id) => id !== r.faker)!;
  r.intent(judge, { type: 'guess:judge', accept: false });
  states.push(r.state);
  return { r, states };
}

describe('3.6.1 from unmask until the guess resolves: the word reaches neither public state nor the faker', () => {
  it('public state and the faker\'s private view are identical for any word of the same category', () => {
    const { states } = revealStates();
    for (const s of states) {
      const faker = s.round!.faker;
      const other = withWord(s, OTHER_WORD);
      expect(pub(other), s.phase.name).toBe(pub(s));
      expect(JSON.stringify(projectPrivate(other, faker))).toBe(JSON.stringify(projectPrivate(s, faker)));
      expect(projectPrivate(s, faker)!.round).toEqual({ no: 1, category: WORD.category, role: 'faker' });
    }
  });

  it('the guess resolving (here: the judging deadline) is what makes the word public', () => {
    const { r } = revealStates();
    expect(r.publicJson()).not.toContain(WORD.word);
    r.fireNext(); // judging deadline
    expect(r.phase).toBe('results');
    expect(projectPublic(r.state).round!.result!.word).toBe(WORD.word);
    for (const p of r.state.players) expect(r.privateOf(p.id)!.round).toBeNull();
  });
});

describe('3.6.2 slideshow to results: who gets what', () => {
  it('agents keep the word through judging, the faker never gets it, a late joiner gets nothing; no word or token in public', () => {
    const r = new RoomDriver(9);
    const [host] = r.joinMany(4);
    r.start(host!);
    r.advance(BRIEFING_BEAT_MS);
    r.drawAll();
    const late = r.join('Late', 'teal');
    const check = () => {
      const json = r.publicJson();
      for (const secret of [WORD.word, ...(WORD.alt ?? []), ...r.state.players.map((p) => p.token)]) expect(json, r.phase).not.toContain(secret);
      for (const p of r.state.players) {
        const view = r.privateOf(p.id)!;
        expect(view.you).toEqual({ id: p.id, token: p.token });
        if (p.id === late) expect(view.round).toBeNull();
        else if (p.id === r.faker) expect(view.round, r.phase).toEqual({ no: 1, category: WORD.category, role: 'faker' });
        else expect(view.round, r.phase).toEqual({ no: 1, category: WORD.category, role: 'agent', word: WORD.word });
      }
    };
    check(); // slideshow
    r.fireNext();
    check(); // browse
    r.voteAll();
    check(); // unmask
    r.fireNext();
    check(); // guess
    r.intent(r.faker, { type: 'guess:submit', text: 'rain hat' });
    check(); // judging
    r.state.round!.roster.filter((id) => id !== r.faker).forEach((id) => r.intent(id, { type: 'guess:judge', accept: true }));
    expect(r.phase).toBe('results');
    expect(r.publicJson()).toContain(WORD.word);
  });
});
