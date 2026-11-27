import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createRoom, domStrings, hasWord, join, recordFrames, shot, stringValues, type Frames } from './round-helpers';
import { isBareWord, isWholeLiteral } from './secrecy-helpers';

/**
 * Phase 10 (plan 10 Verification): three contexts play a whole game (1
 * cycle × 3 agents = 3 rounds) against `wrangler dev` with a short Custom
 * preset, to the podium and back to the lobby. Roles and the word come
 * from each context's own `private` frames; every step is written
 * relative to whoever the room picked, so it is the same test whoever is
 * the faker (the host included).
 *
 * - Round 1: the faker types the word (in capitals): auto-accepted, no
 *   judging. Results auto-continue with no host tap.
 * - Round 2: a near guess goes to judging; only non-faker contexts get the
 *   Accept/Reject buttons; one accepts and one rejects, and the 1–1 tie
 *   goes to the faker. On results the host taps the page: a `host:hold`
 *   that moves the fill start to the tap + HOLD_REARM_MS, then Continue.
 * - Round 3: no guess; the guess timer runs out. Results continue to the
 *   final podium, whose places match the room's standings; a non-host
 *   saves a drawing as a PNG download; Play again returns everyone to the
 *   lobby with scores at 0.
 * - Secrecy: DOM samples in unmask, guess and judging (envelopes closed)
 *   never show the word, except in strings the faker saw too, the other
 *   rounds showed, or whole client literals; the faker's frames never carry
 *   the word before the state that resolves the guess.
 */

interface Agent {
  readonly name: string;
  readonly page: Page;
  readonly frames: Frames;
  id: string;
}

type Result = { word: string; verdict: string; correct: boolean; accepts: number; rejects: number; points: Record<string, number> };
type Phase = { name: string; endsAt?: number; continueAt?: number; fillFrom?: number; standings?: { id: string; score: number; place: number }[] };
type State = {
  seq: number;
  phase: Phase;
  players: { id: string; score: number }[];
  progress: { completed: number; total: number } | null;
  round: { no: number; faker: string | null; guess: string | null; judged: string[]; result: Result | null } | null;
};

const states = (f: Frames) => f.received.filter((m) => m.type === 'state').map((m) => (m as unknown as { state: State }).state);
const lastState = (f: Frames) => states(f).at(-1)!;
const lastPrivate = (f: Frames) =>
  (f.received.filter((m) => m.type === 'private').at(-1) as { view: { you: { id: string }; round: { no: number; role: string; word?: string } | null } }).view;

const HOLD_REARM_MS = 60_000;
const RESULTS_BEAT_MS = 8_000;

async function drag(page: Page): Promise<void> {
  const box = (await page.getByTestId('draw-canvas').boundingBox())!;
  await page.mouse.move(box.x + 0.2 * box.width, box.y + 0.3 * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + 0.8 * box.width, box.y + 0.7 * box.height, { steps: 10 });
  await page.mouse.up();
}

/** Flip once round the drawing browser: every card a drawing, back at the first. */
async function reviewAll(page: Page): Promise<void> {
  const card = page.getByTestId('review-card');
  const first = await card.getAttribute('data-artist');
  const seen = new Set<string>();
  for (let i = 0; i < 3; i++) {
    seen.add((await card.getAttribute('data-artist'))!);
    await expect(card).toHaveAttribute('data-content', 'drawing');
    await page.getByTestId('review-next').click();
  }
  expect(seen.size).toBe(3);
  await expect(card).toHaveAttribute('data-artist', first!);
}

/**
 * A crowded card: the browser's current card gets 8 more vote chips (DOM clones of its own, so the layout is
 * what 9 votes would render), then the artist's name must still show at least its first 3 characters and no
 * chip may be cut off by the card. The clones are removed afterwards.
 */
async function crowdedCardFits(page: Page): Promise<{ name: boolean; chips: boolean }> {
  return page.getByTestId('review-card').evaluate((card) => {
    const chips = card.querySelector('.vote-chips')!;
    const proto = chips.querySelector('.vote-chip')!;
    const clones = Array.from({ length: 8 }, () => chips.appendChild(proto.cloneNode(true)) as Element);
    const name = card.querySelector('.evidence-name')!;
    const text = name.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(3, text.textContent!.length));
    const need = range.getBoundingClientRect().width;
    const c = card.getBoundingClientRect();
    const ok = Array.from(chips.querySelectorAll('.vote-chip')).every((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5 && r.width > 0;
    });
    const result = { name: name.getBoundingClientRect().width >= need - 0.5 && need > 0, chips: ok };
    for (const x of clones) x.remove();
    return result;
  });
}

/** No horizontal page scroll. */
async function fitsWidth(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test('results: unmask, guess, judging, round results, podium, Save my drawing, Play again', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctxs = await Promise.all([0, 1, 2].map(() => browser.newContext({ acceptDownloads: true })));
  try {
    for (const c of ctxs) {
      c.setDefaultTimeout(15_000);
      // No Web Share: Save my drawing must take the download path, which the test can catch.
      await c.addInitScript(() => {
        const proto = Navigator.prototype as unknown as Record<string, unknown>;
        delete proto.share;
        delete proto.canShare;
      });
    }
    const pages = await Promise.all(ctxs.map((c) => c.newPage()));
    const agents: Agent[] = ['Ava', 'Bea', 'Cy'].map((name, i) => ({ name, page: pages[i]!, frames: recordFrames(pages[i]!), id: '' }));
    const host = agents[0]!;

    const code = await createRoom(host.page);
    await join(host.page, 'Ava', 'red');
    for (const [p, color] of [[agents[1]!, 'blue'], [agents[2]!, 'green']] as const) {
      await p.page.goto(`/join/${code}`);
      await join(p.page, p.name, color);
    }
    await host.page.getByTestId('pick-cycles').getByRole('radio', { name: '1' }).click();
    await host.page.getByTestId('pick-timers').getByRole('radio', { name: 'Custom' }).click();
    const custom = host.page.getByTestId('custom-timers');
    await custom.getByLabel(/^Draw/).fill('20');
    await custom.getByLabel(/^Per slide/).fill('1');
    await custom.getByLabel(/^Vote/).fill('30');
    await custom.getByLabel(/^Guess/).fill('20');
    await custom.getByRole('button', { name: 'Save timers' }).click();
    await expect(agents[2]!.page.getByTestId('game-length')).toContainText('1 cycle × 3 agents = 3 rounds');
    await expect(agents[2]!.page.getByTestId('settings-timers')).toContainText('guess 20 s');
    await host.page.getByTestId('start').click();

    // Per round: the word, the faker, and the DOM samples taken before the guess resolved.
    const rounds: { word: string; faker: Agent; no: number; samples: Map<Agent, string[][]> }[] = [];
    const sample = async () => {
      const r = rounds.at(-1)!;
      for (const p of agents) {
        await expect(p.page.getByTestId('envelope-letter')).toHaveCount(0);
        r.samples.get(p)!.push(await domStrings(p.page));
      }
    };

    /** Briefing → draw → everyone locks a vote mid-slideshow → unmask, checked in every context. */
    const playToUnmask = async () => {
      for (const p of agents) await expect(p.page.getByTestId('briefing')).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => agents.every((p) => lastPrivate(p.frames).round?.no === lastState(p.frames).round?.no)).toBe(true);
      for (const p of agents) p.id = lastPrivate(p.frames).you.id;
      const faker = agents.find((p) => lastPrivate(p.frames).round!.role === 'faker')!;
      const word = lastPrivate(agents.find((p) => p !== faker)!.frames).round!.word!;
      expect(word).toBeTruthy();
      rounds.push({ word, faker, no: lastState(host.frames).round!.no, samples: new Map(agents.map((p) => [p, []])) });
      await host.page.getByTestId('host-continue').click();
      for (const p of agents) {
        await expect(p.page.getByTestId('draw')).toBeVisible();
        await drag(p.page);
        await p.page.getByTestId('draw-done').click();
      }
      for (const p of agents) await expect(p.page.getByTestId('evidence')).toBeVisible({ timeout: 30_000 });
      // Each accuses the next agent along and locks: the last lock ends voting at once (0016).
      for (const [i, me] of agents.entries()) {
        const target = agents[(i + 1) % agents.length]!;
        await me.page.locator(`[data-testid="suspect"][data-target="${target.id}"] [data-testid="suspect-vote"]`).click();
        await me.page.getByTestId('lock-in').click();
      }
      for (const p of agents) await expect(p.page.getByTestId('unmask')).toBeVisible({ timeout: 10_000 });
      // Who voted for whom, and the faker, the same in every context.
      for (const [i, me] of agents.entries()) {
        for (const p of agents) {
          const line = p.page.locator(`[data-testid="vote-line"][data-voter="${me.id}"]`);
          await expect(line).toHaveAttribute('data-target', agents[(i + 1) % agents.length]!.id);
          await expect(line).toHaveAttribute('data-caught', String(agents[(i + 1) % agents.length] === faker));
        }
      }
      for (const p of agents) await expect(p.page.getByTestId('faker-reveal')).toHaveAttribute('data-faker', faker.id);
      await sample();
      return rounds.at(-1)!;
    };

    /** The guess phase: only the faker has the field; everyone sees the category. */
    const atGuess = async (faker: Agent) => {
      for (const p of agents) {
        await expect(p.page.getByTestId('guess')).toBeVisible({ timeout: 10_000 });
        await expect(p.page.getByTestId('category')).not.toContainText('…');
        await expect(p.page.getByTestId('guess-input')).toHaveCount(p === faker ? 1 : 0);
        await expect(p.page.getByTestId('guess-waiting')).toHaveCount(p === faker ? 0 : 1);
      }
      // Everyone, the faker above all, can flip back through every drawing (§1, §4); no vote buttons.
      await reviewAll(faker.page);
      await expect(faker.page.getByTestId('evidence-vote')).toHaveCount(0);
      await sample();
    };

    // ---- round 1: an exact guess auto-accepts ----
    const r1 = await playToUnmask();
    // After the stamp's entrance (1.4 s delay + 0.52 s), so the screenshot shows the reveal.
    if (process.env.SKETCHY_SHOTS) await r1.faker.page.waitForTimeout(2_000);
    await shot(r1.faker.page, '01-unmask');
    await atGuess(r1.faker);
    await shot(r1.faker.page, '02-guess-faker');
    await shot(agents.find((p) => p !== r1.faker)!.page, '03-guess-waiting');
    await r1.faker.page.getByTestId('guess-input').fill(r1.word.toUpperCase());
    await r1.faker.page.getByTestId('guess-submit').click();
    for (const p of agents) {
      await expect(p.page.getByTestId('results')).toBeVisible();
      await expect(p.page.getByTestId('verdict')).toHaveAttribute('data-kind', 'auto');
      await expect(p.page.getByTestId('results-word')).toHaveText(r1.word);
    }
    // Never judged: no state of round 1 was in judging.
    expect(states(host.frames).some((s) => s.phase.name === 'judging')).toBe(false);
    const res1 = lastState(host.frames);
    expect(res1.round!.result!.verdict).toBe('auto');
    // This round's points and the running totals, as the room scored them.
    for (const p of agents) {
      for (const pl of res1.players) {
        const row = p.page.locator(`[data-testid="score-row"][data-player="${pl.id}"]`);
        await expect(row).toHaveAttribute('data-score', String(pl.score));
        await expect(row).toHaveAttribute('data-gained', String(res1.round!.result!.points[pl.id]));
      }
    }
    await expect(host.page.getByTestId('host-continue')).toContainText('Next round');
    await shot(host.page, '04-results-host');
    await shot(r1.faker.page, '05-results');
    if (process.env.SKETCHY_SHOTS) {
      await agents[1]!.page.setViewportSize({ width: 915, height: 412 });
      await shot(agents[1]!.page, '05-results-landscape');
      await agents[1]!.page.setViewportSize({ width: 412, height: 839 });
    }
    // A short landscape phone: no sideways scroll.
    await agents[2]!.page.setViewportSize({ width: 568, height: 320 });
    expect(await fitsWidth(agents[2]!.page), 'results at 568×320').toBe(true);
    await agents[2]!.page.setViewportSize({ width: 412, height: 839 });
    // No tap: the results continue on their own after the beat (0004).
    const sentBefore = host.frames.sent.filter((m) => m.type === 'host:next' || m.type === 'host:hold').length;

    // ---- round 2: a near guess goes to judging; a 1–1 tie goes to the faker ----
    const r2 = await playToUnmask();
    expect(host.frames.sent.filter((m) => m.type === 'host:next' || m.type === 'host:hold').length).toBe(sentBefore + 1); // only round 2's briefing continue
    await atGuess(r2.faker);
    const near = `${r2.word}qq`;
    await r2.faker.page.getByTestId('guess-input').fill(near);
    await r2.faker.page.getByTestId('guess-submit').click();
    const judges = agents.filter((p) => p !== r2.faker);
    for (const p of agents) {
      await expect(p.page.getByTestId('judging')).toBeVisible();
      await expect(p.page.getByTestId('guess-text')).toHaveText(near);
      await expect(p.page.getByTestId('judge-accept')).toHaveCount(p === r2.faker ? 0 : 1);
      await expect(p.page.getByTestId('judge-reject')).toHaveCount(p === r2.faker ? 0 : 1);
      await expect(p.page.getByTestId('judge-count')).toContainText('0 of 2');
      await expect(p.page.getByTestId('judge-count')).toContainText('a tie goes to the faker');
    }
    await expect(r2.faker.page.getByTestId('judge-faker')).toBeVisible();
    await sample();
    await shot(judges[0]!.page, '06-judging');
    await shot(r2.faker.page, '07-judging-faker');
    // The judging screen keeps the drawings too.
    await reviewAll(judges[1]!.page);
    // A double tap (two clicks in one task, before any re-render) sends one judgment.
    await judges[0]!.page.getByTestId('judge-accept').evaluate((b: HTMLButtonElement) => {
      b.click();
      b.click();
    });
    for (const p of agents) await expect(p.page.getByTestId('judge-count')).toContainText('1 of 2');
    await judges[0]!.page.waitForTimeout(300);
    expect(judges[0]!.frames.sent.filter((m) => m.type === 'guess:judge')).toEqual([{ type: 'guess:judge', accept: true }]);
    await expect(judges[0]!.page.getByTestId('judge-done')).toContainText('accept');
    await expect(judges[0]!.page.getByTestId('judge-accept')).toHaveCount(0);
    await sample();
    // A short landscape phone: the jury's buttons are fully on screen without scrolling.
    await judges[1]!.page.setViewportSize({ width: 568, height: 320 });
    await judges[1]!.page.evaluate(() => window.scrollTo(0, 0));
    for (const b of ['judge-accept', 'judge-reject']) await expect(judges[1]!.page.getByTestId(b)).toBeInViewport({ ratio: 1 });
    expect(await fitsWidth(judges[1]!.page), 'judging at 568×320').toBe(true);
    await shot(judges[1]!.page, '06-judging-568x320');
    await judges[1]!.page.setViewportSize({ width: 412, height: 839 });
    await judges[1]!.page.getByTestId('judge-reject').click();
    for (const p of agents) {
      await expect(p.page.getByTestId('results')).toBeVisible();
      await expect(p.page.getByTestId('verdict')).toHaveAttribute('data-kind', 'accepted');
      await expect(p.page.getByTestId('verdict')).toContainText('tie goes to the faker');
      await expect(p.page.getByTestId('results-word')).toHaveText(r2.word);
    }
    expect(lastState(host.frames).round!.result).toMatchObject({ verdict: 'judged', correct: true, accepts: 1, rejects: 1 });

    // The host taps the page (not Continue): one `host:hold`, the fill start moves to tap + HOLD_REARM_MS.
    const holdsBefore = host.frames.sent.filter((m) => m.type === 'host:hold').length;
    const before = lastState(host.frames).phase;
    const tapAt = Date.now();
    await host.page.locator('.word-reveal').click();
    await expect.poll(() => host.frames.sent.filter((m) => m.type === 'host:hold').length).toBe(holdsBefore + 1);
    await expect.poll(() => lastState(host.frames).phase.fillFrom).toBeGreaterThan(before.fillFrom!);
    const held = lastState(host.frames).phase;
    expect(held.name).toBe('results');
    expect(held.fillFrom!).toBeGreaterThanOrEqual(tapAt + HOLD_REARM_MS - 2_000);
    expect(held.continueAt! - held.fillFrom!).toBe(RESULTS_BEAT_MS);
    await expect(host.page.getByTestId('auto-continue-status')).toContainText('On hold');
    await expect(host.page.getByTestId('host-continue')).toHaveAttribute('data-filling', 'false');
    // Past the original beat it is still up: the hold kept it.
    await host.page.waitForTimeout(Math.max(0, before.continueAt! - Date.now() + 1_000));
    for (const p of agents) await expect(p.page.getByTestId('results')).toBeVisible();
    // Continue echoes the shown seq.
    const resultsSeq = lastState(host.frames).seq;
    await host.page.getByTestId('host-continue').click();
    expect(host.frames.sent.filter((m) => m.type === 'host:next').at(-1)).toEqual({ type: 'host:next', seq: resultsSeq });

    // ---- round 3: no guess, the timer runs out; then the podium ----
    const r3 = await playToUnmask();
    await atGuess(r3.faker);
    // A short landscape phone: the guess field is on screen without scrolling, the page never scrolls sideways.
    await r3.faker.page.setViewportSize({ width: 568, height: 320 });
    await r3.faker.page.evaluate(() => window.scrollTo(0, 0));
    await expect(r3.faker.page.getByTestId('guess-input')).toBeInViewport({ ratio: 1 });
    expect(await fitsWidth(r3.faker.page), 'guess at 568×320').toBe(true);
    await shot(r3.faker.page, '02-guess-faker-568x320');
    // Nine votes on one card, small landscape and small portrait: the name keeps its room, no chip is clipped.
    for (const [w, h] of [[568, 320], [360, 740]] as const) {
      await r3.faker.page.setViewportSize({ width: w, height: h });
      expect(await crowdedCardFits(r3.faker.page), `crowded card at ${w}×${h}`).toEqual({ name: true, chips: true });
    }
    await r3.faker.page.setViewportSize({ width: 412, height: 839 });
    for (const p of agents) await expect(p.page.getByTestId('results')).toBeVisible({ timeout: 30_000 });
    for (const p of agents) {
      await expect(p.page.getByTestId('verdict')).toHaveAttribute('data-kind', 'none');
      await expect(p.page.getByTestId('results-word')).toHaveText(r3.word);
    }
    expect(lastState(host.frames).progress).toEqual({ completed: 3, total: 3 });
    await expect(host.page.getByTestId('host-continue')).toContainText('Final results');
    await host.page.getByTestId('host-continue').click();

    for (const p of agents) await expect(p.page.getByTestId('final')).toBeVisible({ timeout: 10_000 });
    const fin = lastState(host.frames).phase;
    const standings = fin.standings!;
    expect(standings).toHaveLength(3);
    for (const p of agents) {
      for (const s of standings) {
        const where = s.place <= 3 ? 'podium-agent' : 'standing';
        await expect(p.page.locator(`[data-testid="${where}"][data-player="${s.id}"]`)).toHaveAttribute('data-place', String(s.place));
      }
      // Shared places stand on one step (0007 item 4).
      for (const place of [1, 2, 3]) {
        await expect(p.page.locator(`[data-testid="podium-step"][data-place="${place}"] [data-testid="podium-agent"]`)).toHaveCount(standings.filter((s) => s.place === place).length);
      }
      await expect(p.page.getByTestId('play-again')).toHaveCount(p === host ? 1 : 0);
      await expect(p.page.getByTestId('waiting-host')).toHaveCount(p === host ? 0 : 1);
    }
    await shot(host.page, '08-final-host');
    await shot(agents[1]!.page, '09-final');
    if (process.env.SKETCHY_SHOTS) {
      await agents[1]!.page.setViewportSize({ width: 915, height: 412 });
      await shot(agents[1]!.page, '09-final-landscape');
      await agents[1]!.page.setViewportSize({ width: 412, height: 839 });
    }
    await agents[1]!.page.setViewportSize({ width: 568, height: 320 });
    expect(await fitsWidth(agents[1]!.page), 'final at 568×320').toBe(true);
    await agents[1]!.page.setViewportSize({ width: 412, height: 839 });

    // ---- Save my drawing: a PNG made on the device, downloaded ----
    const saver = agents[1]!;
    await expect(saver.page.getByTestId('save-preview')).toHaveAttribute('data-artist', saver.id);
    const [download] = await Promise.all([saver.page.waitForEvent('download'), saver.page.getByTestId('save-drawing-btn').click()]);
    expect(download.suggestedFilename()).toBe(`sketchy-${saver.name.toLowerCase()}-round-${r3.no}.png`);
    const png = readFileSync((await download.path())!);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1600, 1200]);
    await expect(saver.page.getByTestId('save-status')).toHaveAttribute('data-status', 'downloaded');
    // Another agent's drawing can be picked and saved too.
    const other = agents.find((p) => p !== saver)!;
    await saver.page.getByTestId('save-pick').selectOption(other.id);
    await expect(saver.page.getByTestId('save-drawing-btn')).toContainText(`Save ${other.name}'s drawing`);
    const [d2] = await Promise.all([saver.page.waitForEvent('download'), saver.page.getByTestId('save-drawing-btn').click()]);
    expect(d2.suggestedFilename()).toBe(`sketchy-${other.name.toLowerCase()}-round-${r3.no}.png`);

    // ---- Play again: everyone back in the lobby, scores reset ----
    expect(standings.some((s) => s.score > 0)).toBe(true);
    const finalSeq = lastState(host.frames).seq;
    await host.page.getByTestId('play-again').click();
    for (const p of agents) await expect(p.page.getByTestId('lobby')).toBeVisible({ timeout: 10_000 });
    const lobby = lastState(host.frames);
    expect(lobby.phase.name).toBe('lobby');
    expect(lobby.players.map((pl) => pl.score)).toEqual([0, 0, 0]);
    expect(host.frames.sent.filter((m) => m.type === 'host:next').at(-1)).toEqual({ type: 'host:next', seq: finalSeq });

    // ---- secrecy ----
    for (const [i, r] of rounds.entries()) {
      // The faker's frames up to the state that resolved the guess never carry the word (`code` excepted, as in phase 9).
      const recv = r.faker.frames.received;
      const resolvedAt = recv.findIndex((m) => m.type === 'state' && (m as unknown as { state: State }).state.round?.no === r.no && (m as unknown as { state: State }).state.round?.result);
      expect(resolvedAt, `round ${i + 1} resolved`).toBeGreaterThan(0);
      for (const m of recv.slice(0, resolvedAt)) {
        for (const { key, value } of stringValues(m)) if (key !== 'code') expect(hasWord(value, r.word), `${r.faker.name} round ${i + 1}: ${m.type}.${key}`).toBe(false);
      }
      // DOM samples from unmask through judging.
      const fakerStrings = new Set(r.samples.get(r.faker)!.flat());
      const otherRounds = new Set(rounds.filter((q) => q !== r).flatMap((q) => [...q.samples.values()].flat(2)));
      for (const p of agents) {
        for (const strings of r.samples.get(p)!) {
          for (const s of strings) {
            expect(s.includes('You are the faker'), `${p.name} shows the faker line`).toBe(false);
            if (!hasWord(s, r.word)) continue;
            expect(isBareWord(s, r.word), `${p.name} round ${i + 1} shows the bare word: "${s}"`).toBe(false);
            expect(fakerStrings.has(s) || otherRounds.has(s) || isWholeLiteral(s), `${p.name} round ${i + 1} shows the word in "${s}"`).toBe(true);
          }
        }
      }
    }
    for (const p of agents) expect(p.frames.received.filter((m) => m.type === 'error'), p.name).toEqual([]);
  } finally {
    await Promise.all(ctxs.map((x) => x.close().catch(() => {})));
  }
});
