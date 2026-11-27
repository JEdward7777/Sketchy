import { describe, expect, it } from 'vitest';
import {
  activePlayers,
  canClaimHost,
  canRemove,
  canStart,
  gameLength,
  gameLengthText,
  rejoinCandidates,
  takenColors,
} from '../../../src/client/lobby/lobby-model';
import { lobbyState, player } from './fixtures';

describe('lobby model (stages 4.5, 4.6, 4.10)', () => {
  it('enables Start at 3 active players: connected, not removed', () => {
    const two = lobbyState([player('p1'), player('p2')]);
    expect(canStart(two)).toBe(false);
    const threeWithOffline = lobbyState([player('p1'), player('p2'), player('p3', { connected: false })]);
    expect(canStart(threeWithOffline)).toBe(false);
    const threeWithRemoved = lobbyState([player('p1'), player('p2'), player('p3', { removed: true })]);
    expect(canStart(threeWithRemoved)).toBe(false);
    const three = lobbyState([player('p1'), player('p2'), player('p3')]);
    expect(canStart(three)).toBe(true);
    expect(activePlayers(three)).toHaveLength(3);
    expect(canStart({ ...three, phase: { name: 'dealing' } })).toBe(false);
  });

  it('shows game length as cycles × non-removed players (0020 item 2)', () => {
    const s = lobbyState([player('p1'), player('p2'), player('p3', { connected: false }), player('p4', { removed: true })]);
    expect(gameLength(s)).toEqual({ cycles: 2, players: 3, rounds: 6 });
    expect(gameLengthText(s)).toBe('2 cycles × 3 agents = 6 rounds');
    const one = lobbyState([player('p1')], { settings: { difficulty: 'mixed', cycles: 1, timers: 'normal', custom: null } });
    expect(gameLengthText(one)).toBe('1 cycle × 1 agent = 1 round');
    const three = lobbyState([player('p1'), player('p2'), player('p3'), player('p4')], {
      settings: { difficulty: 'mixed', cycles: 3, timers: 'normal', custom: null },
    });
    expect(gameLength(three).rounds).toBe(12);
  });

  it('offers "Rejoin as…" for exactly the disconnected players, removed ones included (0019)', () => {
    const s = lobbyState([
      player('p1'),
      player('p2', { connected: false }),
      player('p3', { connected: false, removed: true }),
    ]);
    expect(rejoinCandidates(s).map((p) => p.id)).toEqual(['p2', 'p3']);
  });

  it('reserves every player color, removed ones too', () => {
    const s = lobbyState([player('p1', { color: 'red' }), player('p2', { color: 'blue', removed: true })]);
    expect([...takenColors(s)].sort()).toEqual(['blue', 'red']);
  });

  it('lets a connected non-host claim only while the host is disconnected (0010)', () => {
    const hostHere = lobbyState([player('p1'), player('p2')]);
    expect(canClaimHost(hostHere, 'p2')).toBe(false);
    const hostGone = lobbyState([player('p1', { connected: false }), player('p2'), player('p3', { connected: false })]);
    expect(canClaimHost(hostGone, 'p2')).toBe(true);
    expect(canClaimHost(hostGone, 'p1')).toBe(false);
    expect(canClaimHost(hostGone, 'p3')).toBe(false);
    expect(canClaimHost(hostGone, null)).toBe(false);
    expect(canClaimHost(lobbyState([player('p2')], { hostId: null }), 'p2')).toBe(true);
  });

  it('lets the host remove only a disconnected, not yet removed player', () => {
    expect(canRemove(player('p1'))).toBe(false);
    expect(canRemove(player('p1', { connected: false }))).toBe(true);
    expect(canRemove(player('p1', { connected: false, removed: true }))).toBe(false);
  });
});
