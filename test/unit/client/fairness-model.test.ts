import { describe, expect, it } from 'vitest';
import { agentsText, darkPlayers, hostAttention, onDeckText, pauseDarkPlayers, pauseView, waitingPlayers } from '../../../src/client/game/fairness-model';
import { RESTART_WAIT_MS } from '../../../src/shared/core/rules';
import type { PublicPhase, PublicRound, PublicState } from '../../../src/shared/core/views';
import { lobbyState, player } from './fixtures';

function round(roster: string[]): PublicRound {
  return { no: 4, roster, category: 'Animals', done: [], cards: null, votes: {}, locked: [], faker: null, guess: null, judged: [], result: null };
}

function game(phase: PublicPhase, over: Partial<PublicState> = {}): PublicState {
  const players = [player('a'), player('b'), player('c', { connected: false })];
  return lobbyState(players, { phase, round: round(['a', 'b', 'c']), progress: { completed: 1, total: 6 }, ...over });
}

const draw: PublicPhase = { name: 'draw', endsAt: 50_000, closesAt: 51_000 };
const results: PublicPhase = { name: 'results', continueAt: 9_000, fillFrom: 1_000, hostSpeaking: false };

describe('fairness model (phase 11)', () => {
  it('is null when the room is not paused', () => {
    expect(pauseView(game(draw))).toBeNull();
  });

  it('counts how many must come back during a round, with no restart when nobody new stands by', () => {
    const v = pauseView(game(draw, { paused: { since: 10_000 } }));
    expect(v).toEqual({ kind: 'round', needed: 1, restartAt: null, waiting: 0 });
  });

  it('shows the 0023/0025 restart instant once seated plus waiting agents reach 3', () => {
    const players = [player('a'), player('b'), player('c', { connected: false }), player('d', { seated: false })];
    const v = pauseView(game(draw, { players, paused: { since: 10_000 } }));
    expect(v).toEqual({ kind: 'round', needed: 1, restartAt: 10_000 + RESTART_WAIT_MS, waiting: 1 });
  });

  it('offers no restart when the waiting agents are still too few', () => {
    const players = [player('a'), player('b', { connected: false }), player('c', { connected: false }), player('d', { seated: false })];
    expect(pauseView(game(draw, { players, paused: { since: 0 } }))?.restartAt).toBeNull();
  });

  it('between rounds counts waiting agents toward the 3 (protocol.md `paused`)', () => {
    const players = [player('a'), player('b', { connected: false }), player('c', { connected: false })];
    expect(pauseView(game(results, { players, paused: { since: 0 } }))).toEqual({ kind: 'between', needed: 2, restartAt: null, waiting: 0 });
    expect(pauseView(game({ name: 'scrubbed', endsAt: 5_000 }, { paused: { since: 0 } }))?.kind).toBe('between');
  });

  it('ignores removed players everywhere', () => {
    const players = [player('a'), player('b'), player('c', { connected: false, removed: true }), player('d', { connected: false })];
    const s = game(draw, { players });
    expect(darkPlayers(s).map((p) => p.id)).toEqual(['d']);
    expect(waitingPlayers(s)).toEqual([]);
  });

  it('tells a player off the roster they are on deck, and nobody else', () => {
    const players = [player('a'), player('b'), player('c'), player('d', { seated: false })];
    for (const phase of [draw, { name: 'dealing' } as const, { name: 'browse', endsAt: 1 } as const, { name: 'guess', endsAt: 1 } as const]) {
      const s = game(phase, { players });
      expect(onDeckText(s, 'd'), phase.name).toMatch(/on deck/);
      expect(onDeckText(s, 'a'), phase.name).toBeNull();
    }
    expect(onDeckText(game(results, { players }), 'd')).toMatch(/next round/);
    expect(onDeckText(game(results, { players }), 'a')).toBeNull();
    // The game's last results: there is no next round to promise.
    expect(onDeckText(game(results, { players, progress: { completed: 6, total: 6 } }), 'd')).toBeNull();
    expect(onDeckText(game({ name: 'final', standings: [] }, { players }), 'd')).toBeNull();
  });

  it('lists only roster agents as gone dark during a round, everyone dark between rounds', () => {
    const players = [player('a'), player('b'), player('c', { connected: false }), player('d', { seated: false, connected: false })];
    expect(pauseDarkPlayers(game(draw, { players, paused: { since: 0 } })).map((p) => p.id)).toEqual(['c']);
    expect(pauseDarkPlayers(game(results, { players, paused: { since: 0 } })).map((p) => p.id)).toEqual(['c', 'd']);
  });

  it('counts what waits on the host: dark agents and rejoin requests', () => {
    expect(hostAttention(game(draw))).toBe(1);
    expect(hostAttention(game(draw, { rejoinRequests: ['c'] }))).toBe(2);
  });

  it('says how many agents', () => {
    expect(agentsText(1)).toBe('1 more agent');
    expect(agentsText(2)).toBe('2 more agents');
  });
});
