import { describe, expect, it } from 'vitest';
import { nextDeadline, projectPublic } from '../../../src/shared/core';
import { BLIP_GRACE_MS, BRIEFING_BEAT_MS, RESTART_WAIT_MS, SCRUBBED_BEAT_MS } from '../../../src/shared/core/rules';
import type { RoomState } from '../../../src/shared/core/state';
import { OTHER_WORD, RoomDriver, STROKES, WORD, checkScrubbedSecretless } from '../../helpers/room';

/**
 * A paused round restarts with newcomers: decision 0023 item 1 as refined by
 * 0025 (wait `RESTART_WAIT_MS`, count open sockets; faker pool). Also SPEC
 * §7, decisions 0011 (pause) and 0020 items 1, 3–4.
 */

/**
 * Three seated players in the draw, the faker's drawing submitted; one
 * non-faker, non-host drops past the grace, so the game pauses.
 */
function pausedTrio(seed = 2) {
  const r = new RoomDriver(seed);
  const ids = r.joinMany(3);
  r.start(ids[0]!);
  r.advance(BRIEFING_BEAT_MS);
  r.intent(r.faker, { type: 'draw:done', strokes: STROKES });
  const gone = ids.find((id) => id !== r.faker && id !== ids[0])!;
  r.offline(gone);
  r.advance(BLIP_GRACE_MS);
  expect(projectPublic(r.state).paused).not.toBeNull();
  expect(r.phase).toBe('draw');
  return { r, ids, gone, since: r.state.pause!.since };
}

describe('a paused round restarts with newcomers after RESTART_WAIT_MS (0023 item 1, 0025 item 1)', () => {
  it('with a newcomer and no return, the round is scrubbed at exactly since + RESTART_WAIT_MS', () => {
    const { r, gone, since } = pausedTrio();
    const late = r.join('Late', 'teal');
    expect(r.phase).toBe('draw'); // not yet: the wait has not passed
    expect(nextDeadline(r.state)).toBe(since + RESTART_WAIT_MS);
    r.now = since + RESTART_WAIT_MS - 1;
    r.step({ kind: 'tick' });
    expect(r.phase).toBe('draw');
    r.fireNext();
    expect(r.now).toBe(since + RESTART_WAIT_MS);
    expect(r.phase).toBe('scrubbed');
    expect(projectPublic(r.state).phase).toEqual({ name: 'scrubbed', endsAt: since + RESTART_WAIT_MS + SCRUBBED_BEAT_MS });
    expect(projectPublic(r.state).paused).toBeNull();
    expect(r.last).toContainEqual({ type: 'clearDrawings', roundNo: 1 });
    expect(projectPublic(r.state).progress).toEqual({ completed: 0, total: 2 * 3 }); // not counted (0020 item 3)
    expect(checkScrubbedSecretless(r.state)).toEqual([]);
    // Between rounds the waiting player counts, so no re-pause; the next round seats them.
    r.advance(SCRUBBED_BEAT_MS);
    expect(r.phase).toBe('dealing');
    expect(r.state.round!.no).toBe(2);
    expect(r.state.round!.roster).toContain(late);
    expect(r.state.round!.roster).toContain(gone); // disconnected but not removed: seated, card dark (§7)
    expect(projectPublic(r.state).players.find((p) => p.id === late)?.seated).toBe(true);
  });

  it('a newcomer arriving after the wait has passed restarts at once', () => {
    const { r, since } = pausedTrio();
    r.fireNext(); // the restart wait passes with only 2 open sockets
    expect(r.now).toBe(since + RESTART_WAIT_MS);
    expect(r.phase).toBe('draw');
    r.now += 5000;
    r.join('Late', 'teal');
    expect(r.phase).toBe('scrubbed');
  });

  it('a dropped player who returns within the wait resumes the round with its drawings, even with a newcomer waiting', () => {
    const { r, gone, since } = pausedTrio();
    const late = r.join('Late', 'teal');
    const drawings = r.state.round!.drawings;
    r.now = since + RESTART_WAIT_MS - 1;
    r.online(gone);
    expect(r.phase).toBe('draw');
    expect(projectPublic(r.state).paused).toBeNull();
    expect(r.state.round!.drawings).toEqual(drawings);
    expect(r.state.round!.roster).not.toContain(late);
  });

  it('a host inside its grace but with no socket does not count toward the restart', () => {
    const { r, ids, since } = pausedTrio();
    r.now = since + RESTART_WAIT_MS - 5000;
    r.offline(ids[0]!); // host: still connected (grace), socket closed
    r.join('Late', 'teal'); // stayer + newcomer = 2 open sockets
    r.fireNext();
    expect(r.now).toBe(since + RESTART_WAIT_MS);
    expect(r.state.players[0]!.presence.connected).toBe(true);
    expect(r.phase).toBe('draw');
    expect(r.state.pause).not.toBeNull();
  });

  it('a host whose grace ran out does not count: one newcomer does not restart', () => {
    const { r, ids } = pausedTrio();
    r.offline(ids[0]!);
    r.advance(BLIP_GRACE_MS);
    expect(projectPublic(r.state).players[0]!.connected).toBe(false);
    r.join('Late', 'teal');
    r.advance(RESTART_WAIT_MS);
    expect(r.phase).toBe('draw');
    expect(r.state.pause).not.toBeNull();
  });

  it('a pause between rounds (scrubbed) resumes and seats normally', () => {
    const r = new RoomDriver(2);
    const ids = r.joinMany(3);
    r.start(ids[0]!);
    r.offline(r.faker);
    r.advance(BLIP_GRACE_MS);
    expect(r.phase).toBe('scrubbed');
    expect(r.state.pause).not.toBeNull();
    expect(checkScrubbedSecretless(r.state)).toEqual([]);
    const late = r.join('Late', 'teal');
    expect(r.phase).toBe('scrubbed'); // resumed, not cancelled again
    expect(r.state.pause).toBeNull();
    expect(r.state.round!.no).toBe(1);
    r.advance(SCRUBBED_BEAT_MS);
    expect(r.state.round!.no).toBe(2);
    expect(r.state.round!.roster).toContain(late);
  });

  it('the restart time and the restart look the same in public whoever the faker is and whatever the word (3.6.1)', () => {
    const { r } = pausedTrio(9);
    const variants = r.state.round!.roster.map((faker, i): RoomState => ({
      ...r.state,
      rng: { s: (r.state.rng.s + i * 7919) >>> 0 },
      round: { ...r.state.round!, faker, word: i % 2 ? OTHER_WORD : WORD },
    }));
    const results = variants.map((s) => {
      const d = new RoomDriver(9);
      d.state = s;
      d.now = r.now;
      const out: (string | number | null)[] = [d.publicJson()];
      d.step({ kind: 'intent', conn: 'late', player: null, intent: { type: 'join', name: 'Late', color: 'teal', icon: 'fedora' }, mintedToken: 'token-late' });
      out.push(d.publicJson(), nextDeadline(d.state));
      d.fireNext();
      out.push(d.now, d.publicJson());
      return out;
    });
    for (const res of results) expect(res).toEqual(results[0]);
    expect(results[0]![4]).toContain('"scrubbed"');
  });
});

describe('the faker pool is every connected roster player, grace included (0020 item 1, 0025 item 2)', () => {
  it('a player inside the grace can be picked; one whose grace ran out never is', () => {
    const picked = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const r = new RoomDriver(seed);
      const ids = r.joinMany(5);
      r.offline(ids[4]!);
      r.advance(BLIP_GRACE_MS); // p5 disconnected
      r.offline(ids[3]!); // p4 inside the grace
      r.intent(ids[0]!, { type: 'host:start' });
      expect(r.faker, `seed ${seed}`).not.toBe(ids[4]);
      picked.add(r.faker);
    }
    expect(picked).toContain('p4');
  });
});
