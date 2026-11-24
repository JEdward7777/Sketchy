import { describe, expect, it } from 'vitest';
import { FIELD_MAX_LENGTH, FRAME_MAX_BYTES, PROTOCOL_VERSION, parseClientMessage, utf8ByteLength } from '../../src/shared/protocol';

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

/** Stage 3.1: the game intents (SPEC §14 sketch, decisions 0004, 0007 item 8, 0009, 0010). */
describe('parseClientMessage: game intents', () => {
  const parse = (o: unknown) => parseClientMessage(JSON.stringify(o));

  it('reads every intent with its fields, dropping unknown extra fields', () => {
    const cases: unknown[] = [
      { type: 'join', name: 'Maya', color: 'red', icon: 'fedora' },
      { type: 'rejoin', token: 't' },
      { type: 'rejoinAs', playerId: 'p2' },
      { type: 'host:settings', settings: { difficulty: 'mixed', cycles: 2, timers: 'quick' } },
      { type: 'host:start' },
      { type: 'host:next', seq: 4 },
      { type: 'host:hold' },
      { type: 'host:narration', speaking: true },
      { type: 'host:remove', playerId: 'p3' },
      { type: 'host:end' },
      { type: 'host:claim' },
      { type: 'host:admit', playerId: 'p2', approve: true },
      { type: 'draw:done', strokes: [{ c: 1, s: 0, p: [1, 2] }] },
      { type: 'vote:set', targetId: 'p1' },
      { type: 'vote:lock' },
      { type: 'guess:submit', text: 'sock' },
      { type: 'guess:judge', accept: false },
    ];
    for (const c of cases) expect(parse(c), JSON.stringify(c)).toEqual(c);
    expect(parse({ type: 'host:start', extra: 'x' })).toEqual({ type: 'host:start' });
  });

  it('validates Custom timers with the 2.9 bounds (decision 0022)', () => {
    const custom = { drawMs: 5000, perSlideMs: 1000, voteMs: 5000, guessMs: 5000 };
    expect(parse({ type: 'host:settings', settings: { timers: 'custom', custom } })).toEqual({
      type: 'host:settings',
      settings: { timers: 'custom', custom },
    });
    expect(parse({ type: 'host:settings', settings: { custom: { ...custom, drawMs: 1 } } })).toBeNull();
  });

  it('rejects malformed intents', () => {
    const bad: unknown[] = [
      { type: 'join', name: 'Maya', color: 'red' },
      { type: 'join', name: 'x'.repeat(FIELD_MAX_LENGTH + 1), color: 'red', icon: 'fedora' },
      { type: 'rejoin', token: 5 },
      { type: 'host:next' },
      { type: 'host:next', seq: 1.5 },
      { type: 'host:narration', speaking: 'yes' },
      { type: 'host:settings', settings: { difficulty: 'hard' } },
      { type: 'host:settings', settings: { cycles: '2' } },
      { type: 'host:settings', settings: { timers: 'slow' } },
      { type: 'host:settings', settings: [] },
      { type: 'draw:done' },
      { type: 'guess:judge', accept: 1 },
      { type: 'host:admit', playerId: 'p2' },
    ];
    for (const b of bad) expect(parse(b), JSON.stringify(b)).toBeNull();
  });

  it('refuses a frame over FRAME_MAX_BYTES before parsing it (decision 0009 item 4)', () => {
    const head = '{"type":"draw:done","strokes":"';
    const fill = (n: number) => head + 'x'.repeat(n - head.length - 2) + '"}';
    expect(parseClientMessage(fill(FRAME_MAX_BYTES))).not.toBeNull();
    expect(parseClientMessage(fill(FRAME_MAX_BYTES + 1))).toBeNull();
  });

  it('counts UTF-8 bytes', () => {
    expect(utf8ByteLength('aé€😀')).toBe(1 + 2 + 3 + 4);
    expect(utf8ByteLength('\ud800')).toBe(3); // a lone surrogate encodes as U+FFFD
  });
});
