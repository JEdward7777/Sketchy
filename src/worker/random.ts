/**
 * Every random value the Worker and `RoomDO` make, from Web Crypto's CSPRNG.
 *
 * The room's own generators (`src/shared/rng.ts`) are not cryptographic, so
 * nothing a client must not predict comes from them alone: the per-call
 * entropy and both room seeds (observation O-10, protocol.md "Reducer
 * contract"), player tokens (0020 item 5), connection ids and the global
 * deck's shuffles (`DeckDO`, phase 5, via `randomBelow`) come from here.
 */

import { generateRoomCode } from '../shared/room-code';
import { rngFromSeed } from '../shared/rng';

/** One fresh unsigned 32-bit value. */
export function randomU32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/**
 * A uniform integer in `[0, n)` for `1 ≤ n ≤ 2^32`, without modulo bias:
 * draws at or above the largest multiple of `n` below `2^32` are rejected
 * and drawn again (fewer than half the draws in the worst case).
 */
export function randomBelow(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError(`randomBelow needs 1 ≤ n ≤ 2^32, got ${n}`);
  const limit = Math.floor(2 ** 32 / n) * n;
  for (;;) {
    const u = randomU32();
    if (u < limit) return u % n;
  }
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** A player token: 128 random bits, base64url (22 characters). */
export function mintToken(): string {
  let bin = '';
  for (const b of randomBytes(16)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A socket's id inside one room: 64 random bits, hex. Never sent to clients. */
export function mintConnId(): string {
  return [...randomBytes(8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A room code (stage 2.6). Codes are public, so a 32-bit CSPRNG seed for the
 * shared generator is enough; the point is only that codes are not
 * sequential.
 */
export function randomRoomCode(): string {
  return generateRoomCode(rngFromSeed(randomU32())).value;
}
