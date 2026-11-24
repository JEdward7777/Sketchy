import { describe, expect, it } from 'vitest';
import { nextDeadline, projectPrivate, projectPublic } from '../../../src/shared/core';
import { BLIP_GRACE_MS, BRIEFING_BEAT_MS } from '../../../src/shared/core/rules';
import type { RoomState } from '../../../src/shared/core/state';
import type { WordEntry } from '../../../src/shared/guess';
import { OTHER_WORD, RoomDriver, STROKES, WORD } from '../../helpers/room';

/**
 * Secrecy for lobby, briefing and draw — stage 3.6 (unit 3a's part);
 * SPEC §14, harness/AGENTS.md §5, decisions 0006, 0009, 0012 item 2, 0020
 * item 5. Every comparison is of serialized projections, because player ids
 * are public and the faker's id always appears somewhere: the property is
 * indistinguishability, not absence of a string.
 */

const pub = (s: RoomState): string => JSON.stringify(projectPublic(s));

/** The same state with another faker, word (same category), RNG and Mixed bag. */
function withOtherSecrets(s: RoomState, faker: string, word: WordEntry): RoomState {
  const round = s.round!;
  const old = round.word;
  return {
    ...s,
    rng: { s: (s.rng.s ^ 0x5bd1e995) >>> 0 },
    bag: [...s.bag].reverse(),
    usedWords: old ? s.usedWords.map((w) => (w === old.word ? word.word : w)) : s.usedWords,
    round: { ...round, faker, word: old ? word : null },
  };
}

/** One room, captured at each pre-unmask phase 3a implements. */
function capturedStates(): RoomState[] {
  const r = new RoomDriver(9);
  const [host, b] = r.joinMany(4);
  r.intent(host!, { type: 'host:start' });
  const out = [r.state];
  r.deal(WORD);
  r.intent(host!, { type: 'host:hold' });
  out.push(r.state);
  r.advance(BRIEFING_BEAT_MS + 60_000);
  r.intent(b!, { type: 'draw:done', strokes: STROKES });
  r.join('Late', 'teal');
  out.push(r.state);
  for (const id of r.state.round!.roster) r.intent(id, { type: 'draw:done', strokes: STROKES });
  expect(r.phase).toBe('slideshow');
  out.push(r.state);
  return out;
}

describe('3.6.1 projectPublic is identical whatever the word, the faker and the RNG', () => {
  it('for every roster player as faker, in dealing, briefing, draw and the slideshow stub', () => {
    for (const s of capturedStates()) {
      const base = pub(s);
      for (const f of s.round!.roster) {
        expect(pub(withOtherSecrets(s, f, OTHER_WORD)), `${s.phase.name}, faker ${f}`).toBe(base);
      }
    }
  });

  it('along a whole scripted game start: seeds with different fakers and different words give the same public state at every step', () => {
    // Two seeds whose first faker differs.
    const fakerFor = (seed: number): string => {
      const r = new RoomDriver(seed);
      const [h] = r.joinMany(4);
      r.intent(h!, { type: 'host:start' });
      return r.faker;
    };
    const seedA = 1;
    const seedB = [2, 3, 4, 5, 6, 7, 8, 9].find((s) => fakerFor(s) !== fakerFor(seedA))!;
    const blip = ['p1', 'p2', 'p3', 'p4'].find((id) => id !== fakerFor(seedA) && id !== fakerFor(seedB))!;

    const play = (seed: number, word: WordEntry): { pubs: string[]; alarms: (number | null)[] } => {
      const r = new RoomDriver(seed);
      const pubs: string[] = [];
      const alarms: (number | null)[] = [];
      const snap = () => {
        pubs.push(pub(r.state));
        alarms.push(nextDeadline(r.state));
      };
      const [h, b, c] = r.joinMany(4);
      snap();
      r.intent(h!, { type: 'host:settings', settings: { difficulty: 'mixed' } });
      r.intent(h!, { type: 'host:start' });
      snap();
      r.deal(word);
      snap();
      r.intent(h!, { type: 'host:narration', speaking: true });
      r.advance(2000);
      r.intent(h!, { type: 'host:narration', speaking: false });
      snap();
      r.offline(blip);
      r.advance(BLIP_GRACE_MS - 1);
      snap();
      r.online(blip);
      r.intent(h!, { type: 'host:next', seq: r.state.phaseSeq });
      snap();
      r.intent(b!, { type: 'draw:done', strokes: STROKES });
      r.intent(c!, { type: 'draw:done', strokes: STROKES });
      snap();
      r.join('Late', 'teal');
      snap();
      r.fireNext();
      snap();
      return { pubs, alarms };
    };
    const a = play(seedA, WORD);
    const b = play(seedB, OTHER_WORD);
    expect(b.pubs).toEqual(a.pubs);
    expect(b.alarms).toEqual(a.alarms);
    expect(a.pubs.at(-1)).toContain('"slideshow"');
  });

  for (const phase of ['briefing', 'draw'] as const) {
    it(`a faker disconnect and a non-faker disconnect look the same until the cancel itself (${phase}, 0012 item 2)`, () => {
      const r = new RoomDriver(9);
      const [host] = r.joinMany(4);
      r.start(host!);
      if (phase === 'draw') r.advance(BRIEFING_BEAT_MS);
      const leaver = r.state.round!.roster.find((id) => id !== host)!;
      const other = r.state.round!.roster.find((id) => id !== host && id !== leaver)!;
      // Same room twice: in one the leaver is the faker, in the other not.
      const asFaker = new RoomDriver(9);
      const asAgent = new RoomDriver(9);
      asFaker.state = withOtherSecrets(r.state, leaver, WORD);
      asAgent.state = withOtherSecrets(r.state, other, WORD);
      asFaker.now = asAgent.now = r.now;
      const both = (f: (d: RoomDriver) => void) => [asFaker, asAgent].forEach(f);
      both((d) => d.offline(leaver));
      // Through the whole grace: identical public state and identical alarm times,
      // so no faker-only deadline exists anywhere.
      for (let t = 0; t < BLIP_GRACE_MS; t += 1000) {
        expect(pub(asAgent.state)).toBe(pub(asFaker.state));
        expect(nextDeadline(asAgent.state)).toBe(nextDeadline(asFaker.state));
        both((d) => d.advance(Math.min(1000, BLIP_GRACE_MS - 1 - t)));
      }
      expect(pub(asAgent.state)).toBe(pub(asFaker.state));
      // The cancel itself is the exempt transition (§7).
      both((d) => d.advance(1));
      expect(asFaker.phase).toBe('scrubbed');
      expect(asAgent.phase).not.toBe('scrubbed');
    });
  }
});

describe('3.6.2 words, roles and tokens reach only their owners', () => {
  it('no word, alt or token ever appears in serialized public state', () => {
    const r = new RoomDriver(9);
    const tokens = () => r.state.players.map((p) => p.token);
    const check = () => {
      const json = r.publicJson();
      for (const secret of [WORD.word, ...(WORD.alt ?? []), ...tokens()]) expect(json).not.toContain(secret);
    };
    const [host, b] = r.joinMany(4);
    check();
    r.intent(host!, { type: 'host:start' });
    check();
    r.deal(WORD);
    check();
    r.advance(BRIEFING_BEAT_MS);
    r.intent(b!, { type: 'draw:done', strokes: STROKES });
    check();
    r.fireNext();
    expect(r.phase).toBe('slideshow');
    check();
  });

  it('projectPrivate: word to roster non-fakers only, faker role to the faker only, nothing round-specific to a waiting late joiner, own token only', () => {
    const r = new RoomDriver(9);
    const [host] = r.joinMany(4);
    r.intent(host!, { type: 'host:start' });
    // While dealing nobody has a round view yet.
    for (const p of r.state.players) expect(r.privateOf(p.id)!.round).toBeNull();
    r.deal(WORD);
    const late = r.join('Late', 'teal');
    for (const phase of ['briefing', 'draw']) {
      expect(r.phase).toBe(phase);
      for (const p of r.state.players) {
        const view = r.privateOf(p.id)!;
        const json = JSON.stringify(view);
        expect(view.you).toEqual({ id: p.id, token: p.token });
        for (const q of r.state.players) if (q.id !== p.id) expect(json).not.toContain(q.token);
        if (p.id === late) {
          expect(view.round).toBeNull();
        } else if (p.id === r.faker) {
          expect(view.round).toEqual({ no: 1, category: WORD.category, role: 'faker' });
          expect(json).not.toContain(WORD.word);
        } else {
          expect(view.round).toEqual({ no: 1, category: WORD.category, role: 'agent', word: WORD.word });
          expect(json).not.toContain('faker');
        }
      }
      r.advance(BRIEFING_BEAT_MS);
    }
    expect(projectPrivate(r.state, 'nobody')).toBeNull();
  });

  it('stroke data never appears in either projection, only that a drawing exists (0006, 0009)', () => {
    const r = new RoomDriver(9);
    const ids = r.joinMany(3);
    r.start(ids[0]!);
    r.advance(BRIEFING_BEAT_MS);
    const twin = new RoomDriver(9);
    twin.state = r.state;
    twin.now = r.now;
    r.intent(ids[1]!, { type: 'draw:done', strokes: STROKES });
    twin.intent(ids[1]!, { type: 'draw:done', strokes: [{ c: 5, s: 2, p: [799, 599, 0, 0, 400, 300] }] });
    expect(twin.publicJson()).toBe(r.publicJson());
    for (const id of ids) expect(JSON.stringify(twin.privateOf(id))).toBe(JSON.stringify(r.privateOf(id)));
    expect(JSON.stringify(r.state)).not.toContain('"p":');
  });
});
