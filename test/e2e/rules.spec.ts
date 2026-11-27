import { expect, test, type Locator, type Page } from '@playwright/test';
import { SCORING_ROWS } from '../../src/client/game/rules-content';
import { closeAgent, closeAll, DARK_MS, drag, lastState, playRound, roles, startGame, type Agent } from './fairness-helpers';
import { intents, stubSpeech } from './narrator-helpers';
import { shot } from './round-helpers';

/**
 * Phase 12 ⓘ rules sheet (stage 12.2, `SPEC.md` §11): on every screen —
 * the landing, lobby, briefing, draw, slideshow, browse, unmask, guess,
 * judging, round results, scrubbed, pause and final results — it opens,
 * shows the §5 table, closes with Escape (focus back on ⓘ) and the backdrop,
 * and sends nothing: no intent frame between opening and closing, so it
 * never pauses or holds the game. Checked on the host's phone, where a tap
 * would otherwise be a 0004 hold on the briefing and round results.
 */

test.setTimeout(300_000);

const shots = new Set<string>();

/** Open the sheet from `scope`'s ⓘ, check it, close it with Escape; nothing may be sent meanwhile. */
async function checkRules(a: Agent, scope: Locator, label: string, phase: string | null): Promise<void> {
  const page = a.page;
  const before = intents(a.frames).length;
  const button = scope.getByTestId('rules-open');
  await button.click();
  const sheet = page.getByRole('dialog', { name: 'Field manual' });
  await expect(sheet, label).toBeVisible();
  await expect(sheet.getByTestId('rules-scoring').locator('tbody tr')).toHaveCount(SCORING_ROWS.length);
  await expect(sheet.getByTestId('rules-close')).toBeFocused();
  if (!shots.has(label)) {
    shots.add(label);
    await shot(page, `12-rules-${label}`);
  }
  await page.keyboard.press('Escape');
  await expect(sheet, label).toBeHidden();
  await expect(button, `${label}: focus returns to ⓘ`).toBeFocused();
  expect(intents(a.frames).slice(before), `${label}: opening the rules sent nothing`).toEqual([]);
  if (phase) expect(lastState(a.frames).phase.name, label).toBe(phase);
}

const header = (page: Page) => page.getByTestId('room').locator('header');

async function phaseIs(a: Agent, name: string, timeout = 30_000): Promise<void> {
  await expect.poll(() => lastState(a.frames).phase.name, { timeout }).toBe(name);
}

test('12.2: the rules sheet opens on every screen without changing the game', async ({ browser }) => {
  // Landing: no room yet.
  const visitor = await browser.newContext();
  const landing = await visitor.newPage();
  await landing.goto('/');
  await landing.getByTestId('rules-open').click();
  await expect(landing.getByRole('dialog', { name: 'Field manual' })).toBeVisible();
  // A tap on the backdrop closes it too.
  await landing.mouse.click(4, 4);
  await expect(landing.getByRole('dialog', { name: 'Field manual' })).toBeHidden();
  await visitor.close();

  const { agents } = await startGame(
    browser,
    ['Maya', 'Theo', 'Ana', 'Kai'],
    { draw: 30, slide: 2, vote: 40, guess: 20 },
    {
      start: false,
      // Narrator off on every phone: its own `host:narration` frames (narrator.spec.ts) would blur "the sheet sent nothing".
      setup: async (a) => {
        await stubSpeech(a.ctx);
        await a.ctx.addInitScript(() => localStorage.setItem('sketchy:narrator', 'off'));
      },
    },
  );
  try {
    const host = agents[0]!;
    await checkRules(host, header(host.page), 'lobby', 'lobby');

    // Small phones: the sheet fits the screen and scrolls inside.
    const small = agents[3]!.page;
    await small.setViewportSize({ width: 320, height: 568 });
    await header(small).getByTestId('rules-open').click();
    const sheet = small.getByRole('dialog', { name: 'Field manual' });
    await expect(sheet).toBeVisible();
    const fit = await sheet.evaluate((d) => ({ h: d.getBoundingClientRect().height, scroll: d.scrollHeight > d.clientHeight, vh: innerHeight, w: d.getBoundingClientRect().width, vw: innerWidth }));
    expect(fit.h).toBeLessThanOrEqual(fit.vh);
    expect(fit.w).toBeLessThanOrEqual(fit.vw);
    expect(fit.scroll).toBe(true);
    await sheet.getByTestId('rules-close').scrollIntoViewIfNeeded();
    await shot(small, '12-rules-small');
    await small.keyboard.press('Escape');
    // The header still fits a 320 px phone with Host, the narrator toggle, ⓘ and the room code.
    const overflow = await header(small).evaluate((h) => h.scrollWidth - h.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await small.setViewportSize({ width: 412, height: 839 });

    // ---- round 1: every phase of a round ----
    await host.page.getByTestId('start').click();
    await expect(host.page.getByTestId('briefing')).toBeVisible({ timeout: 20_000 });
    await checkRules(host, header(host.page), 'briefing', 'briefing');
    const r1 = await roles(agents);
    await phaseIs(host, 'draw');
    await checkRules(host, header(host.page), 'draw', 'draw');
    for (const p of agents) {
      await drag(p.page);
      await p.page.getByTestId('draw-done').click();
    }
    await phaseIs(host, 'slideshow');
    await checkRules(host, header(host.page), 'slideshow', 'slideshow');
    await phaseIs(host, 'browse');
    await checkRules(host, header(host.page), 'browse', 'browse');
    for (const p of agents) {
      const target = p === r1.faker ? agents.find((q) => q !== p)! : r1.faker!;
      await p.page.locator(`[data-testid="suspect"][data-target="${target.id}"] [data-testid="suspect-vote"]`).click();
      await p.page.getByTestId('lock-in').click();
    }
    await phaseIs(host, 'unmask');
    await checkRules(host, header(host.page), 'unmask', null);
    await phaseIs(host, 'guess', 10_000);
    await checkRules(host, header(host.page), 'guess', 'guess');
    await r1.faker!.page.getByTestId('guess-input').fill('zzzz');
    await r1.faker!.page.getByTestId('guess-submit').click();
    await phaseIs(host, 'judging');
    await checkRules(host, header(host.page), 'judging', 'judging');
    for (const p of agents) if (p !== r1.faker) await p.page.getByTestId('judge-reject').click();
    await phaseIs(host, 'results');
    await checkRules(host, header(host.page), 'results', 'results');
    await host.page.getByTestId('host-continue').click();

    // ---- scrubbed: the faker of a later round goes dark (the host is never the one closed) ----
    let r = await roles(agents, 1);
    if (r.faker === host) {
      await playRound(agents, host.id, 1);
      await host.page.getByTestId('host-continue').click();
      r = await roles(agents, r.no);
    }
    await closeAgent(r.faker!);
    await phaseIs(host, 'scrubbed', DARK_MS + 15_000);
    await checkRules(host, header(host.page), 'scrubbed', null);

    // ---- pause: a non-host agent goes dark next round, leaving 2 ----
    const r3 = await roles(agents, r.no);
    const leaving = r3.seated.find((a) => a !== host && a !== r3.faker)!;
    await closeAgent(leaving);
    await expect(host.page.getByTestId('paused')).toBeVisible({ timeout: DARK_MS + 15_000 });
    await shot(host.page, '12-pause-card-tools');
    await checkRules(host, host.page.getByTestId('paused'), 'paused', null);
    expect(lastState(host.frames).paused).not.toBeNull();

    // ---- final results: the host ends the game from the pause ----
    await host.page.getByTestId('paused').getByTestId('host-end-ask').click();
    await host.page.getByTestId('host-end').click();
    await phaseIs(host, 'final');
    await checkRules(host, header(host.page), 'final', 'final');
    // The host's header (with the Host button) still fits a 320 px phone.
    await host.page.setViewportSize({ width: 320, height: 568 });
    await expect(header(host.page).getByTestId('host-menu')).toBeVisible();
    expect(await header(host.page).evaluate((h) => h.scrollWidth - h.clientWidth)).toBeLessThanOrEqual(0);
    // Host, the narrator toggle, ⓘ and the room code on one row.
    const tops = await header(host.page).evaluate((h) =>
      ['host-menu', 'narrator-toggle', 'rules-open', 'header-code'].map((id) => Math.round(h.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().top + h.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().height / 2)),
    );
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
    await shot(host.page, '12-header-host-320');
  } finally {
    await closeAll(agents);
  }
});
