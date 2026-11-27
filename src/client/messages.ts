/**
 * Player-facing text for the room's error codes (protocol.md "Errors"),
 * in the spy voice (`SPEC.md` §12). The server's `message` is for logs and
 * is never shown (protocol.md).
 */

import type { ErrorCode } from '../shared/protocol';
import { MIN_PLAYERS, NAME_MAX_LENGTH } from '../shared/core/rules';

const TEXT: Partial<Record<ErrorCode, string>> = {
  room_full: 'This mission is fully staffed. Ten agents is the limit.',
  bad_name: `Pick a code name of 1–${NAME_MAX_LENGTH} characters.`,
  bad_color: 'That color is not on the approved list.',
  color_taken: 'Another agent just grabbed that color. Pick a different one.',
  bad_icon: 'Pick one of the spy icons.',
  unknown_token: 'HQ lost your file. Join again, or rejoin as your old agent.',
  not_rejoinable: 'That agent is back online already.',
  rejoin_pending: 'A request for that agent is already waiting for the host.',
  not_host: 'Only the host can do that.',
  wrong_phase: 'Too late for that now.',
  paused: 'The mission is paused.',
  bad_settings: 'Those settings did not pass inspection.',
  not_enough_players: `You need at least ${MIN_PLAYERS} agents online to start.`,
  not_removable: 'Only an agent who went dark can be removed.',
  host_connected: 'The host is still here.',
  no_request: 'That request has already been handled.',
};

export function errorText(code: ErrorCode): string {
  return TEXT[code] ?? 'Something went sideways. Try that again.';
}
