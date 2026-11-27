/**
 * `reduce(state, input, now, entropy) → {state, effects}` (stage 3.3,
 * decision 0006).
 *
 * Pure: no clock, no randomness other than the state's generators, no I/O.
 * `now` is the adapter's clock, `entropy` 32 fresh bits from the adapter's
 * CSPRNG, and every effect is performed by the adapter.
 *
 * Before anything else, `entropy` is absorbed into both generators (the
 * order stream gets a differently mixed copy, so the streams stay apart).
 * Every random choice in the call is then made from a state holding at
 * least 32 bits nobody outside the room has seen, so revealed fakers, Mixed
 * draws or slideshow orders cannot pin the generator and predict the next
 * faker (observation O-10, decision 0020 item 5).
 *
 * Every call does three things, in order:
 * 1. fire every deadline due at `now`, earliest first, each at its own
 *    instant (so a late alarm, or an intent that beats the alarm, sees the
 *    same history as an on-time alarm);
 * 2. handle the input;
 * 3. `settle`: apply the rules that follow from the state rather than from
 *    one event — pause/resume and the 0023 restart, the faker-disconnect
 *    cancel, the all-done, all-locked and all-judged early ends, and pending
 *    "Rejoin as…" requests.
 */

import { mix32, rngAbsorb } from '../rng';
import { firstDue, type Due } from './next-deadline';
import { sendError, type Fx, type Input, type Step } from './io';
import { join, lobbyIntent } from './lobby';
import { connClosed, rejoin, rejoinAs, settleRejoins } from './rejoin';
import { expireGrace, goOffline, goOnline, maybePause, maybeResume, onlineReadyCount, restartAt, unpause } from './presence';
import { MIN_PLAYERS } from './rules';
import { afterResults, hostIntent } from './game-end';
import { endJudging, everyoneConnectedJudged, guessIntent, guessTimedOut, startGuess } from './guessing';
import { cancelRound, cancellable, drawingStored, everyoneConnectedDone, roundIntent, startDraw, startRound, wordDealt } from './round';
import { findPlayer, isConnected, type RoomState } from './state';
import { everyoneConnectedLocked, startBrowse, startSlideshow, startUnmask, voteIntent, votingOpen } from './voting';

/**
 * At most this many deadlines fire in one call. Each firing either moves the
 * phase on or clears one grace, so a real room needs a handful; the bound
 * only turns a reducer bug into an error instead of a hung Durable Object.
 */
const MAX_DUE_PER_STEP = 1000;

/**
 * Decisions 0023 item 1 and 0025 item 1: a paused round that has waited
 * `RESTART_WAIT_MS` and that 3 players with an open socket (seated or
 * waiting) could play is scrubbed like a §7 cancel (no points, not counted,
 * generic wording); the next round, after the scrubbed beat, seats everyone
 * with a fresh faker. The trigger reads only the pause start and presence,
 * which are public, so it is the same whoever the faker is.
 */
function maybeRestart(state: RoomState, at: number, fx: Fx): RoomState {
  const when = restartAt(state);
  if (when === null || at < when || onlineReadyCount(state) < MIN_PLAYERS) return state;
  return cancelRound(unpause(state, at), at, fx);
}

/**
 * The round rules that follow from the state, applied at instant `at`.
 * Order:
 * 1. a seated player's return resumes the round (0023 item 1: "no seated
 *    player's return has already lifted the pause"); only a pause still on
 *    can restart with newcomers;
 * 2. the faker-disconnect cancel, before any pause the same event causes
 *    (§7, 0011 item 4);
 * 3. the pause, before the draw's early end: if one disconnect both drops
 *    the game below 3 and leaves every connected player done, the draw
 *    freezes rather than ending without the missing drawing (0011 item 3);
 *    a pause newcomers can already lift restarts at once (0023);
 * 4. the early ends over connected roster players: all done drawing
 *    (0012 item 5), all locked (0016, mid-slideshow included), all judged
 *    (0013 item 3). Each waits behind a pause the same way as the draw's;
 * 5. the pause again: an early end can enter a phase that may pause (the
 *    judging end opens round results), so round results never open
 *    unpaused with fewer than 3 who could play the next round.
 */
function settleRound(state: RoomState, at: number, fx: Fx): RoomState {
  let s = maybeRestart(maybeResume(state, at), at, fx);
  if (s.pause) return s;
  if (cancellable(s) && s.round && !isConnected(s, s.round.faker)) s = cancelRound(s, at, fx);
  s = maybePause(s, at);
  if (s.pause) return maybeRestart(s, at, fx);
  if (s.phase.name === 'draw' && everyoneConnectedDone(s)) s = startSlideshow(s, at);
  if (votingOpen(s) && everyoneConnectedLocked(s)) s = startUnmask(s, at);
  if (s.phase.name === 'judging' && everyoneConnectedJudged(s)) s = endJudging(s, at);
  return maybePause(s, at);
}

/** Round rules, then rejoin requests (0024); an admission changes presence, so the round rules run again. */
function settle(state: RoomState, at: number, fx: Fx): RoomState {
  const s = settleRound(state, at, fx);
  const r = settleRejoins(s, fx);
  return r === s ? s : settleRound(r, at, fx);
}

function fire(state: RoomState, due: Due, fx: Fx): RoomState {
  switch (due.kind) {
    case 'expiry':
      fx.push({ type: 'expireRoom' });
      return { ...state, expired: true };
    case 'grace':
      return expireGrace(state, due.player, due.at);
    case 'restart':
      // Fires once; `settle` (run next, at `due.at`) restarts if 3 can play.
      return state.pause ? { ...state, pause: { ...state.pause, waited: true } } : state;
    case 'phase':
      switch (state.phase.name) {
        case 'briefing':
          return startDraw(state, due.at);
        case 'draw':
          // Submissions closed at endsAt + grace; the slideshow starts then (3.3.2).
          return startSlideshow(state, due.at);
        case 'slideshow':
          return startBrowse(state, due.at);
        case 'browse':
          return startUnmask(state, due.at);
        case 'unmask':
          return startGuess(state, due.at);
        case 'guess':
        case 'judging':
          return guessTimedOut(state, due.at);
        case 'results':
          return afterResults(state, due.at, fx);
        case 'scrubbed':
          return startRound(state, due.at, fx);
        default:
          throw new Error(`no phase deadline in ${state.phase.name}`);
      }
  }
}

function runDue(state: RoomState, now: number, fx: Fx): RoomState {
  let s = state;
  for (let i = 0; i < MAX_DUE_PER_STEP; i++) {
    if (s.expired) return s;
    const due = firstDue(s, now);
    if (!due) return s;
    s = settle(fire(s, due, fx), due.at, fx);
  }
  throw new Error(`more than ${MAX_DUE_PER_STEP} deadlines due in one step`);
}

/** The player `conn` was bound to by an effect so far in this step, if any. */
function boundIn(fx: Fx, conn: string): string | null {
  const bind = fx.find((e) => e.type === 'bind' && e.conn === conn);
  return bind && bind.type === 'bind' ? bind.player : null;
}

/** A socket that got bound another way gives up any rejoin request it made; a refused join keeps it. */
function dropRequestIfBound(state: RoomState, conn: string, fx: Fx): RoomState {
  return fx.some((e) => e.type === 'bind' && e.conn === conn) ? connClosed(state, conn) : state;
}

function handle(state: RoomState, input: Exclude<Input, { kind: 'tick' }>, now: number, fx: Fx): RoomState {
  switch (input.kind) {
    case 'presence': {
      const p = findPlayer(state, input.player);
      // A removed player returns only through rejoin/rejoinAs, which clears `removed` (0019).
      if (!p || (input.connected && p.removed)) return state;
      return input.connected ? goOnline(state, input.player) : goOffline(state, input.player, now);
    }
    case 'wordDealt':
      return wordDealt(state, input.roundNo, input.entry, now, fx, input.repeat === true);
    case 'drawingStored':
      return drawingStored(state, input.key);
    case 'connClosed':
      return connClosed(state, input.conn);
    case 'intent':
      break;
  }
  const { conn, player, intent } = input;
  if (player === null) {
    switch (intent.type) {
      case 'join':
        return dropRequestIfBound(join(state, conn, intent, input.mintedToken, fx), conn, fx);
      case 'rejoin':
        return dropRequestIfBound(rejoin(state, conn, intent.token, fx), conn, fx);
      case 'rejoinAs':
        return rejoinAs(state, conn, intent.playerId, input.mintedToken, fx);
      default:
        return (sendError(fx, conn, 'join_first', 'join the room first'), state);
    }
  }
  if (intent.type === 'join' || intent.type === 'rejoin' || intent.type === 'rejoinAs') {
    return (sendError(fx, conn, 'already_joined', 'this connection already has an agent'), state);
  }
  if (!findPlayer(state, player)) throw new Error(`intent from unknown player ${player}`);
  const handled =
    lobbyIntent(state, conn, player, intent, now, fx) ??
    hostIntent(state, conn, player, intent, now, fx) ??
    roundIntent(state, conn, player, intent, fx) ??
    voteIntent(state, conn, player, intent, fx) ??
    guessIntent(state, conn, player, intent, now, fx);
  if (handled) return handled;
  throw new Error(`no handler for ${intent.type}`);
}

/** Separates the order stream's copy of the entropy from the faker stream's. */
const ORDER_STREAM_SALT = 0x9e3779b9;

function absorb(state: RoomState, entropy: number): RoomState {
  return {
    ...state,
    rng: rngAbsorb(state.rng, entropy),
    orderRng: rngAbsorb(state.orderRng, mix32((entropy ^ ORDER_STREAM_SALT) >>> 0)),
  };
}

/**
 * Inputs that keep the room alive (§14 "expires after a period of
 * inactivity"): only what players do, an intent from a socket or a player's
 * socket opening. The adapter's own answers (`wordDealt`, `drawingStored`),
 * socket closes (`connClosed`, presence going offline) and ticks do not, so
 * a room stuck re-dealing or left with only closing sockets still expires
 * `ROOM_EXPIRY_MS` after the last thing a player did.
 */
function isActivity(input: Input): boolean {
  return input.kind === 'intent' || (input.kind === 'presence' && input.connected);
}

export function reduce(state: RoomState, input: Input, now: number, entropy: number): Step {
  const fx: Fx = [];
  state = absorb(state, entropy);
  // A close has no time of its own, and the socket is already gone: drop its
  // request before overdue deadlines run, so a round ending in `runDue`
  // cannot admit (bind) a socket that no longer exists.
  let s = runDue(input.kind === 'connClosed' ? connClosed(state, input.conn) : state, now, fx);
  if (s.expired) return { state: s, effects: fx };
  if (input.kind !== 'tick') {
    // An overdue deadline may just have admitted this socket's rejoin request
    // (a round ended in `runDue`); its input then counts as from that player.
    const bound = input.kind === 'intent' && input.player === null ? boundIn(fx, input.conn) : null;
    s = handle(isActivity(input) ? { ...s, lastActivityAt: now } : s, bound && input.kind === 'intent' ? { ...input, player: bound } : input, now, fx);
  }
  s = settle(s, now, fx);
  return { state: s, effects: fx };
}
