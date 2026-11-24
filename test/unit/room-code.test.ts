/**
 * Stage 2.6 — room codes: 4 letters, confusable characters excluded
 * (SPEC §14), upper case to match the Worker's upper-casing of `/ws/:code`.
 */
import { describe, expect, it } from 'vitest';
import { rngFromSeed } from '../../src/shared/rng';
import {
  generateRoomCode,
  parseRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_EXCLUDED,
  ROOM_CODE_LENGTH,
} from '../../src/shared/room-code';

describe('room codes (§14)', () => {
  it('the alphabet is upper-case letters minus the confusables', () => {
    expect(ROOM_CODE_LENGTH).toBe(4);
    expect(ROOM_CODE_ALPHABET).toMatch(/^[A-Z]+$/);
    expect(ROOM_CODE_ALPHABET.length).toBe(26 - ROOM_CODE_EXCLUDED.length);
    for (const c of ROOM_CODE_EXCLUDED) expect(ROOM_CODE_ALPHABET).not.toContain(c);
  });

  it('generated codes are 4 alphabet letters, deterministic per seed, and use the whole alphabet', () => {
    let st = rngFromSeed(1234);
    const seenLetters = new Set<string>();
    const seenCodes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const r = generateRoomCode(st);
      st = r.state;
      expect(r.value).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`));
      expect(parseRoomCode(r.value)).toBe(r.value);
      for (const c of r.value) seenLetters.add(c);
      seenCodes.add(r.value);
    }
    expect(seenLetters.size).toBe(ROOM_CODE_ALPHABET.length);
    expect(seenCodes.size).toBeGreaterThan(990); // 1000 draws from 20^4 codes rarely collide
    expect(generateRoomCode(rngFromSeed(5))).toEqual(generateRoomCode(rngFromSeed(5)));
  });

  it('parseRoomCode accepts lower case and spaces, rejects wrong length and excluded letters', () => {
    const code = generateRoomCode(rngFromSeed(9)).value;
    expect(parseRoomCode(` ${code.toLowerCase()} `)).toBe(code);
    for (const bad of ['', 'ABC', 'ABCDE', 'AB1D', 'ABOD', 'ABID', 'AB D']) {
      expect(parseRoomCode(bad), bad).toBeNull();
    }
  });
});
