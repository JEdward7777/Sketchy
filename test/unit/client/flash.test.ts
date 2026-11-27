import { describe, expect, it } from 'vitest';
import { FLASH_MS, flashRemaining, seenAtMount } from '../../../src/client/screens/flash';

describe('which refusals a screen shows', () => {
  it('a screen shows an error that arrived just before it mounted (the stale-token notice)', () => {
    const error = { code: 'unknown_token' as const, n: 4, at: 1_000 };
    expect(seenAtMount(error, 1_000 + FLASH_MS - 1)).toBe(3); // n = 4 is still unseen
    expect(flashRemaining(error, 1_500)).toBe(FLASH_MS - 500);
  });

  it('older errors stay hidden', () => {
    const error = { code: 'color_taken' as const, n: 4, at: 1_000 };
    expect(seenAtMount(error, 1_000 + FLASH_MS)).toBe(4);
    expect(flashRemaining(error, 1_000 + FLASH_MS)).toBe(0);
    expect(seenAtMount(null, 0)).toBe(0);
  });
});
