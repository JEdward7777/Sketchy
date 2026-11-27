import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Phase 4 unit 4b (stages 4.3–4.6, 4.10): the lobby in several browser
 * contexts, one per simulated player, against `wrangler dev`.
 */

async function contexts(browser: Browser, n: number): Promise<BrowserContext[]> {
  return Promise.all(Array.from({ length: n }, () => browser.newContext()));
}

async function createRoom(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a room' }).click();
  await expect(page).toHaveURL(/\/join\/[A-Z]{4}$/);
  return page.url().split('/').at(-1)!;
}

async function join(page: Page, name: string, color: string): Promise<void> {
  const form = page.getByTestId('join-form');
  await expect(form).toBeVisible();
  await form.getByLabel('Code name').fill(name);
  await form.locator(`[data-color="${color}"]`).click();
  await form.getByRole('button', { name: 'Join the mission' }).click();
  await expect(page.getByTestId('lobby')).toBeVisible();
}

const chips = (page: Page) => page.getByTestId('player-list').getByTestId('player-chip');

test('three agents create, join with distinct colors, and share one lobby', async ({ browser }) => {
  const ctxs = await contexts(browser, 3);
  try {
    const [a, b, c] = await Promise.all(ctxs.map((x) => x.newPage())) as [Page, Page, Page];

    const code = await createRoom(a);
    await join(a, 'Ava', 'red');
    await expect(a.getByTestId('room-code')).toHaveText(code);
    await expect(a.getByTestId('join-link')).toHaveText(`http://127.0.0.1:8799/join/${code}`);
    await expect(a.getByTestId('qr').locator('svg')).toBeVisible();
    // wrangler dev on 127.0.0.1: phones could not reach this QR link.
    await expect(a.getByTestId('loopback-warning')).toBeVisible();

    // B types the code in lower case on the landing page.
    await b.goto('/');
    await b.getByLabel('Room code').fill(code.toLowerCase());
    await b.getByRole('button', { name: 'Join room' }).click();
    await expect(b).toHaveURL(new RegExp(`/join/${code}$`));
    await expect(b.getByTestId('join-form').locator('[data-color="red"]')).toBeDisabled();
    await join(b, 'Bea', 'blue');

    // C opens the QR link directly; both taken colors are disabled.
    await c.goto(`/join/${code}`);
    const cForm = c.getByTestId('join-form');
    await expect(cForm.locator('[data-color="red"]')).toBeDisabled();
    await expect(cForm.locator('[data-color="blue"]')).toBeDisabled();
    await expect(cForm.locator('[data-color="green"]')).toBeEnabled();
    await join(c, 'Cy', 'green');

    for (const p of [a, b, c]) {
      await expect(chips(p)).toHaveCount(3);
      await expect(chips(p).locator('.chip-name')).toHaveText(['Ava', 'Bea', 'Cy']);
      await expect(chips(p).first().locator('.tag-host')).toBeVisible();
    }
    await expect(a.getByTestId('start')).toBeEnabled();
    await expect(b.getByTestId('start')).toHaveCount(0);
    await expect(b.getByTestId('waiting-for-host')).toContainText('Ava');

    // B reloads and comes back as the same agent, not a fourth one.
    await b.reload();
    await expect(b.getByTestId('lobby')).toBeVisible();
    await expect(chips(b)).toHaveCount(3);
    await expect(chips(b).nth(1).locator('.tag-you')).toBeVisible();
    await expect(chips(a)).toHaveCount(3);
    await expect(chips(a).nth(1)).toHaveAttribute('data-state', 'online');

    // The host's settings reach everyone.
    await expect(b.getByTestId('settings-difficulty')).toHaveText('Mixed');
    await expect(b.getByTestId('game-length')).toHaveText('2 cycles × 3 agents = 6 rounds');
    await a.getByTestId('pick-difficulty').getByRole('radio', { name: 'Abstract' }).click();
    await a.getByTestId('pick-cycles').getByRole('radio', { name: '3' }).click();
    await a.getByTestId('pick-timers').getByRole('radio', { name: 'Custom' }).click();
    for (const p of [b, c]) {
      await expect(p.getByTestId('settings-difficulty')).toHaveText('Abstract');
      await expect(p.getByTestId('game-length')).toHaveText('3 cycles × 3 agents = 9 rounds');
      await expect(p.getByTestId('settings-timers')).toContainText('Custom: draw 60 s');
    }
    // Custom values inside the 0022 bounds are saved; outside them Save stays off.
    const custom = a.getByTestId('custom-timers');
    await custom.getByLabel(/^Draw/).fill('4');
    await expect(custom.getByRole('button', { name: 'Save timers' })).toBeDisabled();
    await custom.getByLabel(/^Draw/).fill('5');
    await custom.getByLabel(/^Per slide/).fill('1');
    await custom.getByRole('button', { name: 'Save timers' }).click();
    await expect(c.getByTestId('settings-timers')).toHaveText('Custom: draw 5 s · slide 1 s · vote 45 s · guess 30 s');

    // Start: everyone leaves the lobby for the game placeholder.
    await a.getByTestId('start').click();
    for (const p of [a, b, c]) {
      await expect(p.getByTestId('game-phase')).toHaveAttribute('data-phase', /dealing|briefing|draw/);
    }
  } finally {
    await Promise.all(ctxs.map((x) => x.close()));
  }
});

test('a new device rejoins as an agent who went dark; the host may remove', async ({ browser }) => {
  test.setTimeout(60_000);
  const ctxs = await contexts(browser, 3);
  try {
    const [a, b, c] = await Promise.all(ctxs.map((x) => x.newPage())) as [Page, Page, Page];
    const code = await createRoom(a);
    await join(a, 'Ava', 'red');
    await b.goto(`/join/${code}`);
    await join(b, 'Bea', 'blue');
    await expect(chips(a)).toHaveCount(2);

    // Bea's phone dies: after the blip grace she shows as gone dark.
    await ctxs[1]!.close();
    await expect(chips(a).nth(1)).toHaveAttribute('data-state', 'offline', { timeout: 20_000 });
    await expect(chips(a).nth(1).getByRole('button', { name: 'Remove' })).toBeVisible();

    // A borrowed phone picks her from "Rejoin as…" and carries on as Bea.
    await c.goto(`/join/${code}`);
    const rejoin = c.getByTestId('rejoin-as');
    await expect(rejoin.getByTestId('player-chip')).toHaveCount(1);
    await rejoin.getByRole('button', { name: "That's me" }).click();
    await expect(c.getByTestId('lobby')).toBeVisible();
    await expect(chips(c).nth(1).locator('.tag-you')).toBeVisible();
    await expect(chips(a).nth(1)).toHaveAttribute('data-state', 'online');
    await expect(chips(a)).toHaveCount(2);
  } finally {
    await Promise.all(ctxs.map((x) => x.close().catch(() => {})));
  }
});

test('a code nobody created sends the device back to the landing page', async ({ page }) => {
  await page.goto('/join/ZZZZ');
  await expect(page.getByTestId('landing')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('landing-notice')).toContainText('ZZZZ');
  await expect(page).toHaveURL(/\/$/);
});

test('mid-round, "Rejoin as…" waits for the host to let the device in (0024)', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxs = await contexts(browser, 4);
  try {
    const [a, b, c, d] = await Promise.all(ctxs.map((x) => x.newPage())) as [Page, Page, Page, Page];
    const code = await createRoom(a);
    await join(a, 'Ava', 'red');
    await b.goto(`/join/${code}`);
    await join(b, 'Bea', 'blue');
    await c.goto(`/join/${code}`);
    await join(c, 'Cy', 'green');
    // Deterministic: drop Cy only once voting is open. A drop during the
    // briefing or draw cancels the round if Cy is the faker (§7), so wait
    // for the slideshow: short draw, long slides and vote.
    await a.getByTestId('pick-timers').getByRole('radio', { name: 'Custom' }).click();
    const custom = a.getByTestId('custom-timers');
    await custom.getByLabel(/^Draw/).fill('5');
    await custom.getByLabel(/^Per slide/).fill('10');
    await custom.getByLabel(/^Vote/).fill('180');
    await custom.getByRole('button', { name: 'Save timers' }).click();
    await expect(b.getByTestId('settings-timers')).toContainText('draw 5 s · slide 10 s · vote 180 s');
    await a.getByTestId('start').click();
    // Briefing auto-continues (BRIEFING_BEAT_MS), nobody submits a drawing, so
    // the slideshow starts after the 5 s draw plus DRAW_SUBMIT_GRACE_MS.
    await expect(a.getByTestId('game-phase')).toHaveAttribute('data-phase', /slideshow|browse/, { timeout: 30_000 });

    await ctxs[2]!.close();
    await expect(a.getByTestId('player-list').getByTestId('player-chip').nth(2)).toHaveAttribute('data-state', 'offline', { timeout: 20_000 });

    await d.goto(`/join/${code}`);
    await d.getByTestId('rejoin-as').getByRole('button', { name: "That's me" }).click();
    await expect(d.getByTestId('rejoin-pending')).toContainText('Cy');
    const requests = a.getByTestId('rejoin-requests');
    await expect(requests.getByTestId('player-chip')).toHaveCount(1);
    await requests.getByRole('button', { name: 'Let in' }).click();
    await expect(d.getByTestId('game-phase')).toBeVisible();
    await expect(requests).toHaveCount(0);
  } finally {
    await Promise.all(ctxs.map((x) => x.close().catch(() => {})));
  }
});

test('a stale token on this device shows the join form with an explanation', async ({ page }) => {
  const code = await createRoom(page);
  await join(page, 'Ava', 'red');
  // Another browser profile that once held a token the room never issued.
  const ctx = await page.context().browser()!.newContext();
  try {
    const other = await ctx.newPage();
    await other.goto('/');
    await other.evaluate((c) => {
      localStorage.setItem(`sketchy:token:${c}`, JSON.stringify({ token: 'not-a-real-token', at: Date.now() }));
    }, code);
    await other.goto(`/join/${code}`);
    await expect(other.getByTestId('join-form')).toBeVisible();
    await expect(other.getByTestId('join-error')).toContainText('HQ lost your file');
    expect(await other.evaluate((c) => localStorage.getItem(`sketchy:token:${c}`), code)).toBeNull();
  } finally {
    await ctx.close();
  }
});
