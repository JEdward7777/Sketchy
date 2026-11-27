import { expect, test, type Browser, type BrowserContext } from '@playwright/test';

/** Stage 1.6.3: the shell loads for N players, each in its own browser context. */
const PLAYERS = 3;

async function contexts(browser: Browser, n: number): Promise<BrowserContext[]> {
  return Promise.all(Array.from({ length: n }, () => browser.newContext()));
}

test('the shell loads in N contexts and each completes the handshake', async ({ browser }) => {
  const ctxs = await contexts(browser, PLAYERS);
  try {
    const pages = await Promise.all(ctxs.map((c) => c.newPage()));
    await Promise.all(pages.map((p) => p.goto('/')));
    // Stage 4.2: a room exists only once created; a hello to an unknown code gets no_room.
    const created = await pages[0]!.request.post('/api/room');
    expect(created.status()).toBe(201);
    const { code } = (await created.json()) as { code: string };

    for (const page of pages) {
      await expect(page.getByRole('heading', { name: 'Sketchy' })).toBeVisible();
      await expect(page.getByTestId('landing')).toBeVisible();
      const welcome = await page.evaluate(async (room) => {
        const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws/${room}`);
        const msg = await new Promise<unknown>((resolve, reject) => {
          ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', v: 1 }));
          ws.onmessage = (e) => resolve(JSON.parse(String(e.data)));
          ws.onerror = () => reject(new Error('socket error'));
        });
        ws.close();
        return msg;
      }, code);
      expect(welcome).toMatchObject({ type: 'welcome', v: 1 });
    }
  } finally {
    await Promise.all(ctxs.map((c) => c.close()));
  }
});

test('the PWA is installable-shaped: manifest, icons, service worker', async ({ page }) => {
  await page.goto('/');
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBe('/manifest.webmanifest');
  const manifest = await (await page.request.get(manifestHref!)).json();
  expect(manifest).toMatchObject({ name: 'Sketchy', display: 'standalone', start_url: '/' });
  for (const icon of manifest.icons as { src: string }[]) {
    const res = await page.request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()['content-type'], icon.src).toContain('image/png');
  }
  const scriptURL = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL);
  expect(scriptURL).toMatch(/\/sw\.js$/);
});

test('with the service worker in control, the shell comes from it and /api never does', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  const shell = await page.goto('/');
  expect(shell?.fromServiceWorker()).toBe(true);

  const [api] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/health')),
    page.evaluate(() => fetch('/api/health')),
  ]);
  expect(api.fromServiceWorker()).toBe(false);
  expect(api.status()).toBe(200);
});

test('after one visit the shell opens offline, on any app path', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.context().setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sketchy' })).toBeVisible();
    // A room link never visited before still gets the one cached shell.
    await page.goto('/join/OFFL');
    await expect(page.getByRole('heading', { name: 'Sketchy' })).toBeVisible();
  } finally {
    await page.context().setOffline(false);
  }
});

test('the service worker never caches fallback HTML or lets it replace the shell', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // Without the worker, the asset layer answers a missing file with the SPA
  // shell (200 text/html); the worker turns that into a 404 and caches nothing.
  const direct = await page.request.get('/assets/missing-abc.js');
  expect(direct.status()).toBe(200);
  expect(direct.headers()['content-type']).toContain('text/html');
  const viaWorker = await page.evaluate(async () => (await fetch('/assets/missing-abc.js')).status);
  expect(viaWorker).toBe(404);

  // Opening a non-HTML file as a page must not overwrite the cached shell.
  await page.goto('/manifest.webmanifest');
  await page.goto('/');
  const cached = await page.evaluate(async () => {
    const cache = await caches.open('sketchy-shell-v1');
    const shell = await cache.match('/');
    const keys = (await cache.keys()).map((r) => new URL(r.url).pathname);
    return { shellType: shell?.headers.get('content-type') ?? null, keys };
  });
  expect(cached.shellType).toContain('text/html');
  expect(cached.keys).not.toContain('/assets/missing-abc.js');
});

test('navigations: /api is the Worker, unknown app paths get the shell', async ({ page }) => {
  // A browser navigation is what the SPA fallback would otherwise swallow.
  // Bare /api and /ws are listed in run_worker_first separately from /api/*
  // and /ws/*; without them the SPA fallback answers with the shell.
  for (const path of ['/api/no-such-endpoint', '/api', '/ws']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    expect(res?.headers()['content-type'], path).toContain('application/json');
    expect(await res?.json(), path).toEqual({ error: 'not_found' });
  }

  const deep = await page.goto('/join/ABCD');
  expect(deep?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Sketchy' })).toBeVisible();
});
