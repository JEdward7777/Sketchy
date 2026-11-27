import { DurableObject } from 'cloudflare:workers';
import { createRoom, nextDeadline, reduce, type Input, type RoomState } from '../shared/core';
import { ROOM_EXPIRY_MS } from '../shared/core/rules';
import type { WireStroke } from '../shared/stroke-codec';
import type { WordEntry } from '../shared/guess';
import {
  CLOSE_NO_ROOM,
  CLOSE_VERSION_MISMATCH,
  PROTOCOL_VERSION,
  parseClientMessage,
  type GameIntent,
  type ServerMessage,
} from '../shared/protocol';
import { armAlarm } from './alarm';
import { now } from './clock';
import { mintConnId, mintToken, randomU32 } from './random';
import {
  FAILED_ALARM_RETRY_MS,
  MAX_DEALS_PER_EVENT,
  dealBackoff,
  describeError,
  faultAt,
  hasPlayer,
  privateFrame,
  publicFrame,
} from './room-policy';
import { RoomStore, type PendingDeal, type Stored } from './room-store';
import { applyBinds, deliver, reconcile, type Binds } from './room-sockets';
import { attachmentOf, closeSocket, isLive, send, sendRaw, setAttachment } from './sockets';
import { wordSource, type DealtWord } from './words';

/** Inputs in one event; a real event has a handful. Turns an adapter bug into an error, not a hang. */
const MAX_INPUTS_PER_EVENT = 100;

/** One thing that happened to the room; each becomes one or more reducer inputs. */
type RoomEvent =
  | { readonly kind: 'intent'; readonly ws: WebSocket; readonly intent: GameIntent }
  | { readonly kind: 'close'; readonly conn: string }
  | { readonly kind: 'tick' }
  | { readonly kind: 'dealt'; readonly roundNo: number; readonly entry: WordEntry; readonly repeat: boolean };

/**
 * Built when it is reached, from the state so far and the binds so far, so
 * an intent sent unbound counts as from a player an earlier input of the
 * same event bound its socket to (a "Rejoin as…" admitted on a presence
 * change).
 */
type Queued = Input | ((state: RoomState, binds: Binds) => Input);

/** Effects with side effects outside the reducer state, held until the event commits. */
interface Pending {
  readonly binds: Map<string, string>;
  readonly writes: ({ kind: 'store'; key: string; roundNo: number; strokes: readonly WireStroke[] } | { kind: 'clear'; roundNo: number })[];
  readonly sends: { conn: string; msg: ServerMessage }[];
}

/**
 * One room (`SPEC.md` §13): a thin adapter over the pure reducer
 * (`src/shared/core`, decision 0006 item 1).
 *
 * Every event loads the state from SQLite and calls `reduce` once per input
 * with 32 fresh CSPRNG bits (protocol.md "Reducer contract"). Effects that
 * touch anything outside the state are collected, then committed in order:
 * drawing rows and the new state in one SQLite transaction, then socket
 * attachments, then the frames, then the one alarm (`nextDeadline` plus a
 * pending deal's retry). A failing event therefore leaves storage and
 * sockets as they were.
 *
 * Hibernation rules: sockets are accepted with `ctx.acceptWebSocket()` only;
 * nothing about time or players lives in memory. Per-socket facts are in
 * the attachment (`./sockets`), everything else in storage (`./room-store`),
 * and "now" comes from `./clock` so the DO leg can fire a deadline at its
 * own instant.
 *
 * Secrecy (§14): `state` frames are `projectPublic`, one string sent to
 * every socket; `private` frames are `projectPrivate` for the socket's own
 * bound player only. Nothing from the state is logged.
 */
export class RoomDO extends DurableObject<Env> {
  private readonly store: RoomStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new RoomStore(ctx.storage);
  }

  /**
   * Initialise this room as `code` (stage 4.2). False when it already
   * exists, so the Worker retries with another code (decision 0007 item 1).
   * The two seeds are separate CSPRNG draws (protocol.md: independent).
   */
  async create(code: string): Promise<boolean> {
    if (this.store.load()) return false;
    const stored: Stored = { state: createRoom(code, randomU32(), now(), randomU32()), deal: null };
    this.store.save(stored);
    await this.arm(stored);
    return true;
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // The hibernation API: the runtime holds the socket and may evict this
    // object between messages. Never the socket's own accept.
    this.ctx.acceptWebSocket(server);
    setAttachment(server, { conn: mintConnId(), helloed: false, player: null });
    if (!this.store.exists()) {
      // A code nobody created (or already expired) still gets a socket, so the
      // client hears an exact `no_room` instead of a failed upgrade it cannot
      // tell from a network drop. Nothing is written: no storage, no alarm.
      send(server, { type: 'error', code: 'no_room', message: 'no such room' });
      closeSocket(server, CLOSE_NO_ROOM, 'no_room');
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.guarded(async () => {
      const a = attachmentOf(ws);
      // Frames the client sent before it saw our close still arrive here.
      if (!a || a.closed) return;
      const msg = parseClientMessage(raw);
      if (!msg) return send(ws, { type: 'error', code: 'bad_message', message: 'unreadable message' });
      if (msg.type === 'hello') return this.hello(ws, msg.v);
      if (!a.helloed) return send(ws, { type: 'error', code: 'hello_first', message: 'send hello first' });
      if (msg.type === 'ping') return send(ws, { type: 'pong', t: msg.t, serverTime: now() });
      await this.handle({ kind: 'intent', ws, intent: msg });
    });
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed (the runtime may have answered the close itself).
    }
    await this.closed(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.closed(ws);
  }

  /**
   * Guarded like every handler: a failure re-arms the alarm itself (see
   * `recover`), so the runtime's own alarm retries are not needed.
   */
  override async alarm(): Promise<void> {
    await this.guarded(() => this.handle({ kind: 'tick' }));
  }

  /** Decision 0007 item 8 on mismatch; otherwise welcome plus the current state (and the player's view on a re-hello). */
  private hello(ws: WebSocket, v: number): void {
    const a = attachmentOf(ws)!;
    if (v !== PROTOCOL_VERSION) {
      send(ws, { type: 'error', code: 'version', message: `server speaks protocol ${PROTOCOL_VERSION}` });
      return closeSocket(ws, CLOSE_VERSION_MISMATCH, 'version');
    }
    const stored = this.store.load();
    if (!stored) {
      send(ws, { type: 'error', code: 'no_room', message: 'no such room' });
      return closeSocket(ws, CLOSE_NO_ROOM, 'no_room');
    }
    setAttachment(ws, { ...a, helloed: true });
    send(ws, { type: 'welcome', v: PROTOCOL_VERSION, serverTime: now() });
    sendRaw(ws, publicFrame(stored.state));
    if (hasPlayer(stored.state, a.player)) {
      const own = privateFrame(stored.state, a.player);
      if (own) sendRaw(ws, own);
    }
  }

  /** A socket closed or errored (4.1.2). A socket that never finished `hello` was never bound and asked for nothing. */
  private async closed(ws: WebSocket): Promise<void> {
    const a = attachmentOf(ws);
    if (!a || !a.helloed) return;
    await this.guarded(() => this.handle({ kind: 'close', conn: a.conn }));
  }

  /** An exception in a hibernation handler is only logged by the runtime; log a safe description, never state. */
  private async guarded(f: () => Promise<void>): Promise<void> {
    try {
      await f();
    } catch (err) {
      console.error('room event failed:', describeError(err));
    }
  }

  private inputsFor(event: RoomEvent, state: RoomState): Queued[] {
    switch (event.kind) {
      // connClosed before any other input (protocol.md "Ordering").
      case 'close':
        return [{ kind: 'connClosed', conn: event.conn }, ...reconcile(this.ctx.getWebSockets(), state, event.conn)];
      case 'tick':
        return [...reconcile(this.ctx.getWebSockets(), state, null), { kind: 'tick' }];
      case 'dealt':
        return [...reconcile(this.ctx.getWebSockets(), state, null), { kind: 'wordDealt', roundNo: event.roundNo, entry: event.entry, repeat: event.repeat }];
      case 'intent': {
        const { ws, intent } = event;
        const mint = intent.type === 'join' || intent.type === 'rejoinAs';
        return [
          ...reconcile(this.ctx.getWebSockets(), state, null),
          (current, binds): Input => {
            const a = attachmentOf(ws)!;
            const player = binds.get(a.conn) ?? a.player;
            return {
              kind: 'intent',
              conn: a.conn,
              player: hasPlayer(current, player) ? player : null,
              intent,
              ...(mint ? { mintedToken: mintToken() } : {}),
            };
          },
        ];
      }
    }
  }

  /** One event; on failure the alarm is re-armed from what storage still holds. */
  private async handle(event: RoomEvent, dealsLeft = MAX_DEALS_PER_EVENT): Promise<void> {
    try {
      await this.step(event, dealsLeft);
    } catch (err) {
      await this.recover(event.kind === 'tick');
      throw err;
    }
  }

  /** Load, reduce every input, commit, send, arm; then answer a requested deal. */
  private async step(event: RoomEvent, dealsLeft: number): Promise<void> {
    const stored = this.store.load();
    if (!stored) {
      // Never created or expired: nothing to run, nothing to wake for.
      if (event.kind === 'tick') await armAlarm(this.ctx.storage, []);
      if (event.kind === 'intent') {
        send(event.ws, { type: 'error', code: 'no_room', message: 'no such room' });
        closeSocket(event.ws, CLOSE_NO_ROOM, 'no_room');
      }
      return;
    }
    const t = now();
    const before = stored.state;
    const boundBefore = new Map<string, string>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = attachmentOf(ws);
      if (a?.player && isLive(ws)) boundBefore.set(a.conn, a.player);
    }

    let state = before;
    let deal: PendingDeal | null = stored.deal;
    let askDeal = false;
    let expired = false;
    const pending: Pending = { binds: new Map(), writes: [], sends: [] };
    const queue = this.inputsFor(event, state);
    for (let i = 0; i < queue.length && !expired; i++) {
      if (i >= MAX_INPUTS_PER_EVENT) throw new Error(`more than ${MAX_INPUTS_PER_EVENT} inputs in one event`);
      const q = queue[i]!;
      const step = reduce(state, typeof q === 'function' ? q(state, pending.binds) : q, t, randomU32());
      state = step.state;
      for (const e of step.effects) {
        switch (e.type) {
          case 'send':
            pending.sends.push(e);
            break;
          case 'bind':
            pending.binds.set(e.conn, e.player);
            break;
          case 'dealWord': {
            // A re-deal of the same round (a used word, §6) keeps counting, so the backoff grows.
            const attempts = deal && deal.roundNo === e.roundNo ? deal.attempts + 1 : 0;
            deal = { roundNo: e.roundNo, difficulty: e.difficulty, exclude: [...e.exclude], attempts, retryAt: t + dealBackoff(attempts) };
            askDeal = true;
            break;
          }
          case 'storeDrawing':
            // Emitted by `draw:done` for the round in progress.
            pending.writes.push({ kind: 'store', key: e.key, roundNo: state.round!.no, strokes: e.strokes });
            queue.push({ kind: 'drawingStored', key: e.key });
            break;
          case 'clearDrawings':
            pending.writes.push({ kind: 'clear', roundNo: e.roundNo });
            break;
          case 'expireRoom':
            expired = true;
            break;
        }
      }
    }

    if (expired) return this.expire();

    // A deal answers only the round it was asked for; leaving `dealing` (host:end, a cancel) drops it.
    if (deal && !(state.phase.name === 'dealing' && state.round?.no === deal.roundNo)) deal = null;
    if (deal && !askDeal && event.kind === 'tick' && deal.retryAt <= t) {
      deal = { ...deal, attempts: deal.attempts + 1, retryAt: t + dealBackoff(deal.attempts + 1) };
      askDeal = true;
    }

    const next: Stored = { state, deal };
    this.store.transaction(() => {
      for (const w of pending.writes) {
        if (w.kind === 'store') this.store.storeDrawing(w.key, w.roundNo, w.strokes);
        else this.store.clearDrawings(w.roundNo);
      }
      faultAt('commit');
      this.store.save(next);
    });
    const replaced = applyBinds(this.ctx.getWebSockets(), pending.binds);
    deliver(this.ctx.getWebSockets(), before, state, boundBefore, pending.sends, replaced);
    await this.arm(next);

    if (askDeal && deal && dealsLeft > 0) await this.deal(deal, dealsLeft - 1);
  }

  /**
   * Ask the word source (`DeckDO` over RPC) and feed the answer back as
   * `wordDealt`, in a new event that loads the state afresh: other events
   * may run while the RPC is awaited, so the step that asked has already
   * committed and nothing here holds state across the await. On failure the pending deal stays
   * stored and the alarm retries it at `retryAt` with a growing backoff (O-07).
   */
  private async deal(deal: PendingDeal, dealsLeft: number): Promise<void> {
    let dealt: DealtWord;
    try {
      dealt = await wordSource(this.env).deal(deal.difficulty, deal.exclude);
    } catch (err) {
      console.error('deal failed, retrying from the alarm:', describeError(err));
      return;
    }
    // Its own event: a failure there has already re-armed from storage and
    // must not reach the event that asked, which committed (an alarm's
    // `recover` would push every deadline back by FAILED_ALARM_RETRY_MS).
    try {
      await this.handle({ kind: 'dealt', roundNo: deal.roundNo, entry: dealt.entry, repeat: dealt.repeat === true }, dealsLeft);
    } catch (err) {
      console.error('room event failed:', describeError(err));
    }
  }

  /** §14: the room has been idle for `ROOM_EXPIRY_MS`. Close every socket and clear storage; the code is free again. */
  private async expire(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      if (!isLive(ws)) continue;
      send(ws, { type: 'error', code: 'no_room', message: 'the room expired' });
      closeSocket(ws, CLOSE_NO_ROOM, 'expired');
    }
    await this.store.clear();
  }

  /**
   * After a failed event, keep the alarm pointed at what storage still
   * holds, so the room cannot lose its deadlines or its expiry. A failed
   * alarm waits at least `FAILED_ALARM_RETRY_MS`, so a deadline that keeps
   * throwing is not retried in a hot loop; once the room is past its §14
   * expiry it is cleared by the adapter, since the reducer cannot get there.
   */
  private async recover(fromAlarm: boolean): Promise<void> {
    const stored = this.store.load();
    if (!stored) {
      await armAlarm(this.ctx.storage, []);
      return;
    }
    const t = now();
    if (fromAlarm && stored.state.lastActivityAt + ROOM_EXPIRY_MS <= t) return this.expire();
    await this.arm(stored, fromAlarm ? t + FAILED_ALARM_RETRY_MS : null);
  }

  private async arm(stored: Stored, notBefore: number | null = null): Promise<void> {
    const deadlines: number[] = [];
    const next = nextDeadline(stored.state);
    if (next !== null) deadlines.push(next);
    if (stored.deal) deadlines.push(stored.deal.retryAt);
    await armAlarm(this.ctx.storage, notBefore === null ? deadlines : deadlines.map((d) => Math.max(d, notBefore)));
  }
}
