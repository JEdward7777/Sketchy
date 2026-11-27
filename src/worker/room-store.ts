/**
 * `RoomDO`'s SQLite storage (`SPEC.md` §14 "State to persist").
 *
 * - `room`: one row holding the whole reducer state as JSON (it is plain
 *   JSON by design, `src/shared/core/state.ts`) and the adapter's pending
 *   deal, so one handled message writes one row (`reference/budget.md`:
 *   rows written is the limit to design around).
 * - `drawings`: one row per stored drawing of the current round (decision
 *   0009; delivery is stage 6.5). Strokes are bound as a parameter, never
 *   inlined in SQL text (budget.md: statements are capped at 100 KB).
 *
 * Every value goes in as a bound parameter.
 */

import type { Difficulty } from '../shared/difficulty-bag';
import type { RoomState } from '../shared/core';

/**
 * A `dealWord` effect the adapter has not yet answered (observation O-07:
 * `dealing` has no deadline, so the adapter retries). `retryAt` is one of
 * the instants the one alarm multiplexes.
 */
export interface PendingDeal {
  readonly roundNo: number;
  readonly difficulty: Difficulty;
  readonly exclude: readonly string[];
  /** Asks for this round so far without a usable word (failures and used words); sets the backoff. */
  readonly attempts: number;
  readonly retryAt: number;
}

export interface Stored {
  readonly state: RoomState;
  readonly deal: PendingDeal | null;
}

interface RoomRow {
  state: string;
  deal: string | null;
  [key: string]: SqlStorageValue;
}

export class RoomStore {
  /**
   * The tables exist. In memory only to skip a statement per event;
   * `clear()` resets it, because `deleteAll` drops the tables with the data.
   */
  private ready = false;

  constructor(private readonly storage: DurableObjectStorage) {}

  private ensure(): void {
    if (this.ready) return;
    const sql = this.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL, deal TEXT)`);
    sql.exec(
      `CREATE TABLE IF NOT EXISTS drawings (key TEXT PRIMARY KEY, round_no INTEGER NOT NULL, strokes TEXT NOT NULL)`,
    );
    this.ready = true;
  }

  /**
   * The room, or null when it was never created or has expired. Reading
   * never creates the tables, so an expired room stays empty however many
   * late socket events reach it.
   */
  load(): Stored | null {
    if (!this.ready) {
      const has = [...this.storage.sql.exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'room'`)];
      if (has.length === 0) return null;
      this.ensure();
    }
    const rows = [...this.storage.sql.exec<RoomRow>(`SELECT state, deal FROM room WHERE id = 1`)];
    const row = rows[0];
    if (!row) return null;
    return { state: JSON.parse(row.state) as RoomState, deal: row.deal === null ? null : (JSON.parse(row.deal) as PendingDeal) };
  }

  save(stored: Stored): void {
    this.ensure();
    this.storage.sql.exec(
      `INSERT INTO room (id, state, deal) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET state = excluded.state, deal = excluded.deal`,
      JSON.stringify(stored.state),
      stored.deal === null ? null : JSON.stringify(stored.deal),
    );
  }

  storeDrawing(key: string, roundNo: number, strokes: unknown): void {
    this.ensure();
    this.storage.sql.exec(
      `INSERT INTO drawings (key, round_no, strokes) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET strokes = excluded.strokes`,
      key,
      roundNo,
      JSON.stringify(strokes),
    );
  }

  clearDrawings(roundNo: number): void {
    this.ensure();
    this.storage.sql.exec(`DELETE FROM drawings WHERE round_no = ?`, roundNo);
  }

  /** Whether the room exists, without reading its state (a cheap check before accepting a socket). */
  exists(): boolean {
    if (this.ready) return [...this.storage.sql.exec(`SELECT 1 FROM room WHERE id = 1`)].length > 0;
    return this.load() !== null;
  }

  /** Run `f` as one SQLite transaction: every write in it lands, or none does. */
  transaction<T>(f: () => T): T {
    this.ensure();
    return this.storage.transactionSync(f);
  }

  /** Room expiry (§14): every row and table, and the alarm, gone; the code is free again (0007 item 1). */
  async clear(): Promise<void> {
    await this.storage.deleteAlarm();
    await this.storage.deleteAll();
    this.ready = false;
  }
}
