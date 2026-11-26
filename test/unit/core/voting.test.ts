import { describe, expect, it } from 'vitest';
import { nextDeadline, projectPublic } from '../../../src/shared/core';
import { BLIP_GRACE_MS, BRIEFING_BEAT_MS, UNMASK_BEAT_MS } from '../../../src/shared/core/rules';
import { TIMER_PRESETS } from '../../../src/shared/timers';
import { RoomDriver, STROKES } from '../../helpers/room';

/**
 * Stage 3.3.3: the reveal slideshow and free browse — SPEC §4 phases 3–4,
 * §8; decisions 0007 items 2 and 7, 0015, 0016, 0019 items 4–5.
 */

const { perSlideMs: PER_SLIDE, voteMs: VOTE_MS } = TIMER_PRESETS.normal;

function drawing(n = 4, seed = 1, orderSeed?: number) {
  const r = new RoomDriver(seed, undefined, undefined, orderSeed);
  const ids = r.joinMany(n);
  r.start(ids[0]!);
  r.advance(BRIEFING_BEAT_MS);
  return { r, ids, host: ids[0]! };
}

function slideshow(n = 4, seed = 1, orderSeed?: number) {
  const ctx = drawing(n, seed, orderSeed);
  ctx.r.drawAll();
  expect(ctx.r.phase).toBe('slideshow');
  return ctx;
}

const phase = (r: RoomDriver) => projectPublic(r.state).phase;
const round = (r: RoomDriver) => projectPublic(r.state).round!;

describe('slideshow cards, order and timing (§4, §8, 0007 items 2 and 7)', () => {
  it('shows every roster player once, for cards × 2 × perSlide, with the per-slide time public', () => {
    const { r, ids } = slideshow(5);
    const cards = round(r).cards!;
    expect([...cards].sort()).toEqual([...ids].sort());
    expect(phase(r)).toEqual({ name: 'slideshow', startsAt: r.now, perSlideMs: PER_SLIDE, endsAt: r.now + 5 * 2 * PER_SLIDE });
    expect(nextDeadline(r.state)).toBe(r.now + 5 * 2 * PER_SLIDE);
  });

  it('a drawing-less ("went dark") player still has a card and a slot in the timing (0007 item 7)', () => {
    const { r, ids } = drawing(4);
    const dark = ids.find((id) => id !== r.faker && id !== ids[0])!;
    r.offline(dark);
    r.advance(BLIP_GRACE_MS);
    r.drawAll();
    expect(r.phase).toBe('slideshow');
    expect(round(r).cards).toContain(dark);
    expect(round(r).done).not.toContain(dark);
    expect(phase(r)).toMatchObject({ endsAt: r.now + 4 * 2 * PER_SLIDE });
  });

  it('the order is random per round from its own stream: the faker seed does not change it, the order seed does', () => {
    const orderOf = (seed: number, orderSeed: number) => round(slideshow(6, seed, orderSeed).r).cards!.join();
    const base = orderOf(1, 11);
    expect(orderOf(1, 11)).toBe(base);
    // Different faker/word stream, same order stream: same order.
    for (const seed of [2, 3, 4]) expect(orderOf(seed, 11)).toBe(base);
    const others = [12, 13, 14, 15].map((o) => orderOf(1, o));
    expect(others.some((o) => o !== base)).toBe(true);
  });

  it('a player removed before the slideshow has no card and is no vote target; they stay on the roster (0019 items 4–5)', () => {
    const { r, ids, host } = drawing(4);
    const gone = ids.find((id) => id !== r.faker && id !== host)!;
    r.offline(gone);
    r.advance(BLIP_GRACE_MS);
    r.intent(host, { type: 'host:remove', playerId: gone });
    r.drawAll();
    expect(r.phase).toBe('slideshow');
    expect(round(r).cards).not.toContain(gone);
    expect(round(r).cards).toHaveLength(3);
    expect(phase(r)).toMatchObject({ endsAt: r.now + 3 * 2 * PER_SLIDE });
    expect(round(r).roster).toContain(gone);
    r.intent(host, { type: 'vote:set', targetId: gone });
    expect(r.errors()).toEqual(['bad_target']);
  });

  it('a player removed during the slideshow keeps their card and stays a valid target (0015 item 2, 0019 item 4)', () => {
    const { r, ids, host } = slideshow(4);
    const gone = ids.find((id) => id !== host)!;
    r.offline(gone);
    r.advance(BLIP_GRACE_MS);
    r.intent(host, { type: 'host:remove', playerId: gone });
    expect(round(r).cards).toContain(gone);
    r.intent(host, { type: 'vote:set', targetId: gone });
    expect(r.errors()).toEqual([]);
  });

  it('a pause freezes the slideshow: start and end shift by the pause length (0011 item 3)', () => {
    const { r, ids, host } = slideshow(3);
    const before = phase(r) as { startsAt: number; endsAt: number };
    const gone = ids.find((id) => id !== host)!;
    r.now += 1000;
    r.offline(gone);
    r.advance(BLIP_GRACE_MS);
    expect(r.state.pause).not.toBeNull();
    r.now += 7000;
    r.online(gone);
    expect(r.state.pause).toBeNull();
    const shift = 7000;
    expect(phase(r)).toMatchObject({ startsAt: before.startsAt + shift, endsAt: before.endsAt + shift });
    expect(nextDeadline(r.state)).toBe(before.endsAt + shift);
  });
});

describe('vote:set and vote:lock (§4, 0015)', () => {
  it('votes are public and live, changeable until locked; a lock is final', () => {
    const { r, ids } = slideshow(4);
    const [a, b, c] = ids;
    r.intent(a!, { type: 'vote:set', targetId: b! });
    expect(round(r).votes).toEqual({ [a!]: b });
    r.intent(a!, { type: 'vote:set', targetId: c! });
    expect(round(r).votes).toEqual({ [a!]: c });
    r.intent(a!, { type: 'vote:lock' });
    expect(round(r).locked).toEqual([a]);
    r.intent(a!, { type: 'vote:set', targetId: b! });
    expect(r.errors()).toEqual(['vote_locked']);
    r.intent(a!, { type: 'vote:lock' });
    expect(r.errors()).toEqual(['vote_locked']);
    expect(round(r).votes).toEqual({ [a!]: c });
  });

  it('refuses a self-vote, an unknown target, a lock with nothing selected, a waiting late joiner, and votes outside voting', () => {
    const { r, ids } = drawing(3);
    const [a, b] = ids;
    r.intent(a!, { type: 'vote:set', targetId: b! });
    expect(r.errors()).toEqual(['wrong_phase']);
    const late = r.join('Late', 'teal');
    r.drawAll();
    r.intent(a!, { type: 'vote:set', targetId: a! });
    expect(r.errors()).toEqual(['bad_target']);
    r.intent(a!, { type: 'vote:set', targetId: 'p99' });
    expect(r.errors()).toEqual(['bad_target']);
    r.intent(a!, { type: 'vote:set', targetId: late });
    expect(r.errors()).toEqual(['bad_target']);
    r.intent(a!, { type: 'vote:lock' });
    expect(r.errors()).toEqual(['no_vote']);
    r.intent(late, { type: 'vote:set', targetId: a! });
    expect(r.errors()).toEqual(['not_in_round']);
  });

  it('the faker votes like everyone else (§4 "the faker included")', () => {
    const { r } = slideshow(4);
    const target = r.nextCard(r.faker);
    r.intent(r.faker, { type: 'vote:set', targetId: target });
    r.intent(r.faker, { type: 'vote:lock' });
    expect(r.errors()).toEqual([]);
    expect(round(r).votes[r.faker]).toBe(target);
  });
});

describe('when voting ends (§4, 0016)', () => {
  it('everyone connected locked mid-slideshow: straight to unmask, the slideshow cut short (0016 item 2)', () => {
    const { r } = slideshow(4);
    r.now += PER_SLIDE; // one slide in
    r.voteAll();
    expect(phase(r)).toEqual({ name: 'unmask', endsAt: r.now + UNMASK_BEAT_MS });
    expect(round(r).faker).toBe(r.faker);
  });

  it('the last connected lock ends free browse; a player past the grace is not waited for, one inside it is', () => {
    const second = slideshow(4).r;
    second.fireNext();
    expect(second.phase).toBe('browse');
    const gone = second.state.round!.roster.find((id) => id !== second.state.hostId)!;
    second.offline(gone);
    for (const id of second.state.round!.roster) {
      if (id === gone) continue;
      second.intent(id, { type: 'vote:set', targetId: second.nextCard(id) });
      second.intent(id, { type: 'vote:lock' });
    }
    expect(second.phase).toBe('browse'); // `gone` is inside the grace: still waited for
    second.advance(BLIP_GRACE_MS);
    expect(second.phase).toBe('unmask'); // past the grace: not waited for
  });

  it('two passes end the slideshow; browse runs for the vote timer from there, then unmask', () => {
    const { r } = slideshow(3);
    const end = (phase(r) as { endsAt: number }).endsAt;
    r.fireNext();
    expect(r.now).toBe(end);
    expect(phase(r)).toEqual({ name: 'browse', endsAt: end + VOTE_MS });
    r.fireNext();
    expect(r.now).toBe(end + VOTE_MS);
    expect(phase(r)).toEqual({ name: 'unmask', endsAt: end + VOTE_MS + UNMASK_BEAT_MS });
  });

  it('a waiting late joiner does not hold up the lock-in end', () => {
    const { r } = slideshow(3);
    r.join('Late', 'teal');
    r.voteAll();
    expect(r.phase).toBe('unmask');
  });

  it('a pause holds the all-locked end until the game resumes (0011)', () => {
    const { r, ids, host } = slideshow(3);
    const gone = ids.find((id) => id !== host)!;
    r.offline(gone);
    r.advance(BLIP_GRACE_MS);
    expect(r.state.pause).not.toBeNull();
    r.voteAll();
    expect(r.phase).toBe('slideshow');
    r.online(gone);
    expect(r.phase).toBe('slideshow'); // `gone` is connected again and has not locked
    r.intent(gone, { type: 'vote:set', targetId: r.nextCard(gone) });
    r.intent(gone, { type: 'vote:lock' });
    expect(r.phase).toBe('unmask');
  });

  it('draw:done after the draw is refused (the slideshow has started)', () => {
    const { r, ids } = slideshow(3);
    r.intent(ids[0]!, { type: 'draw:done', strokes: STROKES });
    expect(r.errors()).toEqual(['wrong_phase']);
  });
});
