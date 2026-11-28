import { expect, test, type Page } from '@playwright/test';
import { closeAll, drag, roles, skipBriefing, startGame } from './fairness-helpers';
import { shot } from './round-helpers';

/**
 * O-18 / O-20 (stage 12.3): on a short landscape phone (568×320) the draw,
 * evidence, guess and judging screens have no header row, so the header
 * folds into a floating briefcase button. From it the host reaches the
 * host menu, and everyone the ⓘ rules and the narrator toggle. The button
 * sits clear of every control and picture on those screens.
 */

const SHORT = { width: 568, height: 320 };

/** Boxes of the visible controls and pictures that the floating button overlaps by more than a pixel. */
async function overlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const t = document.querySelector('[data-testid="tools-toggle"]')!.getBoundingClientRect();
    const out: string[] = [];
    const header = document.querySelector('.room-header');
    for (const el of Array.from(document.querySelectorAll('button, a, input, canvas, .category-badge, .countdown, .evidence-card, .guess-card, .lock-bar, .slide-progress'))) {
      if (header?.contains(el)) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const w = Math.min(t.right, b.right) - Math.max(t.left, b.left);
      const h = Math.min(t.bottom, b.bottom) - Math.max(t.top, b.top);
      if (w > 1 && h > 1) out.push(`${el.tagName}.${el.className} (${el.getAttribute('data-testid') ?? ''})`);
    }
    return out;
  });
}

/** Wait for the panel's opening animation to end: mid-animation it is scaled down and would measure as fitting. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => (a as CSSAnimation).animationName === 'tools-in').map((a) => a.finished)));
}

/** The whole element inside the viewport, measured once the opening animation has ended. */
async function inView(page: Page, testId: string): Promise<void> {
  await settled(page);
  const vp = page.viewportSize()!;
  const b = await page.getByTestId(testId).first().boundingBox();
  expect(b, `${testId} has a box`).not.toBeNull();
  expect(b!.x >= -0.5 && b!.y >= -0.5 && b!.x + b!.width <= vp.width + 0.5 && b!.y + b!.height <= vp.height + 0.5, `${testId} on screen at ${vp.width}×${vp.height}: ${JSON.stringify(b)}`).toBe(true);
}

/** Open the tools, check each control, open and close the rules (and the host menu for the host), fold the tools. */
async function checkTools(page: Page, isHost: boolean, label: string): Promise<void> {
  const toggle = page.getByTestId('tools-toggle');
  await expect(toggle, `${label}: tools button`).toBeVisible();
  await expect(page.getByTestId('rules-open')).toBeHidden();
  expect(await overlaps(page), `${label}: the tools button covers nothing`).toEqual([]);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  for (const id of ['narrator-toggle', 'rules-open', 'header-code', ...(isHost ? ['host-menu'] : [])]) {
    await expect(page.getByTestId(id), `${label}: ${id}`).toBeVisible();
    await inView(page, id);
  }
  await shot(page, `tools-${label}`);
  // The narrator toggle flips and stays flipped.
  const before = await page.getByTestId('narrator-toggle').getAttribute('aria-pressed');
  await page.getByTestId('narrator-toggle').click();
  await expect(page.getByTestId('narrator-toggle')).not.toHaveAttribute('aria-pressed', before!);
  await page.getByTestId('narrator-toggle').click();
  await page.getByTestId('rules-open').click();
  await expect(page.getByTestId('rules-scoring')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('rules-scoring')).toBeHidden();
  if (isHost) {
    if (!(await page.getByTestId('host-menu').isVisible())) await toggle.click();
    await page.getByTestId('host-menu').click();
    await expect(page.getByTestId('host-tools').getByTestId('player-list')).toBeVisible();
    await page.getByTestId('host-menu-close').click();
    await expect(page.getByTestId('host-tools')).toBeHidden();
  }
  // A tap elsewhere folds it.
  if ((await toggle.getAttribute('aria-expanded')) === 'true') {
    await page.mouse.click(4, SHORT.height - 4);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(page.getByTestId('rules-open')).toBeHidden();
}

test('short landscape: the tools button reaches the host menu, ⓘ and the narrator on draw, evidence, guess and judging', async ({ browser }) => {
  test.setTimeout(150_000);
  const { agents } = await startGame(browser, ['Ava', 'Bea', 'Cy'], { draw: 60, slide: 3, vote: 60, guess: 60 });
  const host = agents[0]!;
  try {
    for (const a of agents) await a.page.setViewportSize(SHORT);
    const r = await roles(agents);
    await skipBriefing(host);
    // Portrait screens and the briefing keep the header row: no tools button there.
    for (const a of agents) await expect(a.page.getByTestId('draw')).toBeVisible({ timeout: 20_000 });
    const guest = agents.find((a) => a !== host)!;

    await checkTools(host.page, true, 'draw-host');
    await checkTools(guest.page, false, 'draw-agent');
    // The canvas still draws after all that.
    for (const a of agents) {
      await drag(a.page);
      await a.page.getByTestId('draw-done').click();
    }

    await expect(host.page.getByTestId('evidence')).toHaveAttribute('data-phase', 'slideshow', { timeout: 20_000 });
    await checkTools(host.page, true, 'slideshow-host');
    await expect(host.page.getByTestId('evidence')).toHaveAttribute('data-phase', 'browse', { timeout: 30_000 });
    await checkTools(host.page, true, 'browse-host');
    await checkTools(guest.page, false, 'browse-agent');
    for (const a of agents) {
      const target = a === r.faker ? agents.find((q) => q !== a)! : r.faker!;
      await a.page.locator(`[data-testid="suspect"][data-target="${target.id}"] [data-testid="suspect-vote"]`).click();
      await a.page.getByTestId('lock-in').click();
    }

    await expect(host.page.getByTestId('guess')).toBeVisible({ timeout: 30_000 });
    await checkTools(host.page, true, 'guess-host');
    await checkTools(r.faker!.page, r.faker === host, 'guess-faker');
    await r.faker!.page.getByTestId('guess-input').fill(`${r.word}qq`);
    await r.faker!.page.getByTestId('guess-submit').click();

    await expect(host.page.getByTestId('judging')).toBeVisible({ timeout: 20_000 });
    const judge = agents.find((a) => a !== r.faker)!;
    await checkTools(host.page, true, 'judging-host');
    await checkTools(judge.page, judge === host, 'judging-judge');
    // The jury's buttons are still whole and on screen.
    await inView(judge.page, 'judge-accept');
    await inView(judge.page, 'judge-reject');
    // Other short landscape phones: the host's open panel fits on screen (it opens leftward from mid-screen here).
    for (const size of [{ width: 667, height: 375 }, { width: 740, height: 360 }, { width: 844, height: 390 }, { width: 932, height: 430 }]) {
      await host.page.setViewportSize(size);
      const toggle = host.page.getByTestId('tools-toggle');
      await expect(toggle).toBeVisible();
      expect(await overlaps(host.page), `judging ${size.width}: the tools button covers nothing`).toEqual([]);
      await toggle.click();
      for (const id of ['host-menu', 'narrator-toggle', 'rules-open', 'header-code']) await inView(host.page, id);
      await shot(host.page, `tools-judging-host-${size.width}`);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    }
    await host.page.setViewportSize(SHORT);

    // Portrait: the ordinary header, no floating button.
    await host.page.setViewportSize({ width: 412, height: 839 });
    await expect(host.page.getByTestId('tools-toggle')).toBeHidden();
    await expect(host.page.getByTestId('rules-open')).toBeVisible();
  } finally {
    await closeAll(agents);
  }
});
