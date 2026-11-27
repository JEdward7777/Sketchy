/**
 * What the lobby shows, derived from public state (stages 4.5, 4.6, 4.10).
 * Pure, so the unit leg pins it. The room decides every rule; these only
 * mirror them so buttons are enabled when the room would accept the tap.
 */

import { totalRounds } from '../../shared/game-length';
import { MIN_PLAYERS } from '../../shared/core/rules';
import type { PublicPlayer, PublicState } from '../../shared/core/views';

/** Connected, not removed and seated: who counts toward starting (decision 0011 item 1, `activeCount`). */
export function activePlayers(state: PublicState): PublicPlayer[] {
  return state.players.filter((p) => p.connected && !p.removed && p.seated);
}

/** The host may start once `MIN_PLAYERS` are active (protocol.md `host:start`). */
export function canStart(state: PublicState): boolean {
  return state.phase.name === 'lobby' && activePlayers(state).length >= MIN_PLAYERS;
}

/** "Rejoin as…" offers exactly the players with `connected: false` (§7, `rejoinAs`), removed ones included (0019). */
export function rejoinCandidates(state: PublicState): PublicPlayer[] {
  return state.players.filter((p) => !p.connected);
}

/** Colors no joiner may pick: every player's, removed ones included (0019 item 1). */
export function takenColors(state: PublicState): Set<string> {
  return new Set(state.players.map((p) => p.color));
}

/** 0010: any connected player other than the host may take over while the host is disconnected. */
export function canClaimHost(state: PublicState, you: string | null): boolean {
  if (you === null || state.hostId === you) return false;
  const me = state.players.find((p) => p.id === you);
  if (!me || !me.connected || me.removed) return false;
  const host = state.hostId === null ? undefined : state.players.find((p) => p.id === state.hostId);
  return !host || !host.connected;
}

/** The host may remove a player who is disconnected and not yet removed (`host:remove`). */
export function canRemove(p: PublicPlayer): boolean {
  return !p.connected && !p.removed;
}

/**
 * The game length the lobby shows: `cycles × players`, where players are
 * the roster a start would seat now, every non-removed player
 * (`seatRoundRoster`, decision 0020 item 2).
 */
export function gameLength(state: PublicState): { cycles: number; players: number; rounds: number } {
  const players = state.players.filter((p) => !p.removed).length;
  return { cycles: state.settings.cycles, players, rounds: totalRounds(state.settings.cycles, players) };
}

export function gameLengthText(state: PublicState): string {
  const { cycles, players, rounds } = gameLength(state);
  const c = cycles === 1 ? '1 cycle' : `${cycles} cycles`;
  const p = players === 1 ? '1 agent' : `${players} agents`;
  const r = rounds === 1 ? '1 round' : `${rounds} rounds`;
  return `${c} × ${p} = ${r}`;
}
