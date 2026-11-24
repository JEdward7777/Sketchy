import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * Source-level guards for the must-not-break rules in harness/AGENTS.md §5
 * that a runtime test cannot see.
 *
 * Comments are removed with a real parser (esbuild), so prose that names a
 * forbidden call does not trip a rule, while string, template and regex
 * literals survive intact: a hand-written comment regex would read the `/*`
 * in "/api/*" as a comment and delete real code. (TypeScript 7's npm package
 * has no JS API, so its scanner is not available here.)
 *
 * The rules match identifiers rather than call shapes, so aliasing such as
 * `const { accept } = server` or `storage['setAlarm']` is caught too.
 */
const ROOT = join(import.meta.dirname, '..', '..');

function stripComments(code: string, loader: 'ts' | 'tsx' = 'ts'): string {
  return transformSync(code, { loader, legalComments: 'none' }).code;
}

function sources(dir: string): { path: string; code: string }[] {
  const out: { path: string; code: string }[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
    const full = join(entry.parentPath, entry.name);
    const loader = entry.name.endsWith('.tsx') ? 'tsx' : 'ts';
    out.push({ path: relative(ROOT, full), code: stripComments(readFileSync(full, 'utf8'), loader) });
  }
  return out;
}

/** Any mention of setAlarm, as an identifier, property or string key. */
const SET_ALARM = /\bsetAlarm\b/;
/**
 * Any use of a socket's own `accept`, which opts out of hibernation. Matches
 * the bare word, so `ctx.acceptWebSocket` passes (no word boundary inside it).
 * Known future false positive: a field literally named `accept` (SPEC §14's
 * `guess:judge {accept}`) read in src/worker would trip this; rename the field
 * or allowlist that file when it arrives.
 */
const ACCEPT = /\baccept\b/;
/** In-memory timers, which do not survive hibernation. */
const TIMERS = /\bset(Timeout|Interval)\b|\bscheduler\s*\.\s*wait\b/;

const worker = sources('src/worker');
const server = [...worker, ...sources('src/shared')];

describe('platform rules in server code', () => {
  it('only src/worker/alarm.ts mentions setAlarm', () => {
    const callers = server.filter((f) => SET_ALARM.test(f.code)).map((f) => f.path);
    expect(callers).toEqual(['src/worker/alarm.ts']);
  });

  it('never accepts a socket outside the hibernation API', () => {
    const offenders = worker.filter((f) => ACCEPT.test(f.code)).map((f) => f.path);
    expect(offenders).toEqual([]);
    expect(worker.some((f) => /\bctx\.acceptWebSocket\b/.test(f.code))).toBe(true);
  });

  it('keeps no timers in server memory', () => {
    const offenders = server.filter((f) => TIMERS.test(f.code)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe('the rule scanner itself', () => {
  it('keeps code that follows a string containing /*', () => {
    const code = stripComments('const ROUTE = "/api/*"; server.accept(); storage.setAlarm(1); /** doc */');
    expect(ACCEPT.test(code)).toBe(true);
    expect(SET_ALARM.test(code)).toBe(true);
  });

  it('ignores forbidden names that appear only in comments', () => {
    const code = stripComments(
      '/* server.accept() */ const x = 1; // storage.setAlarm(1)\n/*! setTimeout */ /** scheduler.wait */',
    );
    expect(ACCEPT.test(code) || SET_ALARM.test(code) || TIMERS.test(code)).toBe(false);
  });

  it('catches aliasing, string keys and scheduler.wait', () => {
    expect(ACCEPT.test(stripComments('const { accept } = server; accept();'))).toBe(true);
    expect(ACCEPT.test(stripComments("server['accept']();"))).toBe(true);
    expect(SET_ALARM.test(stripComments("storage['setAlarm'](1);"))).toBe(true);
    expect(TIMERS.test(stripComments('await scheduler.wait(10);'))).toBe(true);
    expect(ACCEPT.test(stripComments('this.ctx.acceptWebSocket(server);'))).toBe(false);
  });
});
