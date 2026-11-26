import { describe, expect, it } from 'vitest';
import { nextDeadline, projectPublic } from '../../../src/shared/core';
import { BLIP_GRACE_MS, BRIEFING_BEAT_MS, ROOM_EXPIRY_MS, SCRUBBED_BEAT_MS } from '../../../src/shared/core/rules';
import type { RoomState } from '../../../src/shared/core/state';
import type { WordEntry } from '../../../src/shared/guess';
import { OTHER_WORD, RoomDriver } from '../../helpers/room';

/**
 * Stage 3.3.5: game length, final results, `host:end` and Play again —
 * SPEC §4 "Final results", §7; decisions 0007 item 4, 0011, 0014 item 2,
 * 0019, 0020 items 2–4, 0023, 0024 item 1.
 */

const pub = (r: RoomDriver) => projectPublic(r.state);
const wordFor = (no: number): WordEntry => ({ word: `word${no}`, category: 'Things' });

/** From `dealing`: deal, brief, draw, vote, guess right; stops in round results. */
function playRound(r: RoomDriver): void {
  expect(r.phase).toBe('dealing');
  r.deal(wordFor(r.state.round!.no));
  r.advance(BRIEFING_BEAT_MS);
  r.drawAll();
  r.voteAll();
  r.fireNext();
  r.intent(r.faker, { type: 'guess:submit', text: r.state.round!.word!.word });
  expect(r.phase).toBe('results');
}

function game(n = 3, cycles = 1, seed = 1) {
  const r = new RoomDriver(seed);
  const ids = r.joinMany(n);
  r.intent(ids[0]!, { type: 'host:settings', settings: { cycles } });
  r.intent(ids[0]!, { type: 'host:start' });
  return { r, ids, host: ids[0]! };
}

describe('game length (0020 items 2–3)', () => {
  it('ends after cycles × roster-at-start completed rounds; a cancelled round does not count; late joiners do not extend it', () => {
    const { r } = game(3, 1);
    expect(pub(r).progress).toEqual({ completed: 0, total: 3 });
    playRound(r);
    r.fireNext();
    // Round 2 is cancelled: the faker drops in the briefing.
    r.deal(wordFor(2));
    const faker = r.faker;
    r.offline(faker);
    r.advance(BLIP_GRACE_MS);
    expect(r.phase).toBe('scrubbed');
    r.online(faker);
    r.join('Late', 'teal');
    r.advance(SCRUBBED_BEAT_MS);
    expect(pub(r).progress).toEqual({ completed: 1, total: 3 });
    expect(r.state.round!.roster).toHaveLength(4); // the late joiner is seated from the next round (0020 item 4)
    playRound(r);
    r.fireNext();
    playRound(r);
    expect(pub(r).progress).toEqual({ completed: 3, total: 3 });
    r.fireNext();
    expect(r.phase).toBe('final');
    expect(nextDeadline(r.state)).toBe(r.state.lastActivityAt + ROOM_EXPIRY_MS); // final has no deadline
  });

  it('the host can continue the last results into final results', () => {
    const { r, host } = game(3, 1);
    for (let i = 0; i < 3; i++) {
      playRound(r);
      if (i < 2) r.fireNext();
    }
    r.intent(host, { type: 'host:next', seq: pub(r).seq });
    expect(r.phase).toBe('final');
  });
});

describe('final results (§4, 0007 item 4)', () => {
  it('standings use shared placement over non-removed players, highest first, ties in room order', () => {
    const { r, ids, host } = game(5);
    const scores = [3, 5, 3, 1, 9];
    const gone = ids[3]!;
    r.state = { ...r.state, players: r.state.players.map((p, i) => ({ ...p, score: scores[i]! })) };
    r.offline(gone);
    r.advance(BLIP_GRACE_MS);
    r.intent(host, { type: 'host:remove', playerId: gone });
    r.intent(host, { type: 'host:end' });
    expect(pub(r).phase).toEqual({
      name: 'final',
      standings: [
        { id: ids[4], score: 9, place: 1 },
        { id: ids[1], score: 5, place: 2 },
        { id: ids[0], score: 3, place: 3 },
        { id: ids[2], score: 3, place: 3 },
      ],
    });
    // The removed player's score stays visible, greyed out (§7).
    expect(pub(r).players.find((p) => p.id === gone)).toMatchObject({ removed: true, score: 1 });
  });
});

describe('host:end (0010 item 4, 0011 item 3)', () => {
  it('ends the game mid-draw: no points, and the unfinished round reveals neither faker nor word', () => {
    const { r, ids, host } = game(4);
    r.deal(wordFor(1));
    r.advance(BRIEFING_BEAT_MS);
    r.intent(ids[1]!, { type: 'host:end' });
    expect(r.errors()).toEqual(['not_host']);
    r.intent(host, { type: 'host:end' });
    expect(r.phase).toBe('final');
    expect(pub(r).players.every((p) => p.score === 0)).toBe(true);
    expect(pub(r).round).toMatchObject({ faker: null, result: null });
    for (const p of r.state.players) expect(r.privateOf(p.id)!.round).toBeNull();
    const base = r.publicJson();
    for (const f of r.state.round!.roster) {
      const variant: RoomState = { ...r.state, rng: { s: 5 }, round: { ...r.state.round!, faker: f, word: OTHER_WORD } };
      expect(JSON.stringify(projectPublic(variant))).toBe(base);
    }
    r.intent(host, { type: 'host:end' });
    expect(r.errors()).toEqual(['wrong_phase']);
  });

  it('is refused in the lobby and works while paused, ending the pause', () => {
    const r = new RoomDriver(1);
    const ids = r.joinMany(3);
    r.intent(ids[0]!, { type: 'host:end' });
    expect(r.errors()).toEqual(['wrong_phase']);
    r.start(ids[0]!);
    r.offline(ids.find((id) => id !== ids[0] && id !== r.faker)!);
    r.advance(BLIP_GRACE_MS);
    expect(r.phase).toBe('draw');
    expect(r.state.pause).not.toBeNull();
    r.intent(ids[0]!, { type: 'host:end' });
    expect(r.phase).toBe('final');
    expect(pub(r).paused).toBeNull();
  });
});

describe('Play again (0014 item 2, 0019)', () => {
  function finished() {
    const ctx = game(4, 1);
    ctx.r.intent(ctx.host, { type: 'host:end' });
    return ctx;
  }

  it('host:next in final results returns to the lobby, once; scores, length and used words reset', () => {
    const { r, host } = game(3, 1);
    playRound(r);
    const roundNo = r.state.round!.no;
    r.intent(host, { type: 'host:end' });
    expect(pub(r).players.some((p) => p.score > 0)).toBe(true);
    const seq = pub(r).seq;
    r.intent(host, { type: 'host:next', seq });
    expect(r.phase).toBe('lobby');
    expect(r.last).toContainEqual({ type: 'clearDrawings', roundNo });
    expect(pub(r)).toMatchObject({ progress: null, round: null, paused: null });
    expect(pub(r).players.every((p) => p.score === 0 && p.seated)).toBe(true);
    expect(r.state.usedWords).toEqual([]);
    r.intent(host, { type: 'host:next', seq });
    expect(r.errors()).toEqual([]);
    expect(r.phase).toBe('lobby');
    r.intent(host, { type: 'host:settings', settings: { cycles: 3 } });
    expect(r.errors()).toEqual([]);
    r.intent(host, { type: 'host:start' });
    expect(pub(r).progress).toEqual({ completed: 0, total: 9 });
  });

  it('a player who joins during final results waits for the next game and is seated in the lobby', () => {
    const { r, host } = finished();
    const late = r.join('Late', 'teal');
    expect(pub(r).players.find((p) => p.id === late)!.seated).toBe(false);
    expect(r.privateOf(late)!.round).toBeNull();
    r.intent(host, { type: 'host:next', seq: pub(r).seq });
    expect(pub(r).players.find((p) => p.id === late)!.seated).toBe(true);
    r.intent(host, { type: 'host:start' });
    expect(r.state.round!.roster).toContain(late);
    expect(pub(r).progress!.total).toBe(1 * 5); // cycles stays as set: 1
  });

  it('a removed player stays removed (color and seat kept, score reset) and can still return (0019)', () => {
    const { r, ids, host } = game(4, 1);
    const gone = ids[3]!;
    r.state = { ...r.state, players: r.state.players.map((p) => (p.id === gone ? { ...p, score: 4 } : p)) };
    r.offline(gone);
    r.advance(BLIP_GRACE_MS);
    if (r.phase === 'scrubbed') r.advance(SCRUBBED_BEAT_MS);
    r.intent(host, { type: 'host:remove', playerId: gone });
    r.intent(host, { type: 'host:end' });
    r.intent(host, { type: 'host:next', seq: pub(r).seq });
    expect(pub(r).players.find((p) => p.id === gone)).toMatchObject({ removed: true, score: 0 });
    r.intent(host, { type: 'host:start' });
    expect(r.state.round!.roster).not.toContain(gone);
    expect(pub(r).progress!.total).toBe(1 * 3); // cycles 1 × the 3 non-removed
    const token = r.state.players.find((p) => p.id === gone)!.token;
    r.step({ kind: 'intent', conn: 'back', player: null, intent: { type: 'rejoin', token } });
    expect(pub(r).players.find((p) => p.id === gone)).toMatchObject({ removed: false, connected: true, seated: false });
  });
});

describe('between rounds: round results (0011, 0023, 0024 item 1)', () => {
  function inResults(n = 3, seed = 1) {
    const ctx = game(n, 2, seed);
    playRound(ctx.r);
    // Hold the continue (0004 rule 3) so it outlasts a blip grace.
    ctx.r.intent(ctx.host, { type: 'host:hold' });
    return ctx;
  }

  it('fewer than 3 ready pauses the results; a waiting newcomer counts and lifts it, and is seated next round', () => {
    const { r, ids, host } = inResults(3);
    const gone = ids.find((id) => id !== host)!;
    r.offline(gone);
    r.advance(BLIP_GRACE_MS);
    expect(pub(r).paused).not.toBeNull();
    expect(r.phase).toBe('results');
    // No 0023 restart between rounds: only the expiry is pending while paused.
    expect(nextDeadline(r.state)).toBe(r.state.lastActivityAt + ROOM_EXPIRY_MS);
    const late = r.join('Late', 'teal');
    expect(pub(r).paused).toBeNull();
    r.fireNext();
    expect(r.phase).toBe('dealing');
    expect(r.state.round!.roster).toContain(late);
    expect(r.state.round!.roster).toContain(gone); // disconnected, not removed: seated, card dark
    expect(r.state.round!.faker).not.toBe(gone); // the faker is picked from connected players
  });

  it('the results continue is frozen while paused and shifted on resume', () => {
    const { r, ids, host } = inResults(3);
    const due = nextDeadline(r.state)!;
    const gone = ids.find((id) => id !== host)!;
    r.offline(gone);
    r.advance(BLIP_GRACE_MS);
    const since = r.state.pause!.since;
    r.now = since + 20_000;
    r.online(gone);
    expect(nextDeadline(r.state)).toBe(due + 20_000);
  });

  it('"Rejoin as…" binds at once during results, and a request pending from the round is admitted when results open', () => {
    const r = new RoomDriver(1);
    const ids = r.joinMany(4);
    r.start(ids[0]!);
    r.advance(BRIEFING_BEAT_MS);
    const agent = ids.find((id) => id !== r.faker && id !== ids[0])!;
    r.offline(agent);
    r.advance(BLIP_GRACE_MS);
    r.drawAll();
    r.step({ kind: 'intent', conn: 'phone-2', player: null, intent: { type: 'rejoinAs', playerId: agent }, mintedToken: 'fresh' });
    expect(pub(r).rejoinRequests).toEqual([agent]);
    r.voteAll();
    r.fireNext();
    r.intent(r.faker, { type: 'guess:submit', text: 'umbrella' });
    expect(r.phase).toBe('results');
    expect(r.last).toContainEqual({ type: 'bind', conn: 'phone-2', player: agent });
    expect(pub(r).rejoinRequests).toEqual([]);
  });
});

describe('no pause from unmask on, nor on a finished game (0027 items 1–3)', () => {
  it('an agent dropping past the grace in the guess does not pause; the round reaches results, which then pause', () => {
    const r = new RoomDriver(1);
    const ids = r.joinMany(3);
    r.intent(ids[0]!, { type: 'host:start' });
    r.deal(wordFor(1));
    r.advance(BRIEFING_BEAT_MS);
    r.drawAll();
    r.voteAll();
    r.fireNext();
    expect(r.phase).toBe('guess');
    const agent = ids.find((id) => id !== r.faker && id !== ids[0]) ?? ids.find((id) => id !== r.faker)!;
    r.offline(agent);
    r.advance(BLIP_GRACE_MS);
    expect(pub(r).paused).toBeNull();
    expect(r.phase).toBe('guess');
    r.fireNext(); // guess timer: no guess
    expect(r.phase).toBe('results');
    expect(pub(r).round!.result).not.toBeNull();
    expect(pub(r).paused).not.toBeNull(); // between rounds now (0027 item 1)
    expect(nextDeadline(r.state)).toBe(r.state.lastActivityAt + ROOM_EXPIRY_MS); // no 0023 restart
  });

  it('a drop during the last round\'s results does not pause; host:next reaches final results', () => {
    const { r, ids, host } = game(3, 1);
    for (let i = 0; i < 3; i++) {
      playRound(r);
      if (i < 2) r.fireNext();
    }
    r.intent(host, { type: 'host:hold' });
    r.offline(ids.find((id) => id !== host)!);
    r.advance(BLIP_GRACE_MS);
    expect(pub(r).paused).toBeNull();
    r.intent(host, { type: 'host:next', seq: pub(r).seq });
    expect(r.phase).toBe('final');
  });

  it('guess intents while paused are refused with `paused` (defensive, item 3)', () => {
    const r = new RoomDriver(1);
    const ids = r.joinMany(4);
    r.start(ids[0]!);
    r.advance(BRIEFING_BEAT_MS);
    r.drawAll();
    r.voteAll();
    r.fireNext();
    r.state = { ...r.state, pause: { since: r.now } };
    r.intent(r.faker, { type: 'guess:submit', text: 'umbrella' });
    expect(r.errors()).toEqual(['paused']);
    r.state = { ...r.state, pause: null };
    r.intent(r.faker, { type: 'guess:submit', text: 'parasol' });
    r.state = { ...r.state, pause: { since: r.now } };
    r.intent(ids.find((id) => id !== r.faker)!, { type: 'guess:judge', accept: true });
    expect(r.errors()).toEqual(['paused']);
  });
});

describe('room-wide round numbers (0027 item 4)', () => {
  it('a stale wordDealt from the previous game is ignored after Play again; the new deal is accepted', () => {
    const r = new RoomDriver(1);
    const ids = r.joinMany(3);
    const host = ids[0]!;
    r.intent(host, { type: 'host:start' });
    expect(r.state.round!.no).toBe(1);
    r.intent(host, { type: 'host:end' });
    r.intent(host, { type: 'host:next', seq: pub(r).seq }); // Play again
    r.intent(host, { type: 'host:start' });
    expect(r.state.round!.no).toBe(2);
    expect(r.last).toContainEqual(expect.objectContaining({ type: 'dealWord', roundNo: 2 }));
    r.step({ kind: 'wordDealt', roundNo: 1, entry: wordFor(1) });
    expect(r.phase).toBe('dealing');
    r.step({ kind: 'wordDealt', roundNo: 2, entry: wordFor(2) });
    expect(r.phase).toBe('briefing');
    expect(r.state.round!.word!.word).toBe('word2');
  });
});

describe('no round starts with fewer than 3 who can play (§7, 0011; review round 2)', () => {
  /** Three players in the guess (one round of two cycles). */
  function inGuess() {
    const r = new RoomDriver(3);
    const ids = r.joinMany(3);
    r.intent(ids[0]!, { type: 'host:settings', settings: { cycles: 2 } });
    r.start(ids[0]!);
    r.advance(BRIEFING_BEAT_MS);
    r.drawAll();
    r.voteAll();
    r.fireNext();
    expect(r.phase).toBe('guess');
    return { r, judges: r.state.round!.roster.filter((id) => id !== r.faker) };
  }
  const deals = (r: RoomDriver) => r.effects.filter((e) => e.type === 'dealWord').length;

  it('a judging early end with a judge gone opens results paused; neither the alarm nor host:next starts round 2', () => {
    const { r, judges } = inGuess();
    r.offline(judges[0]!);
    r.advance(BLIP_GRACE_MS);
    r.intent(r.faker, { type: 'guess:submit', text: 'nope' });
    r.intent(judges[1]!, { type: 'guess:judge', accept: false });
    expect(r.phase).toBe('results');
    expect(pub(r).paused).not.toBeNull();
    const before = deals(r);
    r.fireNext();
    r.intent(r.state.hostId!, { type: 'host:next', seq: pub(r).seq });
    expect(r.phase).toBe('results');
    expect(deals(r)).toBe(before);
  });

  it('with only the faker connected, a wrong guess ends judging at once into paused results, not a round whose faker everyone knows', () => {
    const { r, judges } = inGuess();
    for (const id of judges) r.offline(id);
    r.advance(BLIP_GRACE_MS);
    r.intent(r.faker, { type: 'guess:submit', text: 'nope' });
    expect(r.phase).toBe('results');
    expect(pub(r).paused).not.toBeNull();
    r.fireNext();
    expect(r.phase).toBe('results');
    expect(r.state.round!.no).toBe(1);
  });

  /** Round results, unpaused, with two players' presence dropped behind settle's back. */
  function resultsWithTooFew() {
    const { r, judges } = inGuess();
    r.intent(r.faker, { type: 'guess:submit', text: 'umbrella' });
    expect(r.phase).toBe('results');
    const gone = new Set(judges);
    r.state = { ...r.state, players: r.state.players.map((p) => (gone.has(p.id) ? { ...p, presence: { online: false, connected: false, graceUntil: null } } : p)) };
    return r;
  }

  it('backstop: the results alarm with fewer than 3 ready pauses instead of starting a round', () => {
    const r = resultsWithTooFew();
    const before = deals(r);
    r.fireNext();
    expect(r.phase).toBe('results');
    expect(pub(r).paused).not.toBeNull();
    expect(deals(r)).toBe(before);
  });

  it('backstop: host:next in results with fewer than 3 ready pauses instead of starting a round', () => {
    const r = resultsWithTooFew();
    const before = deals(r);
    r.intent(r.state.hostId!, { type: 'host:next', seq: pub(r).seq });
    expect(pub(r).paused).not.toBeNull();
    expect(deals(r)).toBe(before);
    expect(r.state.round!.no).toBe(1);
  });
});
