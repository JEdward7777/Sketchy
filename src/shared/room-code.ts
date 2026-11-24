/**
 * Room codes (stage 2.6, `SPEC.md` §14): 4 letters, excluding confusable
 * characters. Codes are generated in upper case because the Worker
 * upper-cases the code in `/ws/:code` before naming the Durable Object
 * (src/worker/index.ts), so a typed `abcd` reaches room `ABCD`.
 *
 * Excluded letters, each mistakable for another character when read off a
 * phone or typed by hand:
 * - `I` and `L` — for `1` and for each other (`l` when typed in lower case);
 * - `O` and `Q` — for `0` and for each other;
 * - `U` and `V` — for each other.
 */

import { rngInt, type Drawn, type RngState } from './rng';

export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_EXCLUDED = 'ILOQUV';
export const ROOM_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  .split('')
  .filter((c) => !ROOM_CODE_EXCLUDED.includes(c))
  .join('');

/** A uniformly random code of `ROOM_CODE_LENGTH` letters from the alphabet. */
export function generateRoomCode(state: RngState): Drawn<string> {
  let code = '';
  let st = state;
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const r = rngInt(st, ROOM_CODE_ALPHABET.length);
    st = r.state;
    code += ROOM_CODE_ALPHABET[r.value];
  }
  return { value: code, state: st };
}

/**
 * The canonical form of a typed code (upper case, surrounding spaces
 * trimmed), or null when it is not a valid room code.
 */
export function parseRoomCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const c of code) if (!ROOM_CODE_ALPHABET.includes(c)) return null;
  return code;
}
