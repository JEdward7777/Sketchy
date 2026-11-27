import { describe, expect, it } from 'vitest';
import { DEAL_RETRY_MAX_MS, DEAL_RETRY_MS, MAX_DEALS_PER_EVENT, dealBackoff, describeError } from '../../src/worker/room-policy';

describe('RoomDO policy (unit 4a review)', () => {
  it('deal retries double from DEAL_RETRY_MS and stop at DEAL_RETRY_MAX_MS', () => {
    expect([0, 1, 2, 3].map(dealBackoff)).toEqual([1, 2, 4, 8].map((k) => k * DEAL_RETRY_MS));
    expect(dealBackoff(20)).toBe(DEAL_RETRY_MAX_MS);
    expect(dealBackoff(10_000)).toBe(DEAL_RETRY_MAX_MS);
    // budget.md's row cost for a stuck deal assumes at most 2 source calls per event.
    expect(MAX_DEALS_PER_EVENT).toBeLessThanOrEqual(2);
  });

  it('never logs a SyntaxError message, which can quote stored JSON', () => {
    let err: unknown;
    try {
      JSON.parse('{"word":"zeppelinwhisker",');
    } catch (e) {
      err = e;
    }
    expect(describeError(err)).toBe('SyntaxError (message withheld)');
    expect(describeError(new Error('intent from unknown player p3'))).toBe('Error: intent from unknown player p3');
    expect(describeError('x')).toBe('unknown error');
  });
});
