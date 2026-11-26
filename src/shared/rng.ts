/**
 * The game's seeded random number generator (stage 2.1).
 *
 * Every random choice the room makes — the faker (decision 0020), the
 * slideshow order (0007 item 2), the Mixed-difficulty bag (0007 item 3), room
 * codes (§14) — goes through these functions. The state is one plain object
 * holding a 32-bit integer, so it can sit in the reducer state (3.2), be
 * written to Durable Object storage, and survive hibernation: nothing lives
 * in a closure.
 *
 * Every function is pure: it takes a state and returns the value together
 * with the next state, and never mutates its input. Feeding the same state
 * in twice gives the same value twice.
 *
 * The generator is mulberry32 (the same algorithm the phase-1 test helper
 * and `scripts/measure-strokes.mjs` use). Its state is the whole 32-bit
 * counter, so it repeats only after 2^32 draws. It is not cryptographic;
 * the state must never reach a client (decision 0020 item 5).
 */

/** Serializable RNG state: `s` is an unsigned 32-bit integer. */
export interface RngState {
  readonly s: number;
}

/** A value drawn from the RNG, with the state to use for the next draw. */
export interface Drawn<T> {
  readonly value: T;
  readonly state: RngState;
}

const UINT32 = 2 ** 32;

/**
 * A fresh state from a seed. Any integer is accepted and reduced modulo
 * 2^32, so a seed from `crypto.getRandomValues(new Uint32Array(1))[0]` maps
 * to itself.
 */
export function rngFromSeed(seed: number): RngState {
  if (!Number.isInteger(seed)) throw new RangeError(`RNG seed must be an integer, got ${seed}`);
  return { s: (((seed % UINT32) + UINT32) % UINT32) >>> 0 };
}

/** True when `value` is a well-formed `RngState` (e.g. read back from storage). */
export function isRngState(value: unknown): value is RngState {
  if (typeof value !== 'object' || value === null) return false;
  const s = (value as { s?: unknown }).s;
  return typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < UINT32;
}

/** A uniform float in [0, 1). */
export function rngNext(state: RngState): Drawn<number> {
  const a = (state.s + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / UINT32, state: { s: a } };
}

/** A uniform integer in [0, n). `n` must be a positive integer. */
export function rngInt(state: RngState, n: number): Drawn<number> {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError(`rngInt needs a positive integer, got ${n}`);
  const r = rngNext(state);
  return { value: Math.floor(r.value * n), state: r.state };
}

/** One element chosen uniformly from a non-empty list. */
export function rngPick<T>(state: RngState, items: readonly T[]): Drawn<T> {
  if (items.length === 0) throw new RangeError('rngPick from an empty list');
  const r = rngInt(state, items.length);
  return { value: items[r.value]!, state: r.state };
}

/**
 * A shuffled copy of `items` (Fisher–Yates); the input is not touched.
 * Uses exactly `items.length - 1` draws (none for 0 or 1 items).
 */
export function shuffle<T>(state: RngState, items: readonly T[]): Drawn<T[]> {
  const out = items.slice();
  let st = state;
  for (let i = out.length - 1; i > 0; i--) {
    const r = rngInt(st, i + 1);
    st = r.state;
    const j = r.value;
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return { value: out, state: st };
}

/**
 * murmur3's 32-bit finalizer (fmix32): a bijection on uint32 with full
 * avalanche, so every input bit flips about half the output bits.
 */
export function mix32(h: number): number {
  let x = h >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * Fold 32 fresh bits of outside entropy into a state: `mix32(s ^ entropy)`.
 * A state that has absorbed bits an observer never saw cannot be
 * recovered from earlier outputs, however many were published.
 */
export function rngAbsorb(state: RngState, entropy: number): RngState {
  if (!Number.isInteger(entropy) || entropy < 0 || entropy >= UINT32) {
    throw new RangeError(`entropy must be an unsigned 32-bit integer, got ${entropy}`);
  }
  return { s: mix32((state.s ^ entropy) >>> 0) };
}
