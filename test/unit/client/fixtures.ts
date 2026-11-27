import type { KeyValueStorage } from '../../../src/client/net/token-store';
import type { PublicPlayer, PublicState } from '../../../src/shared/core/views';

export function player(id: string, over: Partial<PublicPlayer> = {}): PublicPlayer {
  return { id, name: id.toUpperCase(), color: 'red', icon: 'fedora', connected: true, removed: false, seated: true, score: 0, ...over };
}

export function lobbyState(players: PublicPlayer[], over: Partial<PublicState> = {}): PublicState {
  return {
    code: 'ABCD',
    phase: { name: 'lobby' },
    seq: 0,
    hostId: players[0]?.id ?? null,
    players,
    settings: { difficulty: 'mixed', cycles: 2, timers: 'normal', custom: null },
    progress: null,
    round: null,
    paused: null,
    rejoinRequests: [],
    ...over,
  };
}

export function mapStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}
