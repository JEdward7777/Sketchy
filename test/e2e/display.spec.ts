import { expect, test, type Page } from '@playwright/test';
import { FAKER_LINE, closeAll, drag, lastState, roles, skipBriefing, startGame, type Agent } from './fairness-helpers';
import { assertFakerDomClean, domStrings, hasWord, shot, stringValues, type Frames } from './round-helpers';

/**
 * The big-screen display (stage 12.4, `SPEC.md` §3): `/display/<code>` at
 * 1920×1080 over a display socket. Three agents play a round while the
 * display watches: it receives public `state` and the round's `drawing`
 * frames and never a `private`; it sends nothing but `hello {display:
 * true}` and clock pings; its slideshow shows the same slide as the
 * phones; its DOM never holds the word or the faker line before the
 * round's result, and names the faker only from unmask.
 */

const TV = { width: 1920, height: 1080 };
type Phase = { name: string; startsAt?: number; perSlideMs?: number };

function recorder(page: Page): Frames {
  const frames: Frames = { received: [], sent: [] };
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => frames.received.push(JSON.parse(String(f.payload)) as Record<string, unknown>));
    ws.on('framesent', (f) => frames.sent.push(JSON.parse(String(f.payload)) as Record<string, unknown>));
  });
  return frames;
}

/** The display's DOM, like the faker's, never knew the word: the strict scan, plus no faker line. */
async function assertDisplayClean(page: Page, word: string): Promise<void> {
  await assertFakerDomClean(page, word);
  for (const s of await domStrings(page)) expect(s.includes(FAKER_LINE), `display shows the faker line: ${s}`).toBe(false);
}

/**
 * Hold the briefing envelope and measure: every line of the letter must end
 * above the pocket's top edge where that line sits (the pocket is the
 * front's V: 30% of the height at the sides, 62% in the middle), so no
 * text hides behind the envelope (review of unit 12b). Returns the problems.
 */
async function letterClearOfPocket(page: Page): Promise<string[]> {
  const env = page.getByTestId('envelope');
  await env.scrollIntoViewIfNeeded();
  const box = (await env.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.85);
  await page.mouse.down();
  await expect(page.getByTestId('envelope-line')).toBeVisible();
  await page.waitForTimeout(600);
  const problems = await page.evaluate(() => {
    const e = document.querySelector('[data-testid="envelope"]')!.getBoundingClientRect();
    const pocket = (x: number) => e.top + e.height * (0.3 + 0.32 * (1 - Math.min(1, Math.abs(x - (e.left + e.width / 2)) / (e.width / 2))));
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('[data-testid="envelope-letter"] > *'))) {
      const r = el.getBoundingClientRect();
      const top = Math.min(pocket(r.left), pocket(r.right));
      if (r.bottom > top + 1) out.push(`${el.className} ends at ${Math.round(r.bottom)}, pocket at ${Math.round(top)}`);
    }
    return out;
  });
  await page.mouse.up();
  await expect(page.getByTestId('envelope-letter')).toHaveCount(0);
  return problems;
}

test('display: public state and drawings only, synced slideshow, no secrets, no intents', async ({ browser }) => {
  test.setTimeout(180_000);
  const { code, agents } = await startGame(browser, ['Ava', 'Bea', 'Cy'], { draw: 30, slide: 2, vote: 40, guess: 30 }, { start: false });
  const host = agents[0]!;
  let tv: { ctx: Awaited<ReturnType<typeof browser.newContext>>; page: Page } | null = null;
  try {
    // ---- the lobby links to it; the display shows the roster and the QR ----
    const link = host.page.getByTestId('display-link');
    await expect(link).toHaveAttribute('href', new RegExp(`/display/${code}$`));
    const ctx = await browser.newContext({ viewport: TV, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    ctx.setDefaultTimeout(15_000);
    const page = await ctx.newPage();
    tv = { ctx, page };
    const frames = recorder(page);
    await page.goto(`/display/${code.toLowerCase()}`);
    const display = page.getByTestId('display');
    await expect(display).toHaveAttribute('data-phase', 'lobby');
    await expect(page.getByTestId('display-roster').getByTestId('player-chip')).toHaveCount(3);
    await expect(page.getByTestId('display-qr')).toBeVisible();
    await expect(page.getByTestId('display-code')).toContainText(code);
    // A display is never a player: the lobby still counts three agents.
    expect(lastState(host.frames).players).toHaveLength(3);
    await shot(page, 'display-01-lobby');
    // The phones' landing and lobby, for the art pass (12.3).
    await shot(host.page, 'phone-lobby-host');
    const landing = await host.ctx.newPage();
    await landing.goto('/');
    await expect(landing.getByTestId('landing')).toBeVisible();
    await shot(landing, 'phone-landing');
    await landing.setViewportSize({ width: 740, height: 360 });
    await shot(landing, 'phone-landing-landscape');
    await landing.close();

    await host.page.getByTestId('start').click();
    const r = await roles(agents);
    await expect(display).toHaveAttribute('data-phase', 'briefing', { timeout: 20_000 });
    // The held letter clears the pocket for the faker and for an agent (both roles' texts differ in length).
    for (const a of [r.faker!, agents.find((q) => q !== r.faker)!]) {
      await expect(a.page.getByTestId('envelope')).toBeVisible();
      expect(await letterClearOfPocket(a.page), `${a === r.faker ? 'faker' : 'agent'} letter`).toEqual([]);
    }
    // The longest letter (the faker's) on the smallest phone too.
    await r.faker!.page.setViewportSize({ width: 320, height: 568 });
    expect(await letterClearOfPocket(r.faker!.page), 'faker letter at 320×568').toEqual([]);
    await r.faker!.page.setViewportSize({ width: 412, height: 839 });
    await expect(page.getByTestId('category')).toContainText((lastState(host.frames).round as unknown as { category: string }).category);
    await assertDisplayClean(page, r.word);
    await shot(page, 'display-02-briefing');
    await skipBriefing(host);

    // ---- draw: who has filed, live ----
    await expect(display).toHaveAttribute('data-phase', 'draw', { timeout: 20_000 });
    await expect(page.getByTestId('display-agent')).toHaveCount(3);
    await drag(agents[0]!.page);
    await agents[0]!.page.getByTestId('draw-done').click();
    await expect(page.locator(`[data-testid="display-agent"][data-player="${agents[0]!.id}"]`)).toHaveAttribute('data-done', 'true');
    await expect(page.locator('[data-testid="display-agent"][data-done="false"]')).toHaveCount(2);
    await assertDisplayClean(page, r.word);
    await shot(page, 'display-03-draw');
    for (const a of agents.slice(1)) {
      await drag(a.page);
      await a.page.getByTestId('draw-done').click();
    }

    // ---- slideshow: the same slide as the phones, the drawings painted ----
    await expect(display).toHaveAttribute('data-phase', 'slideshow', { timeout: 20_000 });
    // The host's own recording may lag the display's by a frame.
    await expect.poll(() => lastState(host.frames).phase.name).toBe('slideshow');
    const { startsAt, perSlideMs } = lastState(host.frames).phase as Required<Phase>;
    for (let k = 0; k < 3; k++) {
      const into = (Date.now() - startsAt) % perSlideMs;
      if (into < 600) await page.waitForTimeout(600 - into);
      else if (into > 1_400) await page.waitForTimeout(perSlideMs - into + 600);
      const expected = String(Math.floor((Date.now() - startsAt) / perSlideMs));
      const [onTv, ...onPhones] = await Promise.all([page, ...agents.map((a) => a.page)].map((p) => p.getByTestId('slide').getAttribute('data-slide')));
      expect(onTv, `display slide at sample ${k}`).toBe(expected);
      expect(onPhones).toEqual(agents.map(() => expected));
      await page.waitForTimeout(perSlideMs);
    }
    await expect(page.locator('[data-testid="evidence-canvas"][data-strokes="1"]')).toHaveCount(1);
    // No vote buttons on a display.
    await expect(page.getByTestId('evidence-vote')).toHaveCount(0);
    await expect(page.getByTestId('suspect-vote')).toHaveCount(0);

    // ---- live votes: a chip appears on the display ----
    const voter = agents.find((a) => a !== r.faker)!;
    await voter.page.locator(`[data-testid="suspect"][data-target="${r.faker!.id}"] [data-testid="suspect-vote"]`).click();
    await expect(page.locator(`[data-testid="suspect"][data-target="${r.faker!.id}"] .vote-chip[data-voter="${voter.id}"]`)).toHaveCount(1);
    await assertDisplayClean(page, r.word);
    await shot(page, 'display-04-slideshow');

    // ---- browse: every drawing at once ----
    await expect(display).toHaveAttribute('data-phase', 'browse', { timeout: 30_000 });
    await expect(page.getByTestId('display-grid').getByTestId('evidence-card')).toHaveCount(3);
    await expect(page.getByTestId('display-grid').locator('[data-testid="evidence-canvas"][data-painted="true"]')).toHaveCount(3);
    await assertDisplayClean(page, r.word);
    await shot(page, 'display-05-browse');
    for (const a of agents) {
      const target = a === r.faker ? agents.find((q) => q !== a)! : r.faker!;
      await a.page.locator(`[data-testid="suspect"][data-target="${target.id}"] [data-testid="suspect-vote"]`).click();
      await a.page.getByTestId('lock-in').click();
    }

    // ---- unmask: the faker is public now, the word still is not ----
    await expect(display).toHaveAttribute('data-phase', 'unmask', { timeout: 20_000 });
    await expect(page.getByTestId('faker-reveal')).toHaveAttribute('data-faker', r.faker!.id);
    await assertDisplayClean(page, r.word);
    await page.waitForTimeout(2_000);
    await shot(page, 'display-06-unmask');

    // ---- guess, then judging ----
    await expect(display).toHaveAttribute('data-phase', 'guess', { timeout: 20_000 });
    await expect(page.getByTestId('display-grid').getByTestId('evidence-card')).toHaveCount(3);
    await assertDisplayClean(page, r.word);
    await shot(page, 'display-07-guess');
    await r.faker!.page.getByTestId('guess-input').fill(`${r.word}qq`);
    await r.faker!.page.getByTestId('guess-submit').click();
    await expect(display).toHaveAttribute('data-phase', 'judging', { timeout: 20_000 });
    await expect(page.getByTestId('display-guess')).toHaveText(`${r.word}qq`);
    await expect(page.getByTestId('display-judged')).toContainText('0 of 2');
    await shot(page, 'display-08-judging');
    for (const a of agents.filter((q) => q !== r.faker)) await a.page.getByTestId('judge-reject').click();

    // ---- results: the word, from round.result only ----
    await expect(display).toHaveAttribute('data-phase', 'results', { timeout: 20_000 });
    await expect(page.getByTestId('results-word')).toHaveText(r.word);
    await expect(page.getByTestId('scoreboard').getByTestId('score-row')).toHaveCount(3);
    await shot(page, 'display-09-results');

    // ---- final: the host ends the game; the podium ----
    await host.page.getByTestId('host-menu').click();
    await host.page.getByTestId('host-end-ask').click();
    await host.page.getByTestId('host-end').click();
    await expect(display).toHaveAttribute('data-phase', 'final', { timeout: 20_000 });
    await expect(page.getByTestId('podium')).toBeVisible();
    await page.waitForTimeout(600);
    await shot(page, 'display-10-final');

    // ---- frames ----
    const types = new Set(frames.received.map((m) => m.type));
    expect(types.has('private'), 'a display never receives private').toBe(false);
    expect(frames.received.filter((m) => m.type === 'drawing')).toHaveLength(3);
    expect(frames.received.filter((m) => m.type === 'error'), 'no refused frames').toEqual([]);
    expect(frames.sent[0]).toEqual({ type: 'hello', v: 1, display: true });
    expect(frames.sent.filter((m) => m.type !== 'hello' && m.type !== 'ping'), 'a display sends no intents').toEqual([]);
    // Before the state that resolves the round, no frame the display got carries the word (the room code excepted).
    for (const m of frames.received) {
      if (m.type === 'state' && (m as { state: { round: { result: unknown } | null } }).state.round?.result) break;
      const leak = stringValues(m).filter((x) => x.key !== 'code' && hasWord(x.value, r.word));
      expect(leak, 'the display received the word before the result').toEqual([]);
    }
  } finally {
    await tv?.ctx.close().catch(() => {});
    await closeAll(agents as Agent[]);
  }
});

test('display: six drawings tile inside common TV and laptop screens, each 4:3', async ({ browser }) => {
  test.setTimeout(150_000);
  const { code, agents } = await startGame(browser, ['Ava', 'Bea', 'Cy', 'Dee', 'Eli', 'Flo'], { draw: 60, slide: 1, vote: 60, guess: 30 });
  const ctx = await browser.newContext({ viewport: TV, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  try {
    const page = await ctx.newPage();
    await page.goto(`/display/${code}`);
    await roles(agents);
    await skipBriefing(agents[0]!);
    for (const a of agents) {
      await expect(a.page.getByTestId('draw')).toBeVisible({ timeout: 20_000 });
      await drag(a.page);
      await a.page.getByTestId('draw-done').click();
    }
    await expect(page.getByTestId('display')).toHaveAttribute('data-phase', 'browse', { timeout: 40_000 });
    for (const vp of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, TV]) {
      await page.setViewportSize(vp);
      await expect(page.getByTestId('display-grid').locator('[data-testid="evidence-canvas"][data-painted="true"]')).toHaveCount(6);
      await page.waitForTimeout(300);
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        for (const card of Array.from(document.querySelectorAll('[data-testid="display-grid"] [data-testid="evidence-card"]'))) {
          const r = card.getBoundingClientRect();
          if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) out.push(`card ${card.getAttribute('data-artist')} at ${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)}`);
          const c = card.querySelector('canvas')!.getBoundingClientRect();
          if (Math.abs(c.width / c.height - 4 / 3) > 0.02) out.push(`canvas ${card.getAttribute('data-artist')} is ${Math.round(c.width)}×${Math.round(c.height)}`);
        }
        return out;
      });
      expect(problems, `${vp.width}×${vp.height}`).toEqual([]);
      await shot(page, `display-05b-browse-six-${vp.width}`);
    }
  } finally {
    await ctx.close().catch(() => {});
    await closeAll(agents);
  }
});
