/**
 * What the fairness screens show (phase 11, `SPEC.md` §7), derived from
 * public state only. Pure, so the unit leg pins it. The room decides every
 * rule (decisions 0011, 0019, 0020, 0023, 0025, 0027); these only mirror
 * them in words and counts, never anything about the word or the faker.
 */

import { MIN_PLAYERS, RESTART_WAIT_MS } from '../../shared/core/rules';
import type { PublicPlayer, PublicState } from '../../shared/core/views';

type Phase = PublicState['phase']['name'];

/** Phases of a round under way, before unmask: a pause here can end in a 0023/0025 restart. */
const IN_ROUND: ReadonlySet<Phase> = new Set(['dealing', 'briefing', 'draw', 'slideshow', 'browse']);

/** Phases where a round is being played and a player off the roster watches (0020 item 4). */
const ROUND_ON: ReadonlySet<Phase> = new Set(['dealing', 'briefing', 'draw', 'slideshow', 'browse', 'unmask', 'guess', 'judging']);

/** Seated, connected and not removed: who keeps a round going (0011 item 1). */
export function activeSeated(state: PublicState): PublicPlayer[] {
  return state.players.filter((p) => p.connected && !p.removed && p.seated);
}

/** Connected, not removed and not yet seated: late joiners and returning removed players (0020 item 4). */
export function waitingPlayers(state: PublicState): PublicPlayer[] {
  return state.players.filter((p) => p.connected && !p.removed && !p.seated);
}

/** Players who went dark and are not removed (the host may remove them, §7). */
export function darkPlayers(state: PublicState): PublicPlayer[] {
  return state.players.filter((p) => !p.connected && !p.removed);
}

/**
 * Who the pause screen lists as gone dark: in a round under way, only
 * agents on its roster (a late joiner who drops never held the round up,
 * 0011 item 1); between rounds, every dark agent.
 */
export function pauseDarkPlayers(state: PublicState): PublicPlayer[] {
  const dark = darkPlayers(state);
  if (!IN_ROUND.has(state.phase.name)) return dark;
  const roster = state.round?.roster ?? [];
  return dark.filter((p) => roster.includes(p.id));
}

export interface PauseView {
  /** `round`: a round under way froze; `between`: the room is between rounds (scrubbed, results). */
  readonly kind: 'round' | 'between';
  /** How many more agents must come back (or, between rounds, come back or join) to go on. */
  readonly needed: number;
  /**
   * When a round under way would restart with the agents standing by
   * (0023 item 1, 0025 item 1: `since + RESTART_WAIT_MS`), or null when
   * nobody new is standing by. The room counts open sockets, which public
   * state cannot show, so this is the earliest it can happen.
   */
  readonly restartAt: number | null;
  /** Agents standing by for the next round. */
  readonly waiting: number;
}

/** The pause screen's facts, or null when the room is not paused. */
export function pauseView(state: PublicState): PauseView | null {
  if (!state.paused) return null;
  const seated = activeSeated(state).length;
  const waiting = waitingPlayers(state).length;
  if (IN_ROUND.has(state.phase.name)) {
    const restart = seated + waiting >= MIN_PLAYERS && waiting > 0;
    return { kind: 'round', needed: Math.max(1, MIN_PLAYERS - seated), restartAt: restart ? state.paused.since + RESTART_WAIT_MS : null, waiting };
  }
  // Between rounds waiting players count toward the quorum (protocol.md `paused`).
  return { kind: 'between', needed: Math.max(1, MIN_PLAYERS - seated - waiting), restartAt: null, waiting };
}

/** "1 more agent" / "2 more agents". */
export function agentsText(n: number): string {
  return n === 1 ? '1 more agent' : `${n} more agents`;
}

/**
 * The line for a player who is not seated in the round being played (a late
 * joiner or a returning removed player, 0019 item 2, 0020 item 4), or null.
 * Between rounds (scrubbed, results) they are told they are in next.
 */
export function onDeckText(state: PublicState, you: string): string | null {
  const me = state.players.find((p) => p.id === you);
  if (!me || me.removed) return null;
  const phase = state.phase.name;
  const onRoster = state.round?.roster.includes(you) ?? false;
  if (ROUND_ON.has(phase)) {
    if (onRoster) return null;
    return "You're on deck, agent. This round is already underway; you'll be briefed for the next one.";
  }
  if ((phase === 'scrubbed' || phase === 'results') && !me.seated && !(state.progress && state.progress.completed >= state.progress.total)) {
    return "You're on deck, agent. You'll be briefed with everyone in the next round.";
  }
  return null;
}

/** Things waiting on the host: agents who went dark (removable) and "Rejoin as…" requests (0024). */
export function hostAttention(state: PublicState): number {
  return darkPlayers(state).length + state.rejoinRequests.length;
}
