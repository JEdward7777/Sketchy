import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, parseClientMessage } from '../../src/shared/protocol';

describe('parseClientMessage', () => {
  it('reads hello and ping', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION }))).toEqual({
      type: 'hello',
      v: PROTOCOL_VERSION,
    });
    expect(parseClientMessage('{"type":"ping","t":12.5}')).toEqual({ type: 'ping', t: 12.5 });
  });

  it('rejects malformed frames rather than trusting them', () => {
    for (const raw of ['', 'nope', 'null', '[]', '{"type":"hello"}', '{"type":"hello","v":"1"}', '{"type":"x"}']) {
      expect(parseClientMessage(raw), raw).toBeNull();
    }
    expect(parseClientMessage(new ArrayBuffer(4))).toBeNull();
  });
});
