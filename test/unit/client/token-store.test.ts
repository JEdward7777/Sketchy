import { describe, expect, it } from 'vitest';
import { TOKEN_MAX_AGE_MS, tokenKey, tokenStore, type KeyValueStorage } from '../../../src/client/net/token-store';
import { mapStorage } from './fixtures';

const throwing: KeyValueStorage = {
  get length(): number {
    throw new Error('SecurityError');
  },
  key: () => {
    throw new Error('SecurityError');
  },
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('token store (stage 4.4)', () => {
  it('keeps one token per room code, case-insensitively', () => {
    const storage = mapStorage();
    const tokens = tokenStore(storage, () => 5);
    tokens.set('abcd', 't1');
    tokens.set('WXYZ', 't2');
    expect(tokens.get('ABCD')).toBe('t1');
    expect(tokens.get(' abcd ')).toBe('t1');
    expect(tokens.get('wxyz')).toBe('t2');
    expect(JSON.parse(storage.map.get(tokenKey('abcd'))!)).toEqual({ token: 't1', at: 5 });
  });

  it('overwrites on rotation and clears one room only', () => {
    const tokens = tokenStore(mapStorage());
    tokens.set('ABCD', 'old');
    tokens.set('ABCD', 'new');
    tokens.set('WXYZ', 'other');
    expect(tokens.get('ABCD')).toBe('new');
    tokens.clear('abcd');
    expect(tokens.get('ABCD')).toBeNull();
    expect(tokens.get('WXYZ')).toBe('other');
  });

  it('treats empty or unreadable entries as no token', () => {
    const storage = mapStorage();
    storage.map.set(tokenKey('ABCD'), '');
    storage.map.set(tokenKey('WXYZ'), 'not json');
    storage.map.set(tokenKey('EFGH'), JSON.stringify({ token: '', at: 1 }));
    const tokens = tokenStore(storage);
    for (const c of ['ABCD', 'WXYZ', 'EFGH']) expect(tokens.get(c)).toBeNull();
  });

  it('prunes other rooms older than a day, keeps the current room and other keys', () => {
    const storage = mapStorage();
    let now = 0;
    const tokens = tokenStore(storage, () => now);
    tokens.set('OLDD', 'a'); // at 0
    tokens.set('KEEP', 'b'); // the current room, also at 0
    now = TOKEN_MAX_AGE_MS;
    tokens.set('NEWW', 'c');
    storage.map.set(tokenKey('JUNK'), 'garbage');
    storage.map.set('other-app', 'x');
    now = TOKEN_MAX_AGE_MS + 1;
    tokens.prune('keep');
    expect(tokens.get('OLDD')).toBeNull();
    expect(storage.map.has(tokenKey('JUNK'))).toBe(false);
    expect(tokens.get('KEEP')).toBe('b');
    expect(tokens.get('NEWW')).toBe('c');
    expect(storage.map.get('other-app')).toBe('x');
  });

  it('never throws when storage is missing or refuses', () => {
    for (const tokens of [tokenStore(null), tokenStore(throwing)]) {
      expect(() => tokens.set('ABCD', 't')).not.toThrow();
      expect(tokens.get('ABCD')).toBeNull();
      expect(() => tokens.clear('ABCD')).not.toThrow();
      expect(() => tokens.prune('ABCD')).not.toThrow();
    }
  });
});
