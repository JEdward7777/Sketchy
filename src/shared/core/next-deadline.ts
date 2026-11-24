/**
 * Every deadline the room state holds (stage 3.5), and the earliest of them
 * for the one alarm (harness/AGENTS.md §5: a DO has exactly one alarm, so
 * all deadlines are multiplexed onto it).
 *
 * While paused, the phase and auto-continue deadlines are frozen (0011
 * item 3); blip graces, the 0025 restart wait and the room expiry stay live, because presence runs
 * on wall time (see `goOffline`).
 */

import { earliestDeadline } from '../deadlines';
import { autoDue } from './auto-continue';
import { restartAt } from './presence';
import { DRAW_SUBMIT_GRACE_MS, ROOM_EXPIRY_MS } from './rules';
import type { PlayerId, RoomState } from './state';

export type Due =
  /** The current phase's own deadline: briefing continue, draw close, scrubbed beat. */
  | { readonly kind: 'phase'; readonly at: number }
  /** A player's blip grace runs out (0012 item 2). */
  | { readonly kind: 'grace'; readonly at: number; readonly player: PlayerId }
  /** The 0025 restart wait has elapsed for a paused round; settle then decides. */
  | { readonly kind: 'restart'; readonly at: number }
  /** §14 inactivity expiry. */
  | { readonly kind: 'expiry'; readonly at: number };

/** When the current phase ends on its own, or null for a phase that waits on input. */
export function phaseDeadline(state: RoomState): number | null {
  const phase = state.phase;
  switch (phase.name) {
    case 'briefing':
      return autoDue(phase.auto);
    case 'draw':
      return phase.endsAt + DRAW_SUBMIT_GRACE_MS;
    case 'scrubbed':
      return phase.endsAt;
    case 'slideshow': // TODO(3b): the slideshow and later phases add their deadlines.
    case 'lobby':
    case 'dealing':
      return null;
  }
}

/** Every live deadline, in no particular order. */
export function pendingDeadlines(state: RoomState): Due[] {
  if (state.expired) return [];
  const out: Due[] = [{ kind: 'expiry', at: state.lastActivityAt + ROOM_EXPIRY_MS }];
  for (const p of state.players) {
    if (p.presence.graceUntil !== null) out.push({ kind: 'grace', at: p.presence.graceUntil, player: p.id });
  }
  if (state.pause) {
    // Public: the pause start plus a constant, the same whoever the faker is.
    const at = restartAt(state);
    if (at !== null && !state.pause.waited) out.push({ kind: 'restart', at });
    return out;
  }
  const phaseAt = phaseDeadline(state);
  if (phaseAt !== null) out.push({ kind: 'phase', at: phaseAt });
  return out;
}

/**
 * The earliest live deadline, which the adapter arms the alarm for; null
 * once the room has expired.
 */
export function nextDeadline(state: RoomState): number | null {
  return earliestDeadline(pendingDeadlines(state).map((d) => d.at));
}

/**
 * The deadline to fire next at `now`, or null when none is due. Ties go to
 * grace expiries first (a faker whose grace ends at the instant the draw
 * closes disconnected during the draw), then the phase, then the restart
 * wait, then expiry. The
 * choice is ours; no decision covers an exact tie.
 */
export function firstDue(state: RoomState, now: number): Due | null {
  const rank = { grace: 0, phase: 1, restart: 2, expiry: 3 } as const;
  let best: Due | null = null;
  for (const d of pendingDeadlines(state)) {
    if (d.at > now) continue;
    if (!best || d.at < best.at || (d.at === best.at && rank[d.kind] < rank[best.kind])) best = d;
  }
  return best;
}
