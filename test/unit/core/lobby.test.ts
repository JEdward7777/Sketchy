import { describe, expect, it } from 'vitest';
import { BLIP_GRACE_MS, MAX_PLAYERS, NAME_MAX_LENGTH } from '../../../src/shared/core/rules';
import { projectPublic } from '../../../src/shared/core';
import { RoomDriver } from '../../helpers/room';

/** Stage 3.3.1: lobby — SPEC §2, §3, §7; decisions 0010, 0019, 0020. */

describe('join (§2)', () => {
  it('gives ids in join order, makes the first joiner host (§3), and binds the socket', () => {
    const r = new RoomDriver();
    const fx = r.step({
      kind: 'intent',
      conn: 'sock-1',
      player: null,
      intent: { type: 'join', name: '  Maya   Lee ', color: 'red', icon: 'fedora' },
      mintedToken: 'secret-1',
    });
    expect(fx).toEqual([{ type: 'bind', conn: 'sock-1', player: 'p1' }]);
    expect(r.join('Ben', 'blue')).toBe('p2');
    const pub = projectPublic(r.state);
    expect(pub.hostId).toBe('p1');
    expect(pub.players.map((p) => [p.id, p.name, p.connected, p.seated])).toEqual([
      ['p1', 'Maya Lee', true, true],
      ['p2', 'Ben', true, true],
    ]);
  });

  it('refuses a taken color, an unknown color or icon, and a bad name', () => {
    const r = new RoomDriver();
    r.join('Maya', 'red');
    const attempt = (name: string, color: string, icon: string): string[] => {
      r.step({ kind: 'intent', conn: 'x', player: null, intent: { type: 'join', name, color, icon }, mintedToken: `t-${name}-${color}` });
      return r.errors();
    };
    expect(attempt('Ben', 'red', 'fedora')).toEqual(['color_taken']);
    expect(attempt('Ben', 'chartreuse', 'fedora')).toEqual(['bad_color']);
    expect(attempt('Ben', 'blue', 'cape')).toEqual(['bad_icon']);
    expect(attempt('   ', 'blue', 'fedora')).toEqual(['bad_name']);
    expect(attempt('x'.repeat(NAME_MAX_LENGTH + 1), 'blue', 'fedora')).toEqual(['bad_name']);
    expect(r.state.players).toHaveLength(1);
  });

  it('is refused at MAX_PLAYERS, counting removed players and waiting late joiners (§2, 0019 item 3)', () => {
    const r = new RoomDriver();
    const ids = r.joinMany(3);
    r.start(ids[0]!);
    // Seven late joiners wait (not seated) during the game.
    const colors = ['lime', 'green', 'teal', 'sky', 'blue', 'purple', 'pink'];
    colors.forEach((c, i) => r.join(`late${i}`, c));
    expect(r.state.players).toHaveLength(MAX_PLAYERS);
    // Remove one of them once disconnected: the seat stays taken.
    r.offline('p10');
    r.advance(BLIP_GRACE_MS);
    r.intent(ids[0]!, { type: 'host:remove', playerId: 'p10' });
    expect(r.state.players.find((p) => p.id === 'p10')?.removed).toBe(true);
    r.step({ kind: 'intent', conn: 'y', player: null, intent: { type: 'join', name: 'Zed', color: 'slate', icon: 'fedora' }, mintedToken: 'z' });
    expect(r.errors()).toEqual(['room_full']);
  });

  it('keeps a removed player color reserved (0019 item 1)', () => {
    const r = new RoomDriver();
    const [host, , c] = r.joinMany(3);
    r.offline(c!);
    r.advance(BLIP_GRACE_MS);
    r.intent(host!, { type: 'host:remove', playerId: c! });
    r.step({ kind: 'intent', conn: 'y', player: null, intent: { type: 'join', name: 'Zed', color: 'yellow', icon: 'fedora' }, mintedToken: 'z' });
    expect(r.errors()).toEqual(['color_taken']);
  });

  it('answers join_first before joining and already_joined after', () => {
    const r = new RoomDriver();
    r.step({ kind: 'intent', conn: 'x', player: null, intent: { type: 'host:start' } });
    expect(r.errors()).toEqual(['join_first']);
    const a = r.join('Maya', 'red');
    r.intent(a, { type: 'rejoin', token: 'token-1' });
    expect(r.errors()).toEqual(['already_joined']);
  });
});

describe('reconnecting (§7, 0019)', () => {
  it('a token reconnects as the same player with the same score', () => {
    const r = new RoomDriver();
    const a = r.join('Maya', 'red');
    r.state = { ...r.state, players: r.state.players.map((p) => ({ ...p, score: 4 })) };
    r.offline(a);
    const fx = r.step({ kind: 'intent', conn: 'new-sock', player: null, intent: { type: 'rejoin', token: 'token-1' } });
    expect(fx).toEqual([{ type: 'bind', conn: 'new-sock', player: a }]);
    expect(projectPublic(r.state).players[0]).toMatchObject({ id: a, connected: true, score: 4 });
    r.step({ kind: 'intent', conn: 'z', player: null, intent: { type: 'rejoin', token: 'nope' } });
    expect(r.errors()).toEqual(['unknown_token']);
  });

  it('"Rejoin as…" works only once the player is disconnected after the grace', () => {
    const r = new RoomDriver();
    const [, b] = r.joinMany(2);
    let n = 0;
    const rejoinAs = () =>
      r.step({ kind: 'intent', conn: 'phone2', player: null, intent: { type: 'rejoinAs', playerId: b! }, mintedToken: `fresh-${++n}` });
    rejoinAs();
    expect(r.errors()).toEqual(['not_rejoinable']);
    r.offline(b!);
    r.advance(BLIP_GRACE_MS - 1);
    rejoinAs();
    expect(r.errors()).toEqual(['not_rejoinable']);
    r.advance(1);
    expect(projectPublic(r.state).players[1]!.connected).toBe(false);
    // In the lobby (between rounds) it binds at once and rotates the token (0024 items 1, 3).
    expect(rejoinAs()).toEqual([{ type: 'bind', conn: 'phone2', player: b }]);
    expect(r.privateOf(b!)!.you.token).toBe('fresh-3');
    r.step({ kind: 'intent', conn: 'old-phone', player: null, intent: { type: 'rejoin', token: 'token-2' } });
    expect(r.errors()).toEqual(['unknown_token']);
  });

  it('a removed player returns with the same id, color and score; the round keeps its roster (0019)', () => {
    const r = new RoomDriver();
    const [host] = r.joinMany(4);
    r.start(host!);
    const roster = r.state.round!.roster;
    // A non-host, non-faker roster player, so the round is not cancelled (§7).
    const d = roster.find((id) => id !== host && id !== r.faker)!;
    const color = r.state.players.find((p) => p.id === d)!.color;
    r.offline(d);
    r.advance(BLIP_GRACE_MS);
    r.intent(host!, { type: 'host:remove', playerId: d });
    expect(projectPublic(r.state).players.find((p) => p.id === d)).toMatchObject({ removed: true, connected: false });
    const token = r.state.players.find((p) => p.id === d)!.token;
    r.step({ kind: 'intent', conn: 'back', player: null, intent: { type: 'rejoin', token } });
    expect(projectPublic(r.state).players.find((p) => p.id === d)).toMatchObject({ id: d, color, removed: false, connected: true });
    // The round under way keeps its roster (0019 item 4).
    expect(r.state.round!.roster).toEqual(roster);
    expect(r.phase).toBe('draw'); // the briefing beat passed during the grace; not cancelled
  });

  it('only a disconnected, not-yet-removed player can be removed, by the host only', () => {
    const r = new RoomDriver();
    const [host, b] = r.joinMany(3);
    r.intent(host!, { type: 'host:remove', playerId: b! });
    expect(r.errors()).toEqual(['not_removable']);
    r.offline(b!);
    r.advance(BLIP_GRACE_MS);
    r.intent('p3', { type: 'host:remove', playerId: b! });
    expect(r.errors()).toEqual(['not_host']);
    r.intent(host!, { type: 'host:remove', playerId: b! });
    expect(r.errors()).toEqual([]);
    r.intent(host!, { type: 'host:remove', playerId: b! });
    expect(r.errors()).toEqual(['not_removable']);
  });
});

describe('settings and start (§6, §7, §8, 0018, 0020)', () => {
  it('defaults to 2 cycles and the Normal preset; host-only, lobby-only edits', () => {
    const r = new RoomDriver();
    const [host, b] = r.joinMany(3);
    expect(projectPublic(r.state).settings).toMatchObject({ cycles: 2, timers: 'normal', custom: null });
    r.intent(b!, { type: 'host:settings', settings: { cycles: 1 } });
    expect(r.errors()).toEqual(['not_host']);
    r.intent(host!, { type: 'host:settings', settings: { cycles: 4 } });
    expect(r.errors()).toEqual(['bad_settings']);
    r.intent(host!, { type: 'host:settings', settings: { timers: 'custom' } });
    expect(r.errors()).toEqual(['bad_settings']);
    const custom = { drawMs: 5000, perSlideMs: 1000, voteMs: 5000, guessMs: 5000 };
    r.intent(host!, { type: 'host:settings', settings: { timers: 'custom', custom, difficulty: 'abstract', cycles: 3 } });
    expect(r.errors()).toEqual([]);
    expect(projectPublic(r.state).settings).toEqual({ difficulty: 'abstract', cycles: 3, timers: 'custom', custom });
    r.start(host!);
    r.intent(host!, { type: 'host:settings', settings: { cycles: 1 } });
    expect(r.errors()).toEqual(['wrong_phase']);
  });

  it('start needs 3 active players; disconnected ones do not count (§7, 0011 item 1)', () => {
    const r = new RoomDriver();
    const [host, , c] = r.joinMany(3);
    r.offline(c!);
    r.advance(BLIP_GRACE_MS);
    r.intent(host!, { type: 'host:start' });
    expect(r.errors()).toEqual(['not_enough_players']);
    expect(r.phase).toBe('lobby');
  });

  it('start fixes totalRounds = cycles × roster size, disconnected roster players included (0020 item 2)', () => {
    const r = new RoomDriver();
    const [host, , , d] = r.joinMany(4);
    r.offline(d!);
    r.advance(BLIP_GRACE_MS);
    r.intent(host!, { type: 'host:start' });
    expect(projectPublic(r.state).progress).toEqual({ completed: 0, total: 2 * 4 });
    expect(r.state.round!.roster).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(r.faker).not.toBe(d); // picked from connected players only (0020 item 1)
  });

  it('a late joiner waits unseated and is seated when the next round starts (0020 item 4)', () => {
    const r = new RoomDriver();
    const [host] = r.joinMany(3);
    r.start(host!);
    const late = r.join('Late', 'teal');
    expect(projectPublic(r.state).players.find((p) => p.id === late)?.seated).toBe(false);
    expect(r.state.round!.roster).not.toContain(late);
    expect(projectPublic(r.state).progress?.total).toBe(2 * 3); // unchanged by late joiners
  });
});

describe('host claim (0010)', () => {
  it('is refused while the host is connected or within the grace, and accepted after', () => {
    const r = new RoomDriver();
    const [host, b, c] = r.joinMany(3);
    r.intent(b!, { type: 'host:claim' });
    expect(r.errors()).toEqual(['host_connected']);
    r.offline(host!);
    r.intent(b!, { type: 'host:claim' });
    expect(r.errors()).toEqual(['host_connected']);
    r.advance(BLIP_GRACE_MS);
    r.intent(b!, { type: 'host:claim' });
    expect(r.state.hostId).toBe(b);
    // The first accepted claim wins; later ones are refused.
    r.intent(c!, { type: 'host:claim' });
    expect(r.errors()).toEqual(['host_connected']);
    // The old host returns as an ordinary player (0010 item 3).
    r.online(host!);
    expect(r.state.hostId).toBe(b);
    r.intent(host!, { type: 'host:start' });
    expect(r.errors()).toEqual(['not_host']);
  });
});
