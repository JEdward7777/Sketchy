import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectPublic, reduce } from '../../../src/shared/core';
import { nextDeadline, pendingDeadlines } from '../../../src/shared/core/next-deadline';
import { BLIP_GRACE_MS, BRIEFING_BEAT_MS, DRAW_SUBMIT_GRACE_MS, RESTART_WAIT_MS, ROOM_EXPIRY_MS } from '../../../src/shared/core/rules';
import { TIMER_PRESETS } from '../../../src/shared/timers';
import { RoomDriver, STROKES } from '../../helpers/room';

/**
 * Presence, pause, expiry and `nextDeadline` — stages 3.2 and 3.5; SPEC §7,
 * §14; decisions 0004 rule 5, 0006 item 2, 0011, 0012 item 2.
 */

const DRAW_MS = TIMER_PRESETS.normal.drawMs;

/** Three players in the draw, with one non-faker, non-host player named. */
function drawingTrio() {
  const r = new RoomDriver(2);
  const ids = r.joinMany(3);
  r.start(ids[0]!);
  r.advance(BRIEFING_BEAT_MS);
  const other = ids.find((id) => id !== r.faker && id !== ids[0])!;
  return { r, ids, other, endsAt: (r.state.phase as { endsAt: number }).endsAt };
}

describe('pause below 3 active players (§7, 0011)', () => {
  it('pauses only after the blip grace, freezing the draw deadline (0011 items 2–3)', () => {
    const { r, other, endsAt } = drawingTrio();
    r.offline(other);
    expect(projectPublic(r.state).paused).toBeNull();
    r.advance(BLIP_GRACE_MS);
    const since = r.now;
    expect(projectPublic(r.state).paused).toEqual({ since });
    // Frozen: no phase deadline is live (only expiry and the 0025 restart wait),
    // and time passing does not end the draw.
    expect(pendingDeadlines(r.state).map((d) => d.kind).sort()).toEqual(['expiry', 'restart']);
    r.now = endsAt + DRAW_SUBMIT_GRACE_MS + 60_000;
    r.step({ kind: 'tick' });
    expect(r.phase).toBe('draw');
    // Resume: re-armed from now plus the time that was left at the pause.
    const left = endsAt - since;
    r.online(other);
    expect(projectPublic(r.state).paused).toBeNull();
    expect(projectPublic(r.state).phase).toMatchObject({ endsAt: r.now + left });
  });

  it('blip graces run on wall time during a pause, so a host who drops while paused can be claimed (0010, 0011)', () => {
    const r = new RoomDriver(2);
    const ids = r.joinMany(4);
    r.start(ids[0]!);
    const [x, y] = ids.filter((id) => id !== r.faker && id !== ids[0]);
    r.offline(x!);
    r.offline(y!);
    r.advance(BLIP_GRACE_MS);
    expect(projectPublic(r.state).paused).not.toBeNull();
    r.now += 1000;
    r.offline(ids[0]!);
    expect(nextDeadline(r.state)).toBe(r.now + BLIP_GRACE_MS); // a live grace while paused
    r.advance(BLIP_GRACE_MS);
    expect(projectPublic(r.state).players[0]!.connected).toBe(false);
    r.intent(r.faker, { type: 'host:claim' });
    expect(r.errors()).toEqual([]);
    expect(r.state.hostId).toBe(r.faker);
  });

  it('a faker whose grace runs out during a pause is cancelled on resume, before any re-pause (§7, 0011 item 4)', () => {
    const r = new RoomDriver(2);
    const ids = r.joinMany(4);
    r.start(ids[0]!);
    const [x, y] = ids.filter((id) => id !== r.faker && id !== ids[0]);
    r.offline(x!);
    r.offline(y!);
    r.advance(BLIP_GRACE_MS);
    expect(r.state.pause).not.toBeNull();
    r.offline(r.faker);
    r.advance(BLIP_GRACE_MS);
    expect(r.phase).toBe('draw'); // frozen: no cancel while paused
    r.online(x!);
    r.online(y!); // 3 active (host, x, y): resume, then the faker rule applies
    expect(r.phase).toBe('scrubbed');
    expect(r.state.pause).toBeNull();
  });

  it('a pause does not let the draw end early and lose a missing drawing (0011 item 3)', () => {
    const r = new RoomDriver(2);
    const ids = r.joinMany(3);
    r.start(ids[0]!);
    r.advance(BRIEFING_BEAT_MS);
    const third = ids.find((id) => id !== r.faker && id !== ids[0])!;
    for (const id of ids) if (id !== third) r.intent(id, { type: 'draw:done', strokes: STROKES });
    r.offline(third);
    r.advance(BLIP_GRACE_MS);
    expect(r.phase).toBe('draw');
    expect(r.state.pause).not.toBeNull();
    r.online(third);
    expect(r.phase).toBe('draw');
    r.intent(third, { type: 'draw:done', strokes: STROKES });
    expect(r.phase).toBe('slideshow');
  });

  it('applies the faker cancel before the pause the same disconnect causes (0011 item 4)', () => {
    const r = new RoomDriver(2);
    const ids = r.joinMany(3);
    r.start(ids[0]!);
    r.offline(r.faker);
    r.advance(BLIP_GRACE_MS);
    expect(r.phase).toBe('scrubbed');
    expect(projectPublic(r.state).paused).toEqual({ since: r.now });
  });

  it('never pauses in the lobby', () => {
    const r = new RoomDriver();
    const [, b] = r.joinMany(3);
    r.offline(b!);
    r.advance(BLIP_GRACE_MS);
    expect(r.state.pause).toBeNull();
  });
});

describe('nextDeadline (3.5) and room expiry (§14)', () => {
  it('is the earliest of the phase deadline, a grace and the expiry', () => {
    const { r, other, endsAt } = drawingTrio();
    expect(nextDeadline(r.state)).toBe(endsAt + DRAW_SUBMIT_GRACE_MS);
    r.offline(other);
    expect(nextDeadline(r.state)).toBe(r.now + BLIP_GRACE_MS);
    expect(endsAt - r.now).toBe(DRAW_MS); // the grace is the earlier one
  });

  it('expires the room ROOM_EXPIRY_MS after the last input; alarm ticks are not activity', () => {
    const r = new RoomDriver();
    r.joinMany(2);
    const last = r.now;
    expect(nextDeadline(r.state)).toBe(last + ROOM_EXPIRY_MS);
    r.advance(ROOM_EXPIRY_MS - 1);
    expect(r.state.expired).toBe(false);
    expect(nextDeadline(r.state)).toBe(last + ROOM_EXPIRY_MS);
    const fx = r.advance(1);
    expect(fx).toEqual([{ type: 'expireRoom' }]);
    expect(nextDeadline(r.state)).toBeNull();
    // An expired room ignores everything.
    expect(r.intent('p1', { type: 'host:start' })).toEqual([]);
  });

  it('a paused room still expires', () => {
    const { r, other } = drawingTrio();
    r.offline(other);
    r.advance(BLIP_GRACE_MS);
    const last = r.state.lastActivityAt;
    expect(nextDeadline(r.state)).toBe(r.state.pause!.since + RESTART_WAIT_MS);
    r.fireNext(); // the restart wait passes; 2 players cannot restart
    expect(r.state.pause).not.toBeNull();
    expect(nextDeadline(r.state)).toBe(last + ROOM_EXPIRY_MS);
    r.now = last + ROOM_EXPIRY_MS;
    expect(r.step({ kind: 'tick' })).toEqual([{ type: 'expireRoom' }]);
  });

  it('one late tick fires every overdue deadline in order, each at its own instant', () => {
    const r = new RoomDriver(4);
    const ids = r.joinMany(3);
    r.start(ids[0]!);
    const briefAt = r.now;
    r.now = briefAt + BRIEFING_BEAT_MS + DRAW_MS + DRAW_SUBMIT_GRACE_MS + 1;
    r.step({ kind: 'tick' });
    expect(projectPublic(r.state).phase).toEqual({ name: 'slideshow', startsAt: briefAt + BRIEFING_BEAT_MS + DRAW_MS + DRAW_SUBMIT_GRACE_MS });
  });
});

describe('purity of the reducer (decision 0006 item 1)', () => {
  it('src/shared/core reads no clock, no ambient randomness and no I/O', () => {
    const dir = join(import.meta.dirname, '..', '..', '..', 'src', 'shared', 'core');
    for (const f of readdirSync(dir)) {
      const code = readFileSync(join(dir, f), 'utf8');
      expect(code, f).not.toMatch(/\bDate\b|Math\.random|\bcrypto\b|\bfetch\b|\bconsole\b|\bperformance\b/);
    }
  });

  it('returns the same step for the same state, input and now, without mutating its input', () => {
    const { r, ids } = drawingTrio();
    const before = JSON.stringify(r.state);
    const input = { kind: 'intent', conn: 'c', player: ids[1]!, intent: { type: 'draw:done', strokes: STROKES } } as const;
    const a = reduce(r.state, input, r.now);
    const b = reduce(r.state, input, r.now);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(r.state)).toBe(before);
  });
});
