/**
 * The player token, kept in `localStorage` per room code (`SPEC.md` §7,
 * stage 4.4). A reload, sleep or Wi-Fi drop then reconnects as the same
 * player with `rejoin {token}`.
 *
 * Each entry records when it was last written, and tokens for *other*
 * rooms untouched for `TOKEN_MAX_AGE_MS` are pruned, so a phone that plays
 * many evenings does not collect dead tokens. Rooms expire after
 * `ROOM_EXPIRY_MS` (2 h) of inactivity, and an active game rewrites its
 * token on every `private`, so a day-old token is for a room long gone.
 *
 * Storage is injected so the unit leg can use a map. Every access is
 * guarded: private browsing and full quotas make `localStorage` throw, and
 * the game must still work, only without surviving a reload.
 */

export interface KeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'sketchy:token:';
export const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Codes are case-insensitive (protocol.md "Transport"), so keys use the upper-case code. */
export function tokenKey(code: string): string {
  return PREFIX + code.trim().toUpperCase();
}

interface Entry {
  readonly token: string;
  /** Client epoch ms of the last write. */
  readonly at: number;
}

function readEntry(raw: string | null): Entry | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Entry>;
    if (typeof v.token === 'string' && v.token.length > 0 && typeof v.at === 'number') return { token: v.token, at: v.at };
  } catch {
    // Not ours, or corrupted: treated as absent.
  }
  return null;
}

export interface TokenStore {
  get(code: string): string | null;
  set(code: string, token: string): void;
  clear(code: string): void;
  /** Remove tokens for rooms other than `keepCode` last written more than `TOKEN_MAX_AGE_MS` ago. */
  prune(keepCode: string): void;
}

export function tokenStore(storage: KeyValueStorage | null, now: () => number = Date.now): TokenStore {
  return {
    get(code) {
      try {
        return readEntry(storage?.getItem(tokenKey(code)) ?? null)?.token ?? null;
      } catch {
        return null;
      }
    },
    set(code, token) {
      try {
        storage?.setItem(tokenKey(code), JSON.stringify({ token, at: now() } satisfies Entry));
      } catch {
        // Not persisted; the session still works until the page is closed.
      }
    },
    clear(code) {
      try {
        storage?.removeItem(tokenKey(code));
      } catch {
        // Nothing to clear if storage is unavailable.
      }
    },
    prune(keepCode) {
      try {
        if (!storage) return;
        const keep = tokenKey(keepCode);
        const stale: string[] = [];
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (!key || !key.startsWith(PREFIX) || key === keep) continue;
          const entry = readEntry(storage.getItem(key));
          if (!entry || now() - entry.at > TOKEN_MAX_AGE_MS) stale.push(key);
        }
        for (const key of stale) storage.removeItem(key);
      } catch {
        // Best effort.
      }
    },
  };
}

/** `window.localStorage`, or null where reading it throws (some private modes). */
export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
