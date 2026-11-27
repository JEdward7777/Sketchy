import { describe, expect, it } from 'vitest';
import { CLOCK_PROBES, REJOIN_RETRIES, REJOIN_RETRY_MS, RoomConnection, type SocketLike } from '../../../src/client/net/connection';
import {
  CONNECT_TIMEOUT_MAX_MS,
  CONNECT_TIMEOUT_MS,
  NUDGE_STALE_MS,
  connectTimeout,
  RECONNECT_FAST_CAP_MS,
  RECONNECT_FAST_WINDOW_MS,
  WAKE_PROBE_MS,
} from '../../../src/client/net/reconnect-policy';
import { TOKEN_MAX_AGE_MS, tokenKey, tokenStore } from '../../../src/client/net/token-store';
import { CLOSE_NO_ROOM, CLOSE_REPLACED, CLOSE_VERSION_MISMATCH, PROTOCOL_VERSION } from '../../../src/shared/protocol';
import { lobbyState, mapStorage, player } from './fixtures';

class FakeSocket implements SocketLike {
  sent: Record<string, unknown>[] = [];
  closed: number | null | undefined = null;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code?: number) {
    this.closed = code;
  }
  open() {
    this.onopen?.({} as Event);
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent);
  }
  drop(code = 1006) {
    this.onclose?.({ code } as CloseEvent);
  }
  types() {
    return this.sent.map((m) => m.type);
  }
}

function harness(opts: { token?: string } = {}) {
  let clock = 1_000;
  const storage = mapStorage();
  const tokens = tokenStore(storage, () => clock);
  if (opts.token) tokens.set('ABCD', opts.token);
  const sockets: FakeSocket[] = [];
  let timers: { fn: () => void; at: number; ms: number; id: number }[] = [];
  const delays: number[] = [];
  let nextId = 0;
  const conn = new RoomConnection('abcd', {
    url: 'wss://x/ws/ABCD',
    openSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    tokens,
    now: () => clock,
    setTimer: (fn, ms) => {
      const t = { fn, at: clock + ms, ms, id: nextId++ };
      timers.push(t);
      delays.push(ms);
      return t.id;
    },
    clearTimer: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
    random: () => 0.999,
  });
  /** Move the clock forward, firing timers as they come due. */
  const advance = (ms: number) => {
    const end = clock + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= end).sort((x, y) => x.at - y.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      clock = due.at;
      due.fn();
    }
    clock = end;
  };
  const last = () => sockets.at(-1)!;
  const welcome = (s = last()) => {
    s.open();
    s.receive({ type: 'welcome', v: PROTOCOL_VERSION, serverTime: 5_000 });
  };
  /** Drop the open socket and let the retry fire. */
  const bounce = (code = 1006) => {
    last().drop(code);
    advance(RECONNECT_FAST_CAP_MS);
  };
  return { conn, tokens, storage, sockets, delays, last, welcome, advance, bounce, pending: () => timers.length, setClock: (t: number) => (clock = t) };
}

const view = (id: string, token: string) => ({ type: 'private', view: { you: { id, token }, round: null } });
const err = (code: string) => ({ type: 'error', code, message: '' });

describe('room connection: handshake and clock (stages 4.3, 4.8)', () => {
  it('says hello with the protocol version, then probes the clock a few times', () => {
    const h = harness();
    h.conn.start();
    expect(h.conn.getSnapshot().status).toBe('connecting');
    h.last().open();
    expect(h.last().sent[0]).toEqual({ type: 'hello', v: PROTOCOL_VERSION });
    h.welcome();
    expect(h.conn.getSnapshot().status).toBe('open');
    for (let i = 0; i < 10; i++) {
      const p = h.last().sent.filter((m) => m.type === 'ping').at(i);
      if (!p) break;
      h.advance(40);
      h.last().receive({ type: 'pong', t: p.t, serverTime: 900_000 });
    }
    expect(h.last().sent.filter((m) => m.type === 'ping')).toHaveLength(CLOCK_PROBES);
    expect(h.conn.getSnapshot().clock).not.toBeNull();
  });

  it('estimates the offset from the pong (2.5): server − midpoint', () => {
    const h = harness();
    h.conn.start();
    h.welcome();
    const ping = h.last().sent.find((m) => m.type === 'ping')!;
    expect(ping.t).toBe(1_000);
    h.advance(100);
    h.last().receive({ type: 'pong', t: 1_000, serverTime: 10_050 });
    expect(h.conn.getSnapshot().clock).toEqual({ offset: 10_050 - 1_050, rtt: 100 });
  });

  it('gives up on a socket with no welcome after the connect timeout, and retries', () => {
    const h = harness();
    h.conn.start();
    h.last().open();
    h.advance(CONNECT_TIMEOUT_MS - 1);
    expect(h.sockets).toHaveLength(1);
    h.advance(1);
    expect(h.sockets[0]!.closed).not.toBeNull();
    expect(h.conn.getSnapshot().status).toBe('waiting');
    h.advance(RECONNECT_FAST_CAP_MS);
    expect(h.sockets).toHaveLength(2);
  });

  it('waits longer for welcome on each attempt, so a slow link eventually connects', () => {
    expect([0, 1, 2, 3, 10].map(connectTimeout)).toEqual([5_000, 10_000, 15_000, 15_000, 15_000]);
    expect(connectTimeout(100)).toBe(CONNECT_TIMEOUT_MAX_MS);
    const h = harness();
    h.conn.start();
    // Every handshake on this link takes 8 s: longer than the first wait.
    const opened = new Map<FakeSocket, number>();
    for (let t = 0; t < 60_000 && h.conn.getSnapshot().status !== 'open'; t += 100) {
      const s = h.last();
      if (!opened.has(s)) opened.set(s, t);
      if (s.closed === null && t - opened.get(s)! >= 8_000) h.welcome(s);
      h.advance(100);
    }
    expect(h.conn.getSnapshot().status).toBe('open');
    expect(h.sockets.length).toBeGreaterThan(1); // the first, 5 s wait gave up
    expect(h.sockets[0]!.closed).not.toBeNull();
  });
});

describe('room connection: identity (stages 4.4, 4.5)', () => {
  it('joins without a token, stores the token from private, and rejoins with it after a drop', () => {
    const h = harness();
    h.conn.start();
    h.welcome();
    expect(h.last().types()).not.toContain('rejoin');
    h.last().receive({ type: 'state', state: lobbyState([]) });
    expect(h.conn.send({ type: 'join', name: 'Maya', color: 'red', icon: 'fedora' })).toBe(true);
    expect(h.conn.getSnapshot().identifying).toBe('join');
    h.last().receive(view('p1', 'tok-1'));
    expect(h.conn.getSnapshot()).toMatchObject({ you: { id: 'p1', token: 'tok-1' }, identifying: null });
    expect(h.tokens.get('ABCD')).toBe('tok-1');

    h.last().drop(1006);
    expect(h.conn.getSnapshot().status).toBe('waiting');
    // The identity and lobby stay on screen while reconnecting.
    expect(h.conn.getSnapshot().you?.id).toBe('p1');
    expect(h.conn.getSnapshot().state).not.toBeNull();
    h.advance(RECONNECT_FAST_CAP_MS);
    expect(h.sockets).toHaveLength(2);
    h.welcome();
    expect(h.last().sent).toContainEqual({ type: 'rejoin', token: 'tok-1' });
    expect(h.conn.getSnapshot().identifying).toBe('rejoin');
  });

  it('rejoins with a stored token on first connect (a reload)', () => {
    const h = harness({ token: 'saved' });
    h.conn.start();
    h.welcome();
    expect(h.last().sent).toContainEqual({ type: 'rejoin', token: 'saved' });
  });

  it('drops a token the room no longer knows and becomes a guest', () => {
    const h = harness({ token: 'stale' });
    h.conn.start();
    h.welcome();
    h.last().receive(err('unknown_token'));
    expect(h.tokens.get('ABCD')).toBeNull();
    expect(h.conn.getSnapshot()).toMatchObject({ you: null, identifying: null, error: { code: 'unknown_token' } });
  });

  it('stores the rotated token after "Rejoin as…" (0024 item 3)', () => {
    const h = harness({ token: 'old' });
    h.conn.start();
    h.welcome();
    h.last().receive(view('p2', 'rotated'));
    expect(h.tokens.get('ABCD')).toBe('rotated');
  });

  it('clears a refusal once a later identity step succeeds', () => {
    const h = harness();
    h.conn.start();
    h.welcome();
    h.conn.send({ type: 'join', name: 'A', color: 'red', icon: 'fedora' });
    h.last().receive(err('color_taken'));
    expect(h.conn.getSnapshot()).toMatchObject({ identifying: null, error: { code: 'color_taken', n: 1 } });
    h.last().receive(err('color_taken'));
    expect(h.conn.getSnapshot().error).toMatchObject({ code: 'color_taken', n: 2 });
    h.conn.send({ type: 'join', name: 'A', color: 'blue', icon: 'fedora' });
    expect(h.conn.getSnapshot().error).toBeNull();
    h.last().receive(view('p1', 't'));
    expect(h.conn.getSnapshot().error).toBeNull();
  });

  it('stays "resuming" while a held token waits for a socket, so the join form does not flash', () => {
    const h = harness({ token: 'saved' });
    h.conn.start();
    expect(h.conn.getSnapshot().resuming).toBe(true);
    h.welcome();
    h.last().receive({ type: 'state', state: lobbyState([player('p1')]) });
    h.last().drop(1006); // dropped between welcome and private
    expect(h.conn.getSnapshot()).toMatchObject({ status: 'waiting', you: null, resuming: true });
    h.advance(RECONNECT_FAST_CAP_MS);
    h.welcome();
    h.last().receive(view('p1', 'saved'));
    expect(h.conn.getSnapshot().resuming).toBe(false);
  });

  it('a stale token ends resuming and leaves a dated unknown_token for the join form', () => {
    const h = harness({ token: 'stale' });
    h.conn.start();
    h.welcome();
    h.advance(250);
    h.last().receive(err('unknown_token'));
    expect(h.conn.getSnapshot()).toMatchObject({ resuming: false, error: { code: 'unknown_token', at: 1_250 } });
    h.bounce();
    expect(h.conn.getSnapshot().resuming).toBe(false);
  });

  it('clears a refusal when the phase changes, and never reuses an error number', () => {
    const h = harness();
    h.conn.start();
    h.welcome();
    h.last().receive({ type: 'state', state: lobbyState([player('p1')]) });
    h.last().receive(err('not_enough_players'));
    expect(h.conn.getSnapshot().error?.n).toBe(1);
    h.last().receive({ type: 'state', state: lobbyState([player('p1')], { seq: 1 }) });
    expect(h.conn.getSnapshot().error?.n).toBe(1); // same phase: kept
    h.last().receive({ type: 'state', state: lobbyState([player('p1')], { phase: { name: 'dealing' } }) });
    expect(h.conn.getSnapshot().error).toBeNull();
    h.last().receive(err('wrong_phase'));
    expect(h.conn.getSnapshot().error?.n).toBe(2);
  });

  it('prunes day-old tokens of other rooms on start', () => {
    const h = harness();
    h.tokens.set('OLDD', 'x');
    h.setClock(1_000 + TOKEN_MAX_AGE_MS + 1);
    h.conn.start();
    expect(h.storage.map.has(tokenKey('OLDD'))).toBe(false);
  });
});

describe('room connection: mid-round "Rejoin as…" (0024)', () => {
  function pendingHarness() {
    const h = harness();
    h.conn.start();
    h.welcome();
    h.conn.send({ type: 'rejoinAs', playerId: 'p2' });
    h.last().receive({ type: 'rejoin', playerId: 'p2', status: 'pending' });
    return h;
  }

  it('shows the pending request and asks again after a reconnect', () => {
    const h = pendingHarness();
    expect(h.conn.getSnapshot()).toMatchObject({ identifying: null, rejoinNotice: { playerId: 'p2', status: 'pending' } });
    h.bounce();
    h.welcome();
    expect(h.last().sent).toContainEqual({ type: 'rejoinAs', playerId: 'p2' });
    expect(h.conn.getSnapshot().rejoinNotice?.status).toBe('pending');
    h.last().receive({ type: 'rejoin', playerId: 'p2', status: 'declined' });
    expect(h.conn.getSnapshot().rejoinNotice?.status).toBe('declined');
    h.bounce();
    h.welcome();
    expect(h.last().types()).not.toContain('rejoinAs');
  });

  it('a re-sent request that meets its own old one (rejoin_pending) keeps asking for a while', () => {
    const h = pendingHarness();
    h.bounce();
    h.welcome();
    const asks = () => h.last().sent.filter((m) => m.type === 'rejoinAs').length;
    for (let i = 0; i < REJOIN_RETRIES; i++) {
      h.last().receive(err('rejoin_pending'));
      expect(h.conn.getSnapshot(), String(i)).toMatchObject({ error: null, rejoinNotice: { status: 'pending' } });
      const before = asks();
      h.advance(REJOIN_RETRY_MS);
      expect(asks()).toBe(before + 1);
    }
    expect(REJOIN_RETRIES * REJOIN_RETRY_MS).toBeGreaterThanOrEqual(15_000);
    // Still refused after that: someone else holds the request.
    h.last().receive(err('rejoin_pending'));
    expect(h.conn.getSnapshot()).toMatchObject({ error: { code: 'rejoin_pending' }, rejoinNotice: null });
  });

  it('a retry timer from a lost socket does not fire on the next one (probe A)', () => {
    const h = pendingHarness();
    h.bounce();
    h.welcome();
    h.last().receive(err('rejoin_pending')); // retry armed
    h.last().drop(1006);
    h.advance(RECONNECT_FAST_CAP_MS);
    h.welcome();
    const s = h.last();
    const asks = () => s.sent.filter((m) => m.type === 'rejoinAs').length;
    expect(asks()).toBe(1); // identify() asked once
    h.advance(REJOIN_RETRY_MS);
    expect(asks()).toBe(1); // the old timer did not ask again
    // The new socket has its own retry budget.
    s.receive(err('rejoin_pending'));
    expect(h.conn.getSnapshot()).toMatchObject({ error: null, rejoinNotice: { status: 'pending' } });
  });

  it('a new choice cancels the retry of the old one (probe B)', () => {
    const h = pendingHarness();
    h.bounce();
    h.welcome();
    h.last().receive(err('rejoin_pending'));
    h.conn.send({ type: 'rejoinAs', playerId: 'p3' });
    h.advance(REJOIN_RETRY_MS * 2);
    expect(h.last().sent.filter((m) => m.type === 'rejoinAs')).toEqual([
      { type: 'rejoinAs', playerId: 'p2' },
      { type: 'rejoinAs', playerId: 'p3' },
    ]);
  });

  it('a first-hand rejoin_pending is reported at once', () => {
    const h = harness();
    h.conn.start();
    h.welcome();
    h.conn.send({ type: 'rejoinAs', playerId: 'p2' });
    h.last().receive(err('rejoin_pending'));
    expect(h.conn.getSnapshot().error?.code).toBe('rejoin_pending');
  });

  it('cancelling reconnects as a fresh socket that does not ask again', () => {
    const h = pendingHarness();
    h.conn.cancelRejoinAs();
    expect(h.sockets[0]!.closed).not.toBeNull();
    expect(h.sockets).toHaveLength(2);
    expect(h.conn.getSnapshot().rejoinNotice).toBeNull();
    h.welcome();
    expect(h.last().types()).not.toContain('rejoinAs');
  });
});

describe('room connection: reconnect policy (stages 4.3, 4.4)', () => {
  it('retries quickly at first, then backs off further, and resets after a welcome', () => {
    const h = harness();
    h.conn.start();
    h.welcome();
    h.last().drop(1006);
    const retries: number[] = [];
    while (h.sockets.length < 12) {
      retries.push(h.delays.at(-1)!);
      h.advance(h.delays.at(-1)!);
      h.last().drop(1006);
    }
    // Within the fast window no retry waits longer than the fast cap…
    expect(retries.slice(0, 4).every((d) => d <= RECONNECT_FAST_CAP_MS)).toBe(true);
    // …and later ones do.
    expect(Math.max(...retries)).toBeGreaterThan(RECONNECT_FAST_CAP_MS);
    expect(retries.slice(0, 4).reduce((a, b) => a + b, 0)).toBeLessThan(RECONNECT_FAST_WINDOW_MS);
    h.advance(h.delays.at(-1)!);
    h.welcome();
    h.last().drop(1006);
    expect(h.delays.at(-1)).toBe(retries[0]);
  });

  it('never reads failed connections as no room, and never drops the token for them', () => {
    const h = harness({ token: 't' });
    h.conn.start();
    for (let i = 0; i < 20; i++) {
      h.last().drop(1006);
      expect(h.conn.getSnapshot().status).toBe('waiting');
      h.advance(20_000);
    }
    expect(h.tokens.get('ABCD')).toBe('t');
  });

  it('leaves for the landing on an explicit no_room, by error or close code, and forgets the token', () => {
    for (const how of ['error', 'close'] as const) {
      const h = harness({ token: 'gone' });
      h.conn.start();
      h.last().open();
      if (how === 'error') h.last().receive(err('no_room'));
      else h.last().drop(CLOSE_NO_ROOM);
      expect(h.conn.getSnapshot().status, how).toBe('no_room');
      expect(h.tokens.get('ABCD'), how).toBeNull();
      expect(h.pending(), how).toBe(0);
    }
  });

  it('does not reconnect after replaced, until the player takes over', () => {
    const h = harness();
    h.conn.start();
    h.welcome();
    h.last().receive(err('replaced'));
    expect(h.conn.getSnapshot().status).toBe('replaced');
    h.last().drop(CLOSE_REPLACED);
    expect(h.pending()).toBe(0);
    h.conn.nudge();
    expect(h.sockets).toHaveLength(1);
    h.conn.takeOver();
    expect(h.sockets).toHaveLength(2);
  });

  it('treats the replaced close code alone as terminal too', () => {
    const h = harness();
    h.conn.start();
    h.welcome();
    h.last().drop(CLOSE_REPLACED);
    expect(h.conn.getSnapshot().status).toBe('replaced');
    expect(h.pending()).toBe(0);
  });

  it('stops on a version mismatch and keeps the token for the reload', () => {
    const h = harness({ token: 'keep' });
    h.conn.start();
    h.last().open();
    h.last().receive(err('version'));
    h.last().drop(CLOSE_VERSION_MISMATCH);
    expect(h.conn.getSnapshot().status).toBe('version');
    expect(h.tokens.get('ABCD')).toBe('keep');
    expect(h.pending()).toBe(0);
  });

  it('nudge: a waiting retry goes now', () => {
    const h = harness();
    h.conn.start();
    h.welcome();
    h.last().drop(1006);
    h.conn.nudge();
    expect(h.sockets).toHaveLength(2);
  });

  it('nudge: a socket connecting for a while is replaced, a fresh one is left alone', () => {
    const h = harness();
    h.conn.start();
    h.advance(NUDGE_STALE_MS - 1);
    h.conn.nudge();
    expect(h.sockets).toHaveLength(1);
    h.advance(1);
    h.conn.nudge();
    expect(h.sockets).toHaveLength(2);
    expect(h.sockets[0]!.closed).not.toBeNull();
  });

  it('nudge: an open socket is probed; a pong keeps it, silence replaces it', () => {
    const h = harness();
    h.conn.start();
    h.welcome();
    const pings = () => h.last().sent.filter((m) => m.type === 'ping').length;
    const before = pings();
    h.conn.nudge();
    expect(pings()).toBe(before + 1);
    h.last().receive({ type: 'pong', t: 0, serverTime: 0 });
    h.advance(WAKE_PROBE_MS);
    expect(h.sockets).toHaveLength(1);

    h.conn.nudge();
    h.advance(WAKE_PROBE_MS);
    expect(h.sockets).toHaveLength(2);
    expect(h.sockets[0]!.closed).not.toBeNull();
  });

  it('refuses to send while not open, and stop() closes without retrying', () => {
    const h = harness();
    h.conn.start();
    expect(h.conn.send({ type: 'host:start' })).toBe(false);
    h.welcome();
    h.conn.stop();
    expect(h.last().closed).toBe(1000);
    expect(h.pending()).toBe(0);
  });

  it('ignores events from a socket it has replaced', () => {
    const h = harness();
    h.conn.start();
    const first = h.last();
    h.welcome(first);
    first.drop(1006);
    h.conn.nudge();
    first.receive({ type: 'state', state: lobbyState([player('ghost')]) });
    expect(h.conn.getSnapshot().state).toBeNull();
  });
});
