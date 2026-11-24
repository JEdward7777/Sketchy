import { describe, expect, it } from 'vitest';
import { projectPublic } from '../../../src/shared/core';
import { nextDeadline } from '../../../src/shared/core/next-deadline';
import {
  BLIP_GRACE_MS,
  BRIEFING_BEAT_MS,
  DRAW_SUBMIT_GRACE_MS,
  HOLD_REARM_MS,
  NARRATION_CAP_MS,
  SCRUBBED_BEAT_MS,
} from '../../../src/shared/core/rules';
import { TIMER_PRESETS } from '../../../src/shared/timers';
import { OTHER_WORD, RoomDriver, STROKES, WORD, checkScrubbedSecretless } from '../../helpers/room';

/** Stage 3.3.2: briefing and draw — SPEC §4, §6, §7, §9; decisions 0003, 0004, 0009, 0012, 0017, 0020. */

const DRAW_MS = TIMER_PRESETS.normal.drawMs;

function briefedRoom(n = 3, seed = 1) {
  const r = new RoomDriver(seed);
  const ids = r.joinMany(n);
  r.start(ids[0]!);
  return { r, ids, host: ids[0]! };
}

describe('round start and the deal (§6, 0020)', () => {
  it('host:start deals a word with the used-word list and waits in dealing', () => {
    const r = new RoomDriver();
    const [host] = r.joinMany(3);
    const fx = r.intent(host!, { type: 'host:start' });
    expect(fx).toEqual([{ type: 'dealWord', roundNo: 1, difficulty: r.state.round!.difficulty, exclude: [] }]);
    expect(r.phase).toBe('dealing');
    expect(projectPublic(r.state).round).toMatchObject({ no: 1, category: null });
    expect(nextDeadline(r.state)).toBe(r.state.lastActivityAt + 2 * 60 * 60 * 1000); // only expiry
  });

  it('the dealt word starts the briefing, its category public, the word kept out of public state', () => {
    const { r } = briefedRoom();
    expect(r.phase).toBe('briefing');
    expect(r.state.usedWords).toEqual([WORD.word]);
    const pub = projectPublic(r.state);
    expect(pub.round?.category).toBe(WORD.category);
    expect(r.publicJson()).not.toContain(WORD.word);
  });

  it('ignores a stale deal and re-deals a word already used this game (§6)', () => {
    const r = new RoomDriver();
    const [host] = r.joinMany(3);
    r.intent(host!, { type: 'host:start' });
    r.step({ kind: 'wordDealt', roundNo: 7, entry: WORD });
    expect(r.phase).toBe('dealing');
    r.state = { ...r.state, usedWords: [WORD.word] };
    const fx = r.deal(WORD);
    expect(fx).toEqual([{ type: 'dealWord', roundNo: 1, difficulty: r.state.round!.difficulty, exclude: [WORD.word] }]);
    expect(r.phase).toBe('dealing');
    r.deal(OTHER_WORD);
    expect(r.phase).toBe('briefing');
  });

  it('Mixed takes each difficulty once per bag of three (2.8, 0007 item 3)', () => {
    const r = new RoomDriver(5);
    const [host] = r.joinMany(3);
    expect(r.state.settings.difficulty).toBe('mixed');
    r.intent(host!, { type: 'host:start' });
    const seen = [r.state.round!.difficulty];
    for (let i = 0; i < 2; i++) {
      // Cancel by disconnecting the faker; the next round deals again.
      r.offline(r.faker);
      r.advance(BLIP_GRACE_MS);
      expect(r.phase).toBe('scrubbed');
      r.online(r.state.players.find((p) => !p.presence.connected)!.id);
      r.advance(SCRUBBED_BEAT_MS);
      seen.push(r.state.round!.difficulty);
    }
    expect([...seen].sort()).toEqual(['abstract', 'concrete', 'medium']);
  });
});

describe('briefing beat with the 0004 continue (§4, 0004, 0017)', () => {
  it('auto-continues after BRIEFING_BEAT_MS into the draw', () => {
    const { r } = briefedRoom();
    const t = r.now;
    expect(nextDeadline(r.state)).toBe(t + BRIEFING_BEAT_MS);
    r.advance(BRIEFING_BEAT_MS - 1);
    expect(r.phase).toBe('briefing');
    r.advance(1);
    expect(r.phase).toBe('draw');
    expect(projectPublic(r.state).phase).toEqual({ name: 'draw', endsAt: t + BRIEFING_BEAT_MS + DRAW_MS, closesAt: t + BRIEFING_BEAT_MS + DRAW_MS + DRAW_SUBMIT_GRACE_MS });
  });

  it('a host hold re-arms the fill HOLD_REARM_MS after the tap; other players cannot hold', () => {
    const { r, host, ids } = briefedRoom();
    const t = r.now;
    r.intent(ids[1]!, { type: 'host:hold' });
    expect(nextDeadline(r.state)).toBe(t + BRIEFING_BEAT_MS);
    r.now += 2000;
    r.intent(host, { type: 'host:hold' });
    expect(projectPublic(r.state).phase).toMatchObject({ fillFrom: t + 2000 + HOLD_REARM_MS, continueAt: t + 2000 + HOLD_REARM_MS + BRIEFING_BEAT_MS });
  });

  it('narration holds the fill until it stops, capped at NARRATION_CAP_MS (0004 rule 2)', () => {
    const { r, host } = briefedRoom();
    const t = r.now;
    r.intent(host, { type: 'host:narration', speaking: true });
    expect(projectPublic(r.state).phase).toMatchObject({ hostSpeaking: true, continueAt: t + NARRATION_CAP_MS + BRIEFING_BEAT_MS });
    r.now += 3000;
    r.intent(host, { type: 'host:narration', speaking: false });
    expect(projectPublic(r.state).phase).toMatchObject({ hostSpeaking: false, continueAt: t + 3000 + BRIEFING_BEAT_MS });
  });

  it('a host reload inside the grace keeps the hold and the narration (0004 rule 5, 0012 item 2)', () => {
    const { r, host } = briefedRoom(4);
    const t = r.now;
    r.now += 1000;
    r.intent(host, { type: 'host:hold' });
    r.intent(host, { type: 'host:narration', speaking: true });
    const held = projectPublic(r.state).phase;
    r.now += 1000;
    r.offline(host);
    r.advance(BLIP_GRACE_MS - 1000);
    r.online(host);
    expect(projectPublic(r.state).phase).toEqual(held);
    expect(held).toMatchObject({ hostSpeaking: true, continueAt: t + 1000 + HOLD_REARM_MS + BRIEFING_BEAT_MS });
  });

  it('a hold longer than the draw timer, then the host disconnected: the draw still gets its full time from the release', () => {
    const { r, host } = briefedRoom(4);
    const t = r.now;
    for (const at of [1000, 56_000, 111_000]) {
      r.now = t + at;
      r.intent(host, { type: 'host:hold' });
    }
    expect(r.phase).toBe('briefing');
    r.now = t + 112_000;
    r.offline(host);
    r.fireNext(); // the host's grace runs out: the hold is released at that instant
    const release = t + 112_000 + BLIP_GRACE_MS;
    expect(r.now).toBe(release);
    expect(projectPublic(r.state).phase).toMatchObject({ name: 'briefing', continueAt: release + BRIEFING_BEAT_MS });
    r.fireNext();
    expect(projectPublic(r.state).phase).toMatchObject({ name: 'draw', endsAt: release + BRIEFING_BEAT_MS + DRAW_MS });
  });

  it('a narration released by the host disconnecting never puts the deadline before the release', () => {
    const { r, host } = briefedRoom(4);
    const t = r.now;
    r.intent(host, { type: 'host:narration', speaking: true }); // fill waits until t + NARRATION_CAP_MS
    r.offline(host);
    r.fireNext(); // grace runs out at t + BLIP_GRACE_MS, after the plain beat would have ended
    expect(r.now).toBe(t + BLIP_GRACE_MS);
    expect(projectPublic(r.state).phase).toMatchObject({ name: 'briefing', hostSpeaking: false, continueAt: t + BLIP_GRACE_MS + BRIEFING_BEAT_MS });
  });

  it('a release during a pause after a long hold gives no past deadline on resume (0011 item 3)', () => {
    const { r, host } = briefedRoom(4);
    const t = r.now;
    const [a, b] = r.state.round!.roster.filter((id) => id !== host && id !== r.faker);
    r.now = t + 1000;
    r.intent(host, { type: 'host:hold' });
    r.now = t + 2000;
    r.offline(a!);
    r.offline(b!);
    r.fireNext(); // paused at t + 2000 + grace
    const since = r.state.pause!.since;
    r.now = since + 1000;
    r.offline(host);
    r.fireNext(); // host grace runs out during the pause: release
    expect(r.state.pause).not.toBeNull();
    r.now = since + 25_000;
    r.online(a!);
    r.online(b!); // resume
    expect(r.state.pause).toBeNull();
    expect(r.phase).toBe('briefing');
    expect(nextDeadline(r.state)).toBeGreaterThanOrEqual(r.now);
    expect(projectPublic(r.state).phase).toMatchObject({ continueAt: r.now + BRIEFING_BEAT_MS });
  });

  it('host:next continues once; a duplicate for a phase already left is ignored (0004 rules 4, 6)', () => {
    const { r, host } = briefedRoom();
    const seq = projectPublic(r.state).seq;
    r.intent(host, { type: 'host:next', seq });
    expect(r.phase).toBe('draw');
    const drawState = r.state;
    r.intent(host, { type: 'host:next', seq });
    expect(r.errors()).toEqual([]);
    expect(r.state.phase).toEqual(drawState.phase);
  });
});

describe('draw (§4, §9, 0009, 0012)', () => {
  function drawing(n = 3, seed = 1) {
    const ctx = briefedRoom(n, seed);
    ctx.r.advance(BRIEFING_BEAT_MS);
    return ctx;
  }

  it('validates strokes with the codec and emits one store per drawing, keeping only a reference in state', () => {
    const { r, ids } = drawing();
    r.intent(ids[1]!, { type: 'draw:done', strokes: [{ c: 99, s: 0, p: [1, 1] }] });
    expect(r.errors()).toEqual(['bad_strokes']);
    const fx = r.intent(ids[1]!, { type: 'draw:done', strokes: STROKES });
    expect(fx).toEqual([{ type: 'storeDrawing', key: `1:${ids[1]}`, strokes: STROKES }]);
    expect(r.state.round!.drawings[ids[1]!]).toEqual({ key: `1:${ids[1]}`, stored: false });
    r.step({ kind: 'drawingStored', key: `1:${ids[1]}` });
    expect(r.state.round!.drawings[ids[1]!]).toEqual({ key: `1:${ids[1]}`, stored: true });
    r.intent(ids[1]!, { type: 'draw:done', strokes: STROKES });
    expect(r.errors()).toEqual(['already_done']);
    expect(projectPublic(r.state).round!.done).toEqual([ids[1]]);
  });

  it('refuses draw:done outside the draw and from a waiting late joiner', () => {
    const { r, ids } = briefedRoom();
    r.intent(ids[1]!, { type: 'draw:done', strokes: STROKES });
    expect(r.errors()).toEqual(['wrong_phase']);
    const late = r.join('Late', 'teal');
    r.advance(BRIEFING_BEAT_MS);
    r.intent(late, { type: 'draw:done', strokes: STROKES });
    expect(r.errors()).toEqual(['not_in_round']);
  });

  it('ends early once every connected roster player is done; a waiting late joiner does not hold it up', () => {
    const { r, ids } = drawing();
    r.join('Late', 'teal');
    for (const id of ids.slice(0, -1)) r.intent(id, { type: 'draw:done', strokes: STROKES });
    expect(r.phase).toBe('draw');
    r.intent(ids.at(-1)!, { type: 'draw:done', strokes: STROKES });
    expect(projectPublic(r.state).phase).toEqual({ name: 'slideshow', startsAt: r.now });
  });

  it('waits for a player inside the blip grace, not for one disconnected after it (0012 items 2, 5)', () => {
    const { r, ids } = drawing(4);
    const gone = ids.find((id) => id !== r.faker && id !== ids[0])!;
    for (const id of ids) if (id !== gone) r.intent(id, { type: 'draw:done', strokes: STROKES });
    expect(r.phase).toBe('draw');
    r.offline(gone);
    expect(r.phase).toBe('draw'); // still inside the grace
    r.advance(BLIP_GRACE_MS);
    expect(r.phase).toBe('slideshow');
  });

  it('accepts a submission up to DRAW_SUBMIT_GRACE_MS after the deadline; a timeout starts the slideshow at deadline + grace', () => {
    const { r, ids } = drawing();
    const endsAt = (r.state.phase as { endsAt: number }).endsAt;
    r.now = endsAt + DRAW_SUBMIT_GRACE_MS - 1;
    r.intent(ids[1]!, { type: 'draw:done', strokes: STROKES });
    expect(r.errors()).toEqual([]);
    // The alarm fires late; the slideshow still starts at the close instant.
    r.now = endsAt + DRAW_SUBMIT_GRACE_MS + 5000;
    r.intent(ids[2]!, { type: 'draw:done', strokes: STROKES });
    expect(r.errors()).toEqual(['wrong_phase']);
    expect(projectPublic(r.state).phase).toEqual({ name: 'slideshow', startsAt: endsAt + DRAW_SUBMIT_GRACE_MS });
  });
});

describe('faker disconnect (§7, 0003 item 4, 0012, 0020 item 3)', () => {
  for (const phase of ['dealing', 'briefing', 'draw'] as const) {
    it(`cancels the round in ${phase} once the grace runs out`, () => {
      const r = new RoomDriver(3);
      const [host] = r.joinMany(4);
      r.intent(host!, { type: 'host:start' });
      if (phase !== 'dealing') r.deal();
      if (phase === 'draw') r.advance(BRIEFING_BEAT_MS);
      expect(r.phase).toBe(phase);
      const faker = r.faker;
      if (phase === 'draw') r.intent(faker, { type: 'draw:done', strokes: STROKES });
      r.offline(faker);
      r.advance(BLIP_GRACE_MS);
      expect(r.phase).toBe('scrubbed');
      expect(checkScrubbedSecretless(r.state)).toEqual([]);
      expect(r.last).toContainEqual({ type: 'clearDrawings', roundNo: 1 });
      expect(projectPublic(r.state).progress).toEqual({ completed: 0, total: 2 * 4 });
      expect(projectPublic(r.state).round!.done).toEqual([]);
      // The next round starts after the scrubbed beat with a fresh pick from connected players.
      r.advance(SCRUBBED_BEAT_MS);
      expect(r.phase).toBe('dealing');
      expect(r.state.round!.no).toBe(2);
      expect(r.faker).not.toBe(faker);
      expect(r.last).toContainEqual({ type: 'dealWord', roundNo: 2, difficulty: r.state.round!.difficulty, exclude: [...r.state.usedWords] });
    });
  }

  it('a faker who reconnects within the grace does not cancel (0012 item 2)', () => {
    const { r } = briefedRoom(4);
    r.offline(r.faker);
    r.advance(BLIP_GRACE_MS - 1);
    r.online(r.faker);
    r.advance(BLIP_GRACE_MS);
    expect(r.phase).toBe('draw');
  });

  it('does not cancel after drawing (0012 item 1)', () => {
    const { r, ids } = briefedRoom(4);
    r.advance(BRIEFING_BEAT_MS);
    for (const id of ids) r.intent(id, { type: 'draw:done', strokes: STROKES });
    expect(r.phase).toBe('slideshow');
    r.offline(r.faker);
    r.advance(BLIP_GRACE_MS);
    expect(r.phase).toBe('slideshow');
  });
});
