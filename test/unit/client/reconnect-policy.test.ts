import { describe, expect, it } from 'vitest';
import {
  RECONNECT_BASE_MS,
  RECONNECT_FAST_CAP_MS,
  RECONNECT_FAST_WINDOW_MS,
  RECONNECT_MAX_MS,
  reconnectDelay,
  terminalForClose,
  terminalForError,
} from '../../../src/client/net/reconnect-policy';
import { CLOSE_NO_ROOM, CLOSE_REPLACED, CLOSE_VERSION_MISMATCH } from '../../../src/shared/protocol';
import { BLIP_GRACE_MS } from '../../../src/shared/core/rules';

const top = () => 0.999; // jitter factor 0.5 + 0.5 × 0.999
const J = 0.5 + 0.5 * 0.999;

describe('reconnect policy (stages 4.3, 4.4)', () => {
  it('doubles from the base up to the low cap while the drop is recent', () => {
    for (const attempt of [0, 1, 2, 3, 4, 10, 100]) {
      const expected = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_FAST_CAP_MS);
      expect(reconnectDelay(attempt, 0, top), String(attempt)).toBe(Math.round(expected * J));
      expect(reconnectDelay(attempt, RECONNECT_FAST_WINDOW_MS - 1, top)).toBe(Math.round(expected * J));
    }
  });

  it('backs off further once the outage outlasts the fast window', () => {
    for (const attempt of [0, 1, 2, 3, 4, 5, 10, 100]) {
      const expected = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
      expect(reconnectDelay(attempt, RECONNECT_FAST_WINDOW_MS, top), String(attempt)).toBe(Math.round(expected * J));
    }
    expect(reconnectDelay(100, 60_000, top)).toBeGreaterThan(reconnectDelay(100, 0, top));
  });

  it('jitters into [0.5, 1) of the capped delay, whatever the random source returns', () => {
    for (const r of [0, 0.25, 0.5, 0.99, -3, 7, Number.NaN]) {
      const d = reconnectDelay(3, 0, () => r);
      const capped = Math.min(RECONNECT_BASE_MS * 2 ** 3, RECONNECT_FAST_CAP_MS);
      expect(d).toBeGreaterThanOrEqual(capped * 0.5);
      expect(d).toBeLessThan(capped);
    }
  });

  it('treats negative or fractional attempts as their floor at 0', () => {
    expect(reconnectDelay(-5, 0, () => 0)).toBe(reconnectDelay(0, 0, () => 0));
    expect(reconnectDelay(2.7, 0, () => 0)).toBe(reconnectDelay(2, 0, () => 0));
  });

  it('keeps early retries well inside the blip grace, so a short drop stays invisible', () => {
    expect(RECONNECT_FAST_CAP_MS).toBeLessThan(BLIP_GRACE_MS / 2);
    expect(RECONNECT_FAST_WINDOW_MS).toBeGreaterThan(BLIP_GRACE_MS);
  });

  it('stops for replaced, no_room and version, by error or close code', () => {
    expect(terminalForError('replaced')).toBe('replaced');
    expect(terminalForError('no_room')).toBe('no_room');
    expect(terminalForError('version')).toBe('version');
    expect(terminalForError('color_taken')).toBeNull();
    expect(terminalForError('bad_message')).toBeNull();
    expect(terminalForClose(CLOSE_REPLACED)).toBe('replaced');
    expect(terminalForClose(CLOSE_NO_ROOM)).toBe('no_room');
    expect(terminalForClose(CLOSE_VERSION_MISMATCH)).toBe('version');
    for (const code of [1000, 1001, 1006, 1011, 4999]) expect(terminalForClose(code), String(code)).toBeNull();
  });
});
