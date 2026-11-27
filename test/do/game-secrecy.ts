/**
 * Phase 7 frame-recording checks: phase 6's `assertRecordedSecrecy`
 * (round-helpers.ts) carried past unmask and over many rounds (`SPEC.md`
 * §14, harness/plan/07-server-loop-b.md "Verification").
 *
 * Phase 6 checked one round up to unmask with one fixed word and a fixed
 * faker per socket. Here every round has its own word and faker (0020), so
 * the rules are keyed by round number, with the truth supplied by the test
 * (the scripted deal for the word, the unmask `state` or the private roles
 * for the faker), never read from the frames under test.
 *
 * What a byte check cannot see: that nothing else in `state` depends on
 * the faker before unmask (e.g. an order or count that differs with who
 * the faker is). That is proven where it can be, in the core: the
 * counterfactual unit tests (test/unit/core/secrecy.test.ts,
 * secrecy-runs.test.ts, secrecy-reveal.test.ts) show `projectPublic` is
 * identical for states differing only in the word and the faker. The DO
 * leg checks the layering that carries it to the wire: every `state`
 * frame is exactly `projectPublic` of the stored state (game-full.test.ts,
 * "every `state` frame is exactly `projectPublic` …").
 */
import { expect } from 'vitest';
import type { PublicState, ServerMessage } from '../../src/shared/protocol';
import { type Socket } from './helpers';
import { stateFrames } from './round-helpers';

/** What the test knows about one round, independently of the frames. */
export interface RoundTruth {
  readonly word: string;
  /** Accepted alternates; secret like the word, and never sent (one is public only once typed as the guess). */
  readonly alt?: readonly string[];
  /** The faker's player id. */
  readonly faker: string;
  /** The round's roster, from its briefing `state` (3.2): the only players a round view may reach. */
  readonly roster: readonly string[];
  /** The round reached unmask, so `round.faker` is public from then. */
  readonly unmasked: boolean;
}

export interface Watched {
  readonly socket: Socket;
  /** The player bound to this socket, or null for an observer or a display. */
  readonly id: string | null;
}

/** Phases in which `round.faker` may be set: from unmask on (§4 phase 5). */
const REVEALED: readonly PublicState['phase']['name'][] = ['unmask', 'guess', 'judging', 'results', 'final'];

/**
 * The §14 rules over every frame of every socket, for a whole game:
 * - `private` only for the socket's own player, a round view only for that
 *   round's roster (3.2: a waiting late joiner gets none); the faker role only on
 *   that round's faker's socket; a token only in its own player's `private`;
 * - a round's word, before that socket has seen the `state` that resolves
 *   the round (`round.result` set), only inside a roster agent's own
 *   `private` for that round: never in any `state`, never on the faker's
 *   socket, an observer's or a display's, never in any other frame; and a
 *   round that never resolves (`host:end`) never shows its word anywhere
 *   else at all. An `alt` appears nowhere before resolution either;
 * - `round.faker` null before unmask and in a round ended before unmask,
 *   the true faker from unmask on;
 * - no `state` carries a token or stroke data; no `drawing` frame for a
 *   round before that socket saw the round's slideshow `state`;
 * - every socket's `state` frames are a run of the longest list, and every
 *   open socket ends on the same bytes.
 */
export function assertGameSecrecy(all: readonly Watched[], tokens: readonly string[], truth: ReadonlyMap<number, RoundTruth>): void {
  for (const { socket, id } of all) {
    const resolved = new Set<number>();
    const shown = new Set<number>();
    for (const raw of socket.raw) {
      const msg = JSON.parse(raw) as ServerMessage;
      if (msg.type === 'state') {
        const r = msg.state.round;
        if (r?.result) resolved.add(r.no);
        if (r?.cards) shown.add(r.no);
        if (r) {
          const t = truth.get(r.no);
          expect(t, `truth for round ${r.no}`).toBeDefined();
          const expected = REVEALED.includes(msg.state.phase.name) && t!.unmasked ? t!.faker : null;
          expect(r.faker, `round ${r.no} faker in ${msg.state.phase.name}`).toBe(expected);
        }
        expect(raw).not.toContain('"strokes"');
        expect(raw).not.toMatch(/"p":\[/);
        for (const tok of tokens) expect(raw).not.toContain(tok);
      }
      if (msg.type === 'private') {
        expect(msg.view.you.id).toBe(id);
        const r = msg.view.round;
        if (r) {
          expect(truth.get(r.no)?.roster, `round ${r.no} view on ${id}, not on its roster`).toContain(id);
          expect(r.role === 'faker', `round ${r.no} role on ${id}`).toBe(truth.get(r.no)?.faker === id);
        }
      }
      if (msg.type === 'drawing') expect(shown.has(msg.roundNo), `drawing of round ${msg.roundNo} before its slideshow`).toBe(true);
      const own = msg.type === 'private' ? msg.view.you.token : null;
      for (const tok of tokens) if (tok !== own) expect(raw).not.toContain(tok);

      for (const [no, t] of truth) {
        if (resolved.has(no)) continue;
        // An alt is never sent; one shows up only as a faker's guess, which auto-accepts, resolving the round.
        for (const a of t.alt ?? []) expect(raw).not.toContain(a);
        const agentsOwn = msg.type === 'private' && msg.view.round?.no === no && msg.view.round.role === 'agent' && id !== t.faker && id !== null && t.roster.includes(id);
        if (!agentsOwn) expect(raw, `round ${no}'s word on ${id ?? 'a watcher'} before it resolved`).not.toContain(t.word);
      }
    }
  }
  const lists = all.map(({ socket }) => stateFrames(socket));
  const longest = lists.reduce((a, b) => (b.length > a.length ? b : a));
  for (const list of lists) {
    if (list.length === 0) continue;
    const start = longest.indexOf(list[0]!);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(longest.slice(start, start + list.length)).toEqual(list);
  }
  const open = all.filter(({ socket }) => socket.closed === null).map(({ socket }) => stateFrames(socket).at(-1));
  expect(new Set(open).size).toBe(1);
}

/** No captured log line names any round's word or alt, any faker's id (word-bounded) or any player's name. */
export function assertLogsCleanOfGame(lines: readonly string[], truth: ReadonlyMap<number, RoundTruth>, names: readonly string[]): void {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const line of lines) {
    for (const t of truth.values()) {
      expect(line).not.toContain(t.word);
      for (const a of t.alt ?? []) expect(line).not.toContain(a);
      expect(line).not.toMatch(new RegExp(`\\b${esc(t.faker)}\\b`));
    }
    for (const n of names) expect(line).not.toMatch(new RegExp(`${esc(n)}(?!\\d)`));
  }
}
