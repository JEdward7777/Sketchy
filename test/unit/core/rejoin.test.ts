import { describe, expect, it } from 'vitest';
import { nextDeadline, projectPrivate, projectPublic } from '../../../src/shared/core';
import type { Effect } from '../../../src/shared/core/io';
import { BLIP_GRACE_MS, BRIEFING_BEAT_MS, SCRUBBED_BEAT_MS } from '../../../src/shared/core/rules';
import type { RoomState } from '../../../src/shared/core/state';
import { OTHER_WORD, RoomDriver, STROKES, WORD } from '../../helpers/room';

/**
 * "Rejoin as…" during a round needs the host's OK and rotates the token —
 * decision 0024, amending SPEC §7 and 0019 item 1. The secrecy cases belong
 * to stage 3.6.2 (AGENTS.md §5): a requesting socket must learn nothing
 * private before the host admits it.
 */

const pub = (s: RoomState): string => JSON.stringify(projectPublic(s));

/**
 * What one socket would receive, as the adapter will deliver it: every
 * `send` addressed to it, plus `projectPrivate` of the player it is bound
 * to (from `bind` effects), if any.
 */
class SocketView {
  bound: string | null = null;
  received: string[] = [];
  constructor(readonly conn: string) {}
  observe(state: RoomState, fx: readonly Effect[]): void {
    for (const e of fx) {
      if (e.type === 'bind' && e.conn === this.conn) this.bound = e.player;
      if (e.type === 'send' && e.conn === this.conn) this.received.push(JSON.stringify(e.msg));
    }
    if (this.bound) this.received.push(JSON.stringify(projectPrivate(state, this.bound)));
  }
}

function rejoinAsFrom(r: RoomDriver, conn: string, playerId: string, token: string): Effect[] {
  return r.step({ kind: 'intent', conn, player: null, intent: { type: 'rejoinAs', playerId }, mintedToken: token });
}

/** The first seed from 1 whose first faker in a 4-player room is not the host. */
function hostNotFakerSeed(): number {
  for (let seed = 1; ; seed++) {
    const r = new RoomDriver(seed);
    const ids = r.joinMany(4);
    r.intent(ids[0]!, { type: 'host:start' });
    if (r.faker !== ids[0]) return seed;
  }
}
const SEED = hostNotFakerSeed();

/** Four players, all drawn, in the slideshow; the faker then drops past the grace (the round continues, 0012 item 1). */
function slideshowWithFakerGone(seed = SEED) {
  const r = new RoomDriver(seed);
  const ids = r.joinMany(4);
  r.start(ids[0]!);
  r.advance(BRIEFING_BEAT_MS);
  for (const id of ids) r.intent(id, { type: 'draw:done', strokes: STROKES });
  expect(r.phase).toBe('slideshow');
  const faker = r.faker;
  r.offline(faker);
  r.advance(BLIP_GRACE_MS);
  expect(r.phase).toBe('slideshow');
  return { r, ids, host: ids[0]!, faker };
}

describe('3.6.2: a mid-round "Rejoin as…" learns nothing before the host admits it (0024 item 2)', () => {
  it('a socket asking for the dropped faker gets neither the faker role nor the word until approved', () => {
    const { r, host, faker } = slideshowWithFakerGone();
    if (faker === host) throw new Error('seed must not make the host the faker');
    const snoop = new SocketView('snoop');
    snoop.observe(r.state, rejoinAsFrom(r, 'snoop', faker, 'snoop-token'));
    snoop.observe(r.state, r.advance(1000));
    expect(snoop.bound).toBeNull();
    for (const m of snoop.received) {
      expect(m).not.toContain('faker');
      expect(m).not.toContain(WORD.word);
      expect(m).not.toContain('token');
    }
    expect(snoop.received).toEqual([JSON.stringify({ type: 'rejoin', playerId: faker, status: 'pending' })]);
    expect(projectPublic(r.state).rejoinRequests).toEqual([faker]);
    expect(r.publicJson()).not.toContain('snoop');
    // Declined: still nothing private.
    snoop.observe(r.state, r.intent(host, { type: 'host:admit', playerId: faker, approve: false }));
    expect(snoop.bound).toBeNull();
    expect(snoop.received.at(-1)).toBe(JSON.stringify({ type: 'rejoin', playerId: faker, status: 'declined' }));
    expect(projectPublic(r.state).rejoinRequests).toEqual([]);
  });

  for (const phase of ['dealing', 'briefing', 'draw', 'slideshow'] as const) {
    it(`in ${phase}: a socket asking for a dropped agent's seat gets no bind, no word and no token before admission`, () => {
      const r = new RoomDriver(SEED);
      const ids = r.joinMany(4);
      const host = ids[0]!;
      r.intent(host, { type: 'host:start' });
      if (phase !== 'dealing') r.deal(WORD);
      if (phase === 'briefing') r.intent(host, { type: 'host:hold' }); // keep the briefing through the grace
      if (phase === 'draw' || phase === 'slideshow') r.advance(BRIEFING_BEAT_MS);
      const agent = ids.find((id) => id !== r.faker && id !== host)!;
      if (phase === 'slideshow') for (const id of ids) r.intent(id, { type: 'draw:done', strokes: STROKES });
      r.offline(agent);
      r.advance(BLIP_GRACE_MS);
      expect(r.phase).toBe(phase);
      // E.g. the faker's second tab trying to read the word (0024 "Why").
      const tab = new SocketView('tab-2');
      tab.observe(r.state, rejoinAsFrom(r, 'tab-2', agent, 'tab-token'));
      tab.observe(r.state, r.advance(1000));
      expect(tab.bound).toBeNull();
      for (const m of tab.received) {
        expect(m).not.toContain(WORD.word);
        expect(m).not.toContain('token');
        expect(m).not.toContain('faker');
      }
      expect(projectPublic(r.state).rejoinRequests).toEqual([agent]);
    });
  }

  it('public state with a pending request is the same whoever the faker is and whatever the word (3.6.1, 0024 item 4)', () => {
    const { r, faker } = slideshowWithFakerGone();
    rejoinAsFrom(r, 'snoop', faker, 'snoop-token');
    const base = pub(r.state);
    for (const f of r.state.round!.roster) {
      const variant: RoomState = { ...r.state, round: { ...r.state.round!, faker: f, word: OTHER_WORD }, rng: { s: 77 } };
      expect(pub(variant)).toBe(base);
    }
  });

  it('blip graces running during a pause are the same for a faker and a non-faker (review round 1, item C)', () => {
    const r = new RoomDriver(2);
    const ids = r.joinMany(5);
    r.start(ids[0]!);
    const others = ids.filter((id) => id !== r.faker && id !== ids[0]);
    for (const id of others.slice(0, 2)) r.offline(id);
    r.advance(BLIP_GRACE_MS);
    r.offline(others[2]!);
    r.advance(BLIP_GRACE_MS);
    expect(r.state.pause).not.toBeNull();
    const leaver = others[3] ?? r.faker; // any roster player but the host
    const stay = ids.find((id) => id !== leaver && id !== ids[0])!;
    const [asFaker, asAgent] = [leaver, stay].map((f) => {
      const d = new RoomDriver(2);
      d.state = { ...r.state, round: { ...r.state.round!, faker: f } };
      d.now = r.now;
      return d;
    });
    for (const d of [asFaker!, asAgent!]) d.offline(leaver);
    for (let t = 0; t <= BLIP_GRACE_MS; t += 2500) {
      expect(pub(asAgent!.state)).toBe(pub(asFaker!.state));
      expect(nextDeadline(asAgent!.state)).toBe(nextDeadline(asFaker!.state));
      for (const d of [asFaker!, asAgent!]) d.advance(2500);
    }
    expect(projectPublic(asFaker!.state).players.find((p) => p.id === leaver)!.connected).toBe(false);
  });
});

describe('host:admit and the token rotation (0024 items 2–3)', () => {
  it('approval binds the requesting socket with a rotated token; the old token stops working', () => {
    const { r, host, faker } = slideshowWithFakerGone();
    const oldToken = r.state.players.find((p) => p.id === faker)!.token;
    rejoinAsFrom(r, 'new-phone', faker, 'rotated');
    r.intent(r.state.players.find((p) => p.id !== host && p.presence.connected)!.id, { type: 'host:admit', playerId: faker, approve: true });
    expect(r.errors()).toEqual(['not_host']);
    expect(r.intent(host, { type: 'host:admit', playerId: faker, approve: true })).toEqual([{ type: 'bind', conn: 'new-phone', player: faker }]);
    expect(projectPrivate(r.state, faker)!.you.token).toBe('rotated');
    r.offline(faker);
    r.step({ kind: 'intent', conn: 'old-phone', player: null, intent: { type: 'rejoin', token: oldToken } });
    expect(r.errors()).toEqual(['unknown_token']);
    r.step({ kind: 'intent', conn: 'new-phone-again', player: null, intent: { type: 'rejoin', token: 'rotated' } });
    expect(r.errors()).toEqual([]);
  });

  it('refuses a second request for the same player and an admit with no request', () => {
    const { r, host, faker } = slideshowWithFakerGone();
    rejoinAsFrom(r, 'a', faker, 'ta');
    rejoinAsFrom(r, 'b', faker, 'tb');
    expect(r.errors()).toEqual(['rejoin_pending']);
    r.intent(host, { type: 'host:admit', playerId: host, approve: true });
    expect(r.errors()).toEqual(['no_request']);
  });

  it('a request lapses when the player comes back by token, or when its socket closes', () => {
    const { r, faker } = slideshowWithFakerGone();
    const token = r.state.players.find((p) => p.id === faker)!.token;
    rejoinAsFrom(r, 'snoop', faker, 'snoop-token');
    const fx = r.step({ kind: 'intent', conn: 'own-phone', player: null, intent: { type: 'rejoin', token } });
    expect(fx).toContainEqual({ type: 'send', conn: 'snoop', msg: { type: 'rejoin', playerId: faker, status: 'cancelled' } });
    expect(projectPublic(r.state).rejoinRequests).toEqual([]);
    r.offline(faker);
    r.advance(BLIP_GRACE_MS);
    rejoinAsFrom(r, 'snoop2', faker, 'snoop2-token');
    r.step({ kind: 'connClosed', conn: 'snoop2' });
    expect(projectPublic(r.state).rejoinRequests).toEqual([]);
  });

  it('a request for the disconnected host waits for the round to end, then binds (0024 item 2)', () => {
    const r = new RoomDriver(SEED);
    const ids = r.joinMany(4);
    r.start(ids[0]!);
    const host = ids[0]!;
    if (r.faker === host) throw new Error('seed must not make the host the faker');
    r.offline(host);
    r.advance(BLIP_GRACE_MS);
    rejoinAsFrom(r, 'host-new-phone', host, 'host-rotated');
    expect(r.last.some((e) => e.type === 'bind')).toBe(false);
    // The round ends (here: the faker drops, §7) — between rounds the request becomes a rejoin.
    r.offline(r.faker);
    const fx = r.advance(BLIP_GRACE_MS);
    expect(r.phase).toBe('scrubbed');
    expect(fx).toContainEqual({ type: 'bind', conn: 'host-new-phone', player: host });
    expect(projectPrivate(r.state, host)!.you.token).toBe('host-rotated');
    expect(projectPublic(r.state).rejoinRequests).toEqual([]);
    r.advance(SCRUBBED_BEAT_MS);
    expect(r.phase).toBe('dealing');
  });

  it('a refused join or rejoin from the asking socket keeps its request; a successful one drops it (review round 2)', () => {
    const { r, faker } = slideshowWithFakerGone();
    rejoinAsFrom(r, 'asker', faker, 'asker-token');
    r.step({ kind: 'intent', conn: 'asker', player: null, intent: { type: 'join', name: 'X', color: 'red', icon: 'fedora' }, mintedToken: 'x1' });
    expect(r.errors()).toEqual(['color_taken']);
    r.step({ kind: 'intent', conn: 'asker', player: null, intent: { type: 'rejoin', token: 'nope' } });
    expect(r.errors()).toEqual(['unknown_token']);
    expect(projectPublic(r.state).rejoinRequests).toEqual([faker]);
    r.step({ kind: 'intent', conn: 'asker', player: null, intent: { type: 'join', name: 'X', color: 'teal', icon: 'fedora' }, mintedToken: 'x2' });
    expect(projectPublic(r.state).rejoinRequests).toEqual([]);
  });

  it('the same socket asking again for the same player replaces its request silently (review round 2)', () => {
    const { r, host, faker } = slideshowWithFakerGone();
    rejoinAsFrom(r, 'asker', faker, 'first');
    const fx = rejoinAsFrom(r, 'asker', faker, 'second');
    expect(r.errors()).toEqual([]);
    expect(fx).toEqual([{ type: 'send', conn: 'asker', msg: { type: 'rejoin', playerId: faker, status: 'pending' } }]);
    r.intent(host, { type: 'host:admit', playerId: faker, approve: true });
    expect(projectPrivate(r.state, faker)!.you.token).toBe('second');
  });

  it('a presence connect for a removed player is ignored; they return through rejoin (0019)', () => {
    const { r, host, faker } = slideshowWithFakerGone();
    r.intent(host, { type: 'host:remove', playerId: faker });
    r.online(faker);
    expect(projectPublic(r.state).players.find((p) => p.id === faker)).toMatchObject({ removed: true, connected: false });
  });

});

describe('an unbound socket racing an overdue alarm (review round 3)', () => {
  /** Draw phase: agent X dropped and S asked to rejoin as X; then the faker drops. Returns the instant the faker's grace ran out. */
  function racing() {
    const r = new RoomDriver(SEED);
    const ids = r.joinMany(5);
    r.start(ids[0]!);
    r.advance(BRIEFING_BEAT_MS);
    const x = ids.find((id) => id !== r.faker && id !== ids[0])!;
    r.offline(x);
    r.advance(BLIP_GRACE_MS);
    rejoinAsFrom(r, 'S', x, 'S-token');
    expect(projectPublic(r.state).rejoinRequests).toEqual([x]);
    r.offline(r.faker);
    const due = nextDeadline(r.state)!;
    r.now = due + 5; // S's frame arrives before the alarm for the faker's grace
    return { r, x, due };
  }
  const binds = (fx: readonly Effect[]) => fx.filter((e) => e.type === 'bind');

  it('connClosed is applied before the overdue cancel, so the closed socket is never admitted', () => {
    const { r, x } = racing();
    const fx = r.step({ kind: 'connClosed', conn: 'S' });
    expect(r.phase).toBe('scrubbed');
    expect(binds(fx)).toEqual([]);
    expect(r.state.players.find((p) => p.id === x)!.presence).toMatchObject({ online: false, connected: false });
  });

  it('a join from the socket the overdue cancel just admitted gets already_joined, with a single bind', () => {
    const { r, x } = racing();
    const players = r.state.players.length;
    const fx = r.step({ kind: 'intent', conn: 'S', player: null, intent: { type: 'join', name: 'S', color: 'slate', icon: 'fedora' }, mintedToken: 'S-join' });
    expect(binds(fx)).toEqual([{ type: 'bind', conn: 'S', player: x }]);
    expect(r.errors()).toEqual(['already_joined']);
    expect(r.state.players).toHaveLength(players);
    expect(projectPrivate(r.state, x)!.you.token).toBe('S-token');
  });

  it('a rejoinAs from that socket gets already_joined too', () => {
    const { r, x } = racing();
    const fx = rejoinAsFrom(r, 'S', x, 'S-again');
    expect(binds(fx)).toEqual([{ type: 'bind', conn: 'S', player: x }]);
    expect(r.errors()).toEqual(['already_joined']);
  });
});

