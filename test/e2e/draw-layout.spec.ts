import { expect, test, type Page } from '@playwright/test';
import { createRoom, join, recordFrames, shot } from './round-helpers';

/**
 * Phase 8 review round 1: the draw screen on small phones, and a drawing
 * lost on a dying socket.
 *
 * - At 360×640, 375×667 and 667×375 (landscape) the whole Done button is
 *   in the viewport and the page does not scroll, also with the
 *   "reconnecting" banner showing (8.4: the page is locked while drawing,
 *   so anything below the fold would be unreachable).
 * - A `draw:done` swallowed by a socket that then dies is sent again on
 *   the next socket; the room lists the player done and every other
 *   context receives exactly that drawing.
 */

const VIEWS = [
  { width: 360, height: 640 },
  { width: 375, height: 667 },
  { width: 667, height: 375 },
] as const;

/** Lets the test refuse new sockets (`__blockWs`) and reach the open ones (`__ws`). */
const SOCKET_CONTROL = () => {
  const Orig = WebSocket;
  const w = window as unknown as { __ws: WebSocket[]; __blockWs: boolean };
  w.__ws = [];
  w.__blockWs = false;
  window.WebSocket = class extends Orig {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(w.__blockWs ? 'ws://127.0.0.1:9/' : url, protocols);
      w.__ws.push(this);
    }
  } as typeof WebSocket;
};

async function expectDoneInView(page: Page, label: string): Promise<void> {
  const vp = page.viewportSize()!;
  const done = (await page.getByTestId('draw-done').boundingBox())!;
  expect(done.y, `${label}: Done top`).toBeGreaterThanOrEqual(0);
  expect(done.y + done.height, `${label}: Done bottom`).toBeLessThanOrEqual(vp.height);
  expect(done.x + done.width, `${label}: Done right`).toBeLessThanOrEqual(vp.width);
  const canvas = (await page.getByTestId('draw-canvas').boundingBox())!;
  expect(canvas.height, `${label}: canvas height`).toBeGreaterThanOrEqual(60);
  expect(Math.abs(canvas.width / canvas.height - 4 / 3), `${label}: 4:3`).toBeLessThan(0.03);
  expect(canvas.y + canvas.height, `${label}: canvas bottom`).toBeLessThanOrEqual(vp.height);
  // The canvas never runs under the tools (beside them in landscape, above them otherwise).
  const tools = (await page.getByTestId('draw-tools').boundingBox())!;
  const overlaps = canvas.x < tools.x + tools.width && tools.x < canvas.x + canvas.width && canvas.y < tools.y + tools.height && tools.y < canvas.y + canvas.height;
  expect(overlaps, `${label}: canvas overlaps the tools`).toBe(false);
  // And it uses the room it has: at least 40% of the viewport's height or width.
  expect(Math.max(canvas.height / vp.height, canvas.width / vp.width), `${label}: canvas size`).toBeGreaterThan(0.4);
  const scroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  expect(scroll, `${label}: page scroll`).toBeLessThanOrEqual(0);
}

test('the draw screen fits small phones, banner included, and a lost draw:done is sent again', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctxs = await Promise.all(VIEWS.map((viewport) => browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })));
  try {
    const pages = await Promise.all(ctxs.map((c) => c.newPage()));
    for (const p of pages) await p.addInitScript(SOCKET_CONTROL);
    const frames = pages.map((p) => recordFrames(p));
    const [a, b, c] = pages as [Page, Page, Page];

    const code = await createRoom(a);
    await join(a, 'Ava', 'red');
    await b.goto(`/join/${code}`);
    await join(b, 'Bea', 'blue');
    await c.goto(`/join/${code}`);
    await join(c, 'Cy', 'green');
    await a.getByTestId('pick-timers').getByRole('radio', { name: 'Custom' }).click();
    const custom = a.getByTestId('custom-timers');
    await custom.getByLabel(/^Draw/).fill('30');
    await custom.getByLabel(/^Per slide/).fill('1');
    await custom.getByLabel(/^Vote/).fill('30');
    await custom.getByRole('button', { name: 'Save timers' }).click();
    await expect(c.getByTestId('settings-timers')).toContainText('draw 30 s');
    await a.getByTestId('start').click();
    await expect(a.getByTestId('host-continue')).toBeVisible({ timeout: 20_000 });
    await shot(c, '08-briefing-landscape');
    await a.getByTestId('host-continue').click();
    for (const p of pages) await expect(p.getByTestId('draw')).toBeVisible();

    for (const [i, p] of pages.entries()) await expectDoneInView(p, `${VIEWS[i]!.width}×${VIEWS[i]!.height}`);
    await shot(c, '09-draw-landscape');
    await shot(a, '10-draw-360x640');

    // Lose contact on every phone: the banner shows and Done stays on screen.
    for (const p of pages) {
      await p.evaluate(() => {
        const w = window as unknown as { __ws: WebSocket[]; __blockWs: boolean };
        w.__blockWs = true;
        for (const s of w.__ws) s.close();
      });
    }
    for (const [i, p] of pages.entries()) {
      await expect(p.getByTestId('reconnecting')).toBeVisible();
      await expectDoneInView(p, `${VIEWS[i]!.width}×${VIEWS[i]!.height} with banner`);
    }
    await shot(b, '11-draw-reconnecting');
    for (const p of pages) await p.evaluate(() => ((window as unknown as { __blockWs: boolean }).__blockWs = false));
    for (const p of pages) await expect(p.getByTestId('reconnecting')).toHaveCount(0, { timeout: 15_000 });

    // A layout shift mid-stroke (here a 90 px block pushed in above, as a banner or pause notice would):
    // later points still land under the pointer, because the canvas rectangle is read on every move.
    const before = (await a.getByTestId('draw-canvas').boundingBox())!;
    await a.mouse.move(before.x + before.width * 0.5, before.y + before.height * 0.5);
    await a.mouse.down();
    await a.mouse.move(before.x + before.width * 0.6, before.y + before.height * 0.5, { steps: 4 });
    await a.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'layout-shift';
      d.style.cssText = 'height: 90px; flex: none;';
      const root = document.querySelector('[data-testid="draw"]') as HTMLElement;
      root.insertBefore(d, root.firstChild);
    });
    const after = (await a.getByTestId('draw-canvas').boundingBox())!;
    expect(after.y).toBeGreaterThan(before.y + 20);
    await a.mouse.move(after.x + after.width * 0.25, after.y + after.height * 0.25, { steps: 6 });
    await a.mouse.up();
    await a.evaluate(() => document.getElementById('layout-shift')!.remove());
    // Clear, then Keep: the drawing stays and focus returns to Clear.
    await a.getByTestId('clear').click();
    await a.getByTestId('clear-no').click();
    await expect(a.getByTestId('clear')).toBeFocused();

    // Bea's socket swallows her draw:done and then dies.
    await b.evaluate(() => {
      const proto = WebSocket.prototype as unknown as { send(this: WebSocket, data: unknown): void };
      const orig = proto.send;
      let dropped = false;
      proto.send = function (this: WebSocket, data: unknown) {
        if (!dropped && typeof data === 'string' && data.includes('"draw:done"')) {
          dropped = true;
          setTimeout(() => this.close(), 50);
          return;
        }
        orig.call(this, data);
      };
    });
    const box = (await b.getByTestId('draw-canvas').boundingBox())!;
    await b.mouse.move(box.x + 20, box.y + 20);
    await b.mouse.down();
    await b.mouse.move(box.x + box.width - 20, box.y + box.height - 20, { steps: 8 });
    await b.mouse.up();
    await b.getByTestId('draw-done').click();
    await expect(b.getByTestId('draw-waiting')).toBeVisible();
    // Sent again on the next socket: the room lists her done well before the 30 s deadline.
    await expect(b.getByTestId('draw-waiting')).toHaveAttribute('data-filed', 'true', { timeout: 15_000 });
    const sent = frames[1]!.sent.filter((m) => m.type === 'draw:done');
    expect(sent).toHaveLength(1);
    expect((sent[0]!.strokes as unknown[]).length).toBe(1);

    for (const p of [a, c]) await p.getByTestId('draw-done').click();
    for (const p of pages) await expect(p.getByTestId('game-phase')).toHaveAttribute('data-phase', /slideshow|browse/, { timeout: 20_000 });
    // Ava's stroke ends at the grid point a quarter of the way in, where the pointer was after the shift.
    const aSent = frames[0]!.sent.filter((m) => m.type === 'draw:done');
    expect(aSent).toHaveLength(1);
    const aStrokes = aSent[0]!.strokes as { p: number[] }[];
    expect(aStrokes).toHaveLength(1);
    const p = aStrokes[0]!.p;
    expect(Math.abs(p[p.length - 2]! - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(p[p.length - 1]! - 150)).toBeLessThanOrEqual(1);
    const bId = (frames[1]!.received.filter((m) => m.type === 'private').at(-1) as { view: { you: { id: string } } }).view.you.id;
    for (const f of [frames[0]!, frames[2]!]) {
      await expect.poll(() => f.received.filter((m) => m.type === 'drawing' && m.playerId === bId).length).toBe(1);
      expect(f.received.find((m) => m.type === 'drawing' && m.playerId === bId)!.strokes).toEqual(sent[0]!.strokes);
    }
  } finally {
    await Promise.all(ctxs.map((x) => x.close().catch(() => {})));
  }
});
