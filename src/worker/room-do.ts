import { DurableObject } from 'cloudflare:workers';
import { partitionDue } from '../shared/deadlines';
import {
  CLOSE_VERSION_MISMATCH,
  PROTOCOL_VERSION,
  parseClientMessage,
  type ServerMessage,
} from '../shared/protocol';
import { armAlarm } from './alarm';
import { now } from './clock';

/** Per-socket facts that must survive hibernation, kept in the attachment. */
interface SocketAttachment {
  helloed: boolean;
  /** Set before the room closes the socket; later frames are ignored. */
  closed?: boolean;
}

interface DeadlineRow {
  name: string;
  due_at: number;
  [key: string]: SqlStorageValue;
}

/**
 * One room (`SPEC.md` §13). Phase 1 shell: sockets, the handshake and the
 * one-alarm multiplexer. The game itself arrives as a pure reducer (phase 3)
 * that this class adapts to storage, sockets and the alarm.
 *
 * Hibernation rules (harness/AGENTS.md §5): sockets are accepted with
 * `ctx.acceptWebSocket()` only, nothing about time is kept in memory and there
 * is no `setTimeout`. Deadlines are absolute epoch ms in SQLite, and "now"
 * comes from `./clock` so the DO leg can fire a deadline at its own instant.
 */
export class RoomDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Phase-1 stand-in for the deadlines phase 4 derives from game state with
    // `nextDeadline(state)`; it gives the multiplexer something real to arm.
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS deadlines (name TEXT PRIMARY KEY, due_at INTEGER NOT NULL)`,
    );
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // The hibernation API: the runtime holds the socket and may evict this
    // object between messages. Never `server.accept()`.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ helloed: false } satisfies SocketAttachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    // Frames the client sent before it saw our close still arrive here.
    if (attachment?.closed) return;
    const msg = parseClientMessage(raw);
    if (!msg) {
      send(ws, { type: 'error', code: 'bad_message', message: 'unreadable message' });
      return;
    }

    if (msg.type === 'hello') {
      if (msg.v !== PROTOCOL_VERSION) {
        // Decision 0007 item 8: say why, then hang up; the client reloads.
        ws.serializeAttachment({ helloed: false, closed: true } satisfies SocketAttachment);
        send(ws, {
          type: 'error',
          code: 'version',
          message: `server speaks protocol ${PROTOCOL_VERSION}`,
        });
        ws.close(CLOSE_VERSION_MISMATCH, 'version');
        return;
      }
      ws.serializeAttachment({ helloed: true } satisfies SocketAttachment);
      send(ws, { type: 'welcome', v: PROTOCOL_VERSION, serverTime: now() });
      return;
    }

    if (!attachment?.helloed) {
      send(ws, { type: 'error', code: 'hello_first', message: 'send hello first' });
      return;
    }

    switch (msg.type) {
      case 'ping':
        send(ws, { type: 'pong', t: msg.t, serverTime: now() });
        return;
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed (the runtime may have answered the close itself).
    }
  }

  /** Fire every deadline due at `now()`, then re-arm for the rest. */
  override async alarm(): Promise<void> {
    const rows = this.storedDeadlines();
    const { due, pending } = partitionDue(
      rows.map((r) => ({ name: r.name, dueAt: r.due_at })),
      now(),
    );
    for (const d of due) {
      this.ctx.storage.sql.exec(`DELETE FROM deadlines WHERE name = ?`, d.name);
    }
    await armAlarm(this.ctx.storage, pending.map((d) => d.dueAt));
  }

  /**
   * Replace the stored deadlines and re-arm. The phase-1 seam the DO leg uses
   * (via `runInDurableObject`) to show two deadlines fire in order from one
   * alarm; phase 4 replaces it with deadlines derived from game state.
   */
  async replaceDeadlines(deadlines: Record<string, number>): Promise<void> {
    this.ctx.storage.sql.exec(`DELETE FROM deadlines`);
    for (const [name, dueAt] of Object.entries(deadlines)) {
      this.ctx.storage.sql.exec(
        `INSERT INTO deadlines (name, due_at) VALUES (?, ?)`,
        name,
        Math.floor(dueAt),
      );
    }
    await armAlarm(this.ctx.storage, Object.values(deadlines).map(Math.floor));
  }

  storedDeadlines(): DeadlineRow[] {
    return [
      ...this.ctx.storage.sql.exec<DeadlineRow>(
        `SELECT name, due_at FROM deadlines ORDER BY due_at`,
      ),
    ];
  }
}

/**
 * Send, never throw: a socket can close between a frame arriving and the
 * reply, and an exception escaping a hibernation handler is only logged by
 * the runtime, so the failure would be invisible.
 */
function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Closed concurrently; nothing useful to do with the reply.
  }
}
