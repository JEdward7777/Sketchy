import { expect, test, type Page } from '@playwright/test';
import { assertFakerDomClean, createRoom, domStrings, hasWord, join, recordFrames, roleBlindMarkup, shot, stringValues, type Frames } from './round-helpers';

/**
 * Phase 8 (plan 08 Verification): three contexts play the briefing and the
 * draw against `wrangler dev` with a short Custom preset. Every WebSocket
 * frame per context is recorded.
 *
 * Deterministic whatever the room picks: the test learns the faker and
 * the word from each context's own `private` frames (never from the DOM it
 * checks), and every step is the same for every role.
 *
 * - The faker's context never receives the word, in any frame.
 * - Outside a held envelope, no context's DOM contains the word or the
 *   faker line, during briefing and draw. The word can coincide with
 *   interface text (the deck has "envelope", "eraser", "secret"…), so a DOM
 *   string containing it passes only if the faker's DOM, which never had
 *   the word, also showed that exact string.
 * - Pressing the envelope reveals the right letter; release and blur hide
 *   it; the host's envelope press is not a `host:hold` (0017) and any other
 *   tap is.
 * - Synthetic pointer strokes produce `draw:done` lists the room accepts,
 *   by Done, after Clear, and by the deadline, and every other context
 *   receives exactly each list in a `drawing` frame once the slideshow
 *   starts, never before.
 */

const FAKER_LINE = 'You are the faker!';

interface Agent {
  readonly name: string;
  readonly page: Page;
  readonly frames: Frames;
}

const privates = (f: Frames) =>
  f.received.filter((m) => m.type === 'private') as { view: { you: { id: string }; round: { role: string; word?: string; category: string } | null } }[];

const lastState = (f: Frames) =>
  (f.received.filter((m) => m.type === 'state').at(-1) as { state: { seq: number; phase: { name: string }; round: { done: string[] } | null } } | undefined)?.state;

async function drag(page: Page, from: [number, number], to: [number, number], steps = 12): Promise<void> {
  const box = (await page.getByTestId('draw-canvas').boundingBox())!;
  const at = ([fx, fy]: [number, number]) => [box.x + fx * box.width, box.y + fy * box.height] as const;
  const [x0, y0] = at(from);
  const [x1, y1] = at(to);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps });
  await page.mouse.up();
}

test('briefing and draw: secrecy per context, the envelope, the host continue, strokes delivered at the slideshow', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctxs = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  try {
    const pages = await Promise.all(ctxs.map((c) => c.newPage()));
    const agents: Agent[] = ['Ava', 'Bea', 'Cy'].map((name, i) => ({ name, page: pages[i]!, frames: recordFrames(pages[i]!) }));
    const [a, b, c] = agents as [Agent, Agent, Agent];

    const code = await createRoom(a.page);
    await join(a.page, 'Ava', 'red');
    for (const [p, name, color] of [[b, 'Bea', 'blue'], [c, 'Cy', 'green']] as const) {
      await p.page.goto(`/join/${code}`);
      await join(p.page, name, color);
    }
    // Short Custom preset: 15 s draw (room for the strokes below), 1 s slides.
    await a.page.getByTestId('pick-timers').getByRole('radio', { name: 'Custom' }).click();
    const custom = a.page.getByTestId('custom-timers');
    await custom.getByLabel(/^Draw/).fill('15');
    await custom.getByLabel(/^Per slide/).fill('1');
    await custom.getByLabel(/^Vote/).fill('30');
    await custom.getByRole('button', { name: 'Save timers' }).click();
    await expect(c.page.getByTestId('settings-timers')).toContainText('draw 15 s · slide 1 s · vote 30 s');
    await a.page.getByTestId('start').click();

    // ---- briefing ----
    for (const p of agents) await expect(p.page.getByTestId('briefing')).toBeVisible({ timeout: 20_000 });
    // The host taps the page (not Continue, not the envelope): a hold, so the briefing waits for the checks below.
    const holds = () => a.frames.sent.filter((m) => m.type === 'host:hold').length;
    await a.page.locator('.round-title').click();
    await expect.poll(holds).toBe(1);
    await expect(a.page.getByTestId('auto-continue-status')).toContainText('On hold');

    // Roles from each context's own private frames.
    const roles = agents.map((p) => privates(p.frames).at(-1)?.view.round);
    expect(roles.every((r) => r)).toBe(true);
    const fakers = agents.filter((_, i) => roles[i]!.role === 'faker');
    expect(fakers).toHaveLength(1);
    const faker = fakers[0]!;
    const words = new Set(roles.filter((r) => r!.role === 'agent').map((r) => r!.word));
    expect(words.size).toBe(1);
    const word = [...words][0]!;
    expect(word).toBeTruthy();
    const ids = new Map(agents.map((p) => [p, privates(p.frames).at(-1)!.view.you.id]));
    const category = roles[0]!.category;
    for (const p of agents) await expect(p.page.getByTestId('category')).toContainText(category);
    // Identical when not held: the same closed envelope markup on every phone, and the
    // same briefing screen (classes, attributes, text) modulo names, digits and the host's footer.
    const closed = await Promise.all(agents.map((p) => p.page.getByTestId('envelope').evaluate((e) => e.outerHTML)));
    expect(new Set(closed).size).toBe(1);
    const names = agents.map((p) => p.name);
    const briefings = await Promise.all(agents.map((p) => roleBlindMarkup(p.page, 'briefing', names)));
    expect(new Set(briefings).size, 'briefing markup differs between players').toBe(1);

    const samples = new Map<Agent, string[][]>(agents.map((p) => [p, []]));
    const sample = async () => {
      for (const p of agents) {
        await expect(p.page.getByTestId('envelope-letter')).toHaveCount(0);
        samples.get(p)!.push(await domStrings(p.page));
        if (p === faker) await assertFakerDomClean(p.page, word);
      }
    };
    await sample();
    await shot(c.page, '01-briefing');
    await shot(a.page, '02-briefing-host');

    // Hold to reveal, release to hide; the host's press is not a hold (0017).
    for (const p of agents) {
      const env = p.page.getByTestId('envelope');
      const box = (await env.boundingBox())!;
      await p.page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
      await p.page.mouse.down();
      await expect(p.page.getByTestId('envelope-line')).toHaveText(p === faker ? FAKER_LINE : word);
      await expect(p.page.getByTestId('envelope-letter')).toContainText(category);
      if (p === c) await shot(p.page, p === faker ? '03-briefing-held-faker' : '03-briefing-held');
      await p.page.mouse.up();
      await expect(p.page.getByTestId('envelope-letter')).toHaveCount(0);
    }
    // Losing focus mid-hold hides it too (8.3.1).
    {
      const env = b.page.getByTestId('envelope');
      const box = (await env.boundingBox())!;
      await b.page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
      await b.page.mouse.down();
      await expect(b.page.getByTestId('envelope-letter')).toHaveCount(1);
      await b.page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await expect(b.page.getByTestId('envelope-letter')).toHaveCount(0);
      await b.page.mouse.up();
    }
    if (process.env.SKETCHY_SHOTS && faker !== c) {
      // A faker's held letter, for the owner's screenshots.
      const p = faker.page;
      const box = (await p.getByTestId('envelope').boundingBox())!;
      await p.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
      await p.mouse.down();
      await shot(p, '03-briefing-held-faker');
      await p.mouse.up();
    }
    expect(holds()).toBe(1);
    await sample();

    // Continue at once, with the seq it was shown in (0004 rules 4 and 6).
    const seq = lastState(a.frames)!.seq;
    await a.page.getByTestId('host-continue').click();
    await expect.poll(() => a.frames.sent.filter((m) => m.type === 'host:next')).toEqual([{ type: 'host:next', seq }]);

    // ---- draw ----
    for (const p of agents) await expect(p.page.getByTestId('draw')).toBeVisible();
    const draws = await Promise.all(agents.map((p) => roleBlindMarkup(p.page, 'draw', names)));
    expect(new Set(draws).size, 'draw markup differs between players').toBe(1);
    await sample();
    await shot(b.page, '04-draw-empty');

    // Ava: two strokes and a dot in red, then Done early.
    await a.page.getByTestId('color-2').click();
    await drag(a.page, [0.1, 0.1], [0.9, 0.2]);
    await a.page.getByTestId('size-2').click();
    await drag(a.page, [0.2, 0.8], [0.8, 0.5], 20);
    const abox = (await a.page.getByTestId('draw-canvas').boundingBox())!;
    await a.page.mouse.click(abox.x + 30, abox.y + 30);
    await a.page.getByTestId('draw-done').click();
    await expect(a.page.getByTestId('draw-waiting')).toBeVisible();
    await expect(a.page.locator(`[data-testid="done-list"] li[data-player="${ids.get(a)}"]`)).toHaveAttribute('data-done', 'true');
    await expect(a.page.locator(`[data-testid="done-list"] li[data-player="${ids.get(b)}"]`)).toHaveAttribute('data-done', 'false');

    // Cy: a stroke, Clear (confirmed), then Done with an empty canvas.
    await drag(c.page, [0.3, 0.3], [0.6, 0.6]);
    await c.page.getByTestId('clear').click();
    await expect(c.page.getByTestId('clear-confirm')).toBeVisible();
    await c.page.getByTestId('clear-yes').click();
    await expect(c.page.getByTestId('undo')).toBeDisabled();
    await c.page.getByTestId('draw-done').click();
    await expect(c.page.getByTestId('draw-waiting')).toBeVisible();
    await expect(a.page.locator(`[data-testid="done-list"] li[data-player="${ids.get(c)}"]`)).toHaveAttribute('data-done', 'true');
    await shot(a.page, '05-draw-waiting');

    // Bea: a stroke, undo, two more (one with the eraser), the mini envelope, then no Done: the deadline sends it.
    await drag(b.page, [0.5, 0.1], [0.5, 0.9]);
    await b.page.getByTestId('undo').click();
    await b.page.getByTestId('color-6').click();
    await drag(b.page, [0.1, 0.5], [0.9, 0.5]);
    await b.page.getByTestId('eraser').click();
    await drag(b.page, [0.5, 0.4], [0.5, 0.6]);
    const mini = b.page.getByTestId('envelope-mini');
    const mbox = (await mini.boundingBox())!;
    await b.page.mouse.move(mbox.x + mbox.width / 2, mbox.y + mbox.height / 2);
    await b.page.mouse.down();
    await expect(b.page.getByTestId('envelope-line')).toHaveText(b === faker ? FAKER_LINE : word);
    await shot(b.page, '06-draw-mini-envelope-held');
    await b.page.mouse.up();
    await expect(b.page.getByTestId('envelope-letter')).toHaveCount(0);
    await shot(b.page, '07-draw-strokes');
    await sample();
    expect(b.frames.sent.some((m) => m.type === 'draw:done')).toBe(false);

    // ---- slideshow (phase 9's evidence screen) ----
    for (const p of agents) {
      await expect(p.page.getByTestId('evidence')).toHaveAttribute('data-phase', /slideshow|browse/, { timeout: 30_000 });
    }

    // Each context sent exactly one draw:done; every other context received exactly that list, after the slideshow state.
    for (const from of agents) {
      const done = from.frames.sent.filter((m) => m.type === 'draw:done');
      expect(done, from.name).toHaveLength(1);
      const strokes = done[0]!.strokes as { c: number; s: number; p: number[] }[];
      if (from === c) expect(strokes).toEqual([]);
      else expect(strokes.length, from.name).toBeGreaterThan(0);
      for (const to of agents) {
        if (to === from) continue;
        await expect.poll(() => to.frames.received.filter((m) => m.type === 'drawing' && m.playerId === ids.get(from)).length).toBe(1);
        const i = to.frames.received.findIndex((m) => m.type === 'drawing' && m.playerId === ids.get(from));
        expect(to.frames.received[i]!.strokes, `${from.name} → ${to.name}`).toEqual(strokes);
        const opened = to.frames.received.findIndex((m) => m.type === 'state' && (m.state as { phase: { name: string } }).phase.name === 'slideshow');
        expect(opened).toBeGreaterThanOrEqual(0);
        expect(i).toBeGreaterThan(opened);
      }
    }
    // Bea's went by the deadline: the room listed her done.
    expect(lastState(a.frames)!.round!.done).toContain(ids.get(b));

    // The faker's context never received the word: no string value carries it (the room code is the one public string a 4-letter word can equal by chance).
    for (const m of faker.frames.received) {
      for (const { key, value } of stringValues(m)) if (key !== 'code') expect(hasWord(value, word), `${m.type}.${key}`).toBe(false);
      if (m.type === 'private') expect((m as { view: { round: { word?: string } | null } }).view.round?.word).toBeUndefined();
    }
    for (const p of agents) expect(p.frames.received.filter((m) => m.type === 'error'), p.name).toEqual([]);

    // DOM outside a held envelope: never the faker line; the word only in strings the faker's DOM showed too.
    const fakerStrings = new Set(samples.get(faker)!.flat());
    for (const p of agents) {
      for (const strings of samples.get(p)!) {
        for (const s of strings) {
          expect(s.includes(FAKER_LINE), `${p.name}: ${s}`).toBe(false);
          if (hasWord(s, word)) expect(fakerStrings.has(s), `${p.name} shows the word in "${s}"`).toBe(true);
        }
      }
    }
    expect(samples.get(a)!.length).toBe(4);
  } finally {
    await Promise.all(ctxs.map((x) => x.close().catch(() => {})));
  }
});
