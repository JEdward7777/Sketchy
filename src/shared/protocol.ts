/**
 * Wire protocol shared by the client and `RoomDO`. Reference:
 * `harness/reference/protocol.md`.
 *
 * Every frame is one JSON object with a string `type`; the remaining fields
 * belong to that type. Phase 1 defined the handshake and clock probe; stage
 * 3.1 adds the game intents and the `state` / `private` messages, which the
 * reducer (src/shared/core) consumes and produces.
 */

import { DIFFICULTIES, type DifficultySetting } from './difficulty-bag';
import type { PrivateView, PublicState } from './core/views';
import { STROKES_MAX_BYTES } from './stroke-format';
import { validateCustomTimers, type TimerChoice, type TimerSettings } from './timers';

export type { PrivateView, PublicState } from './core/views';

/**
 * Bump on any incompatible change to a message shape. A mismatched client is
 * told `error {code: "version"}` and disconnected (decision 0007 item 8), so a
 * deploy mid-evening fails loudly instead of desyncing. Stage 3.1 only added
 * message types, so phase-1 messages keep their shapes and the version stays.
 */
export const PROTOCOL_VERSION = 1;

/** Close code sent with a version mismatch (4000–4999 is application-defined). */
export const CLOSE_VERSION_MISMATCH = 4000;

/**
 * The largest frame `parseClientMessage` reads, in UTF-8 bytes. A drawing is
 * the largest honest frame, so the stroke safety limit (decision 0009 item 4)
 * bounds every frame.
 */
export const FRAME_MAX_BYTES = STROKES_MAX_BYTES;

/** Longest string field accepted in any intent; the reducer applies tighter rules (e.g. names). */
export const FIELD_MAX_LENGTH = 256;

/** An unbound socket joins as a new player (§2). The adapter mints the token. */
export interface JoinIntent { readonly type: 'join'; readonly name: string; readonly color: string; readonly icon: string }
/** Reconnect with the token kept in localStorage (§7). */
export interface RejoinIntent { readonly type: 'rejoin'; readonly token: string }
/**
 * "Rejoin as…" a disconnected player from a new device (§7, 0019 item 1).
 * Mid-round it only asks the host (decision 0024); the adapter mints a
 * token for it, as for `join`.
 */
export interface RejoinAsIntent { readonly type: 'rejoinAs'; readonly playerId: string }

export interface SettingsPatch {
  readonly difficulty?: DifficultySetting;
  readonly cycles?: number;
  readonly timers?: TimerChoice;
  readonly custom?: TimerSettings;
}

/** Intents from a socket already bound to a player. */
export type PlayerIntent =
  | { readonly type: 'host:settings'; readonly settings: SettingsPatch }
  | { readonly type: 'host:start' }
  /** Continue now; `seq` is the `PublicState.seq` it was tapped in (0004 rules 4 and 6). */
  | { readonly type: 'host:next'; readonly seq: number }
  /** A tap elsewhere on the host's screen (0004 rules 3 and 5; not the envelope, 0017). */
  | { readonly type: 'host:hold' }
  /** The host's narrator started or stopped speaking (0004 rule 2). */
  | { readonly type: 'host:narration'; readonly speaking: boolean }
  | { readonly type: 'host:remove'; readonly playerId: string }
  | { readonly type: 'host:end' }
  /** Take over as host while the host is disconnected (0010). */
  | { readonly type: 'host:claim' }
  /** Approve or decline a pending mid-round "Rejoin as…" for `playerId` (0024 item 2). */
  | { readonly type: 'host:admit'; readonly playerId: string; readonly approve: boolean }
  /** Done drawing; `strokes` is the wire stroke list, validated by the reducer (0009). */
  | { readonly type: 'draw:done'; readonly strokes: unknown }
  | { readonly type: 'vote:set'; readonly targetId: string }
  | { readonly type: 'vote:lock' }
  | { readonly type: 'guess:submit'; readonly text: string }
  | { readonly type: 'guess:judge'; readonly accept: boolean };

export type GameIntent = JoinIntent | RejoinIntent | RejoinAsIntent | PlayerIntent;

export type ClientMessage =
  | { type: 'hello'; v: number }
  | { type: 'ping'; t: number }
  | GameIntent;

export type ErrorCode =
  | 'version'
  | 'bad_message'
  | 'hello_first'
  // Game errors, raised by the reducer (protocol.md lists what each means).
  | 'join_first'
  | 'already_joined'
  | 'room_full'
  | 'bad_name'
  | 'bad_color'
  | 'color_taken'
  | 'bad_icon'
  | 'unknown_token'
  | 'not_rejoinable'
  | 'not_host'
  | 'wrong_phase'
  | 'paused'
  | 'bad_settings'
  | 'not_enough_players'
  | 'not_removable'
  | 'host_connected'
  | 'rejoin_pending'
  | 'no_request'
  | 'not_in_round'
  | 'already_done'
  | 'bad_strokes'
  | 'bad_target'
  | 'vote_locked'
  | 'no_vote'
  | 'not_faker'
  | 'bad_guess'
  | 'not_judge'
  | 'already_judged';

export type ServerMessage =
  | { type: 'welcome'; v: number; serverTime: number }
  | { type: 'pong'; t: number; serverTime: number }
  | { type: 'error'; code: ErrorCode; message: string }
  /** The same for every socket; broadcast when it changes (§14). */
  | { type: 'state'; state: PublicState }
  /** One socket only (§14). */
  | { type: 'private'; view: PrivateView }
  /**
   * To the socket that sent a mid-round `rejoinAs` (0024): `pending` while
   * the host decides, `declined` by the host, `cancelled` when the request
   * lapsed (the player came back by token). Admission arrives as `private`.
   */
  | { type: 'rejoin'; playerId: string; status: 'pending' | 'declined' | 'cancelled' };

/** UTF-8 length of a string, without allocating (no TextEncoder in the shared runtime). */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

const isField = (v: unknown): v is string => typeof v === 'string' && v.length <= FIELD_MAX_LENGTH;
const TIMER_CHOICES: readonly string[] = ['quick', 'normal', 'relaxed', 'custom'];
const DIFFICULTY_SETTINGS: readonly string[] = [...DIFFICULTIES, 'mixed'];

/** A settings patch, or null when any present field is malformed. */
function parseSettings(value: unknown): SettingsPatch | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const out: { -readonly [K in keyof SettingsPatch]: SettingsPatch[K] } = {};
  if (v.difficulty !== undefined) {
    if (typeof v.difficulty !== 'string' || !DIFFICULTY_SETTINGS.includes(v.difficulty)) return null;
    out.difficulty = v.difficulty as DifficultySetting;
  }
  if (v.cycles !== undefined) {
    if (!Number.isInteger(v.cycles)) return null;
    out.cycles = v.cycles as number;
  }
  if (v.timers !== undefined) {
    if (typeof v.timers !== 'string' || !TIMER_CHOICES.includes(v.timers)) return null;
    out.timers = v.timers as TimerChoice;
  }
  if (v.custom !== undefined) {
    const r = validateCustomTimers(v.custom);
    if (!r.ok) return null;
    out.custom = r.timers;
  }
  return out;
}

function parseIntent(msg: Record<string, unknown>): GameIntent | null {
  switch (msg.type) {
    case 'join':
      return isField(msg.name) && isField(msg.color) && isField(msg.icon)
        ? { type: 'join', name: msg.name, color: msg.color, icon: msg.icon }
        : null;
    case 'rejoin':
      return isField(msg.token) ? { type: 'rejoin', token: msg.token } : null;
    case 'rejoinAs':
      return isField(msg.playerId) ? { type: 'rejoinAs', playerId: msg.playerId } : null;
    case 'host:settings': {
      const settings = parseSettings(msg.settings);
      return settings ? { type: 'host:settings', settings } : null;
    }
    case 'host:start':
    case 'host:hold':
    case 'host:end':
    case 'host:claim':
    case 'vote:lock':
      return { type: msg.type };
    case 'host:next':
      return Number.isInteger(msg.seq) ? { type: 'host:next', seq: msg.seq as number } : null;
    case 'host:narration':
      return typeof msg.speaking === 'boolean' ? { type: 'host:narration', speaking: msg.speaking } : null;
    case 'host:remove':
      return isField(msg.playerId) ? { type: 'host:remove', playerId: msg.playerId } : null;
    case 'host:admit':
      return isField(msg.playerId) && typeof msg.approve === 'boolean'
        ? { type: 'host:admit', playerId: msg.playerId, approve: msg.approve }
        : null;
    case 'draw:done':
      return 'strokes' in msg ? { type: 'draw:done', strokes: msg.strokes } : null;
    case 'vote:set':
      return isField(msg.targetId) ? { type: 'vote:set', targetId: msg.targetId } : null;
    case 'guess:submit':
      return isField(msg.text) ? { type: 'guess:submit', text: msg.text } : null;
    case 'guess:judge':
      return typeof msg.accept === 'boolean' ? { type: 'guess:judge', accept: msg.accept } : null;
    default:
      return null;
  }
}

/**
 * Parse one inbound frame into a `ClientMessage`, or null if it is not one.
 * Structural checks only; nothing here trusts the sender. Frames over
 * `FRAME_MAX_BYTES` are refused before parsing.
 */
export function parseClientMessage(raw: string | ArrayBuffer): ClientMessage | null {
  if (typeof raw !== 'string') return null;
  // Each UTF-16 unit is at most 3 UTF-8 bytes, so short frames skip the count.
  if (raw.length * 3 > FRAME_MAX_BYTES && utf8ByteLength(raw) > FRAME_MAX_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const msg = value as Record<string, unknown>;
  switch (msg.type) {
    case 'hello':
      return Number.isInteger(msg.v) ? { type: 'hello', v: msg.v as number } : null;
    case 'ping':
      return Number.isFinite(msg.t) ? { type: 'ping', t: msg.t as number } : null;
    default:
      return parseIntent(msg);
  }
}
