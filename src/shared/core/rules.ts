/**
 * The reducer's named constants (stage 3.2): room size, the beats and grace
 * periods the decisions introduce, the room expiry, and the join choices.
 * Every duration is milliseconds, like every deadline the room stores.
 */

import type { DifficultySetting } from '../difficulty-bag';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** §2 "3–10 players"; §7 "The game requires ≥3 active players". */
export const MIN_PLAYERS = 3;
/** §2. Removed players and waiting late joiners count toward it (0019 item 3). */
export const MAX_PLAYERS = 10;

/**
 * The short reconnect grace (decision 0012 item 2, shared with 0010 and 0011):
 * a socket close counts as a disconnect for game rules only once this has
 * passed without the player coming back, so a page reload does not cancel a
 * round, flash a pause, or offer the host role. Not set by any decision;
 * chosen to cover a phone reloading the app shell and reopening its socket.
 */
export const BLIP_GRACE_MS = 10 * SECOND;

/** §4 phase 1: "Short fixed countdown (~8 s) or host taps continue" — the 0004 fill length. */
export const BRIEFING_BEAT_MS = 8 * SECOND;

/** Decision 0004 rule 3: after a host hold, the fill re-arms after 60 s with no taps. */
export const HOLD_REARM_MS = 60 * SECOND;

/**
 * Decision 0004 rule 2 holds the fill while the host's narrator speaks. The
 * server caps a "speaking" signal at this long, so a lost "stopped" message
 * cannot stall the room. Not set by any decision; the §10 sample lines are
 * one short sentence each.
 */
export const NARRATION_CAP_MS = 15 * SECOND;

/**
 * Draw submissions are accepted until this long after the draw deadline,
 * strictly before `deadline + DRAW_SUBMIT_GRACE_MS` (stage 3.3.2), because §9 has each client send its drawing at the timeout;
 * on a timeout the slideshow starts at `deadline + DRAW_SUBMIT_GRACE_MS`.
 * Not set by any decision; meant to cover clock-offset error and the upload.
 */
export const DRAW_SUBMIT_GRACE_MS = 3 * SECOND;

/**
 * Decision 0025 item 1: a paused round restarts with newcomers (0023) only
 * once the pause has lasted this long, so a seated player who comes back
 * soon resumes the round with its drawings.
 */
export const RESTART_WAIT_MS = 30 * SECOND;

/**
 * How long the "Mission scrubbed" screen (decision 0012 item 3) shows after a
 * faker-disconnect cancel before the next round starts. Not set by any
 * decision.
 */
export const SCRUBBED_BEAT_MS = 5 * SECOND;

/**
 * §4 phase 5 "Unmask … Short fixed beat": how long votes and the faker show
 * before the guess opens. Not set by any decision; long enough for the
 * narrator's "The faker was… Maya!" (§10).
 */
export const UNMASK_BEAT_MS = 5 * SECOND;

/** Decision 0004 rule 1: round results auto-continue after "~8 s" of fill. */
export const RESULTS_BEAT_MS = 8 * SECOND;

/** §14: "A room expires after a period of inactivity (e.g. 2 h)". */
export const ROOM_EXPIRY_MS = 2 * HOUR;

/** Longest display name after trimming (§2 asks for a name; the cap is ours). */
export const NAME_MAX_LENGTH = 20;

/**
 * Player colors (§2: unique within the room), as theme ids; the hex values
 * belong to the client theme (stage 4.9.1). There are more than
 * `MAX_PLAYERS`, so a full room still leaves a choice.
 */
export const PLAYER_COLORS = [
  'red', 'orange', 'yellow', 'lime', 'green', 'teal',
  'sky', 'blue', 'purple', 'pink', 'brown', 'slate',
] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];

/** Spy icons, from the §2 list. Icons need not be unique. */
export const SPY_ICONS = [
  'fedora', 'sunglasses', 'magnifier', 'mustache',
  'trenchcoat', 'briefcase', 'binoculars', 'fingerprint',
] as const;
export type SpyIcon = (typeof SPY_ICONS)[number];

/** §6 lets the host pick a difficulty but names no default; decision 0023 item 2 makes it Mixed. */
export const DEFAULT_DIFFICULTY: DifficultySetting = 'mixed';
