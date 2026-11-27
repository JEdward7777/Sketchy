import { devices, expect, test } from '@playwright/test';
import { NARRATION_CAP_MS } from '../../src/shared/core/rules';
import { closeAll, lastState, playRound, roles, startGame, type Agent } from './fairness-helpers';
import { engineState, narrationFrames, spoken, stallSpeech, stubSpeech } from './narrator-helpers';
import { shot } from './round-helpers';

/**
 * Phase 12 narrator (stages 12.1.1–12.1.4, `SPEC.md` §3, §10, decision
 * 0004 rule 2), with a fake `speechSynthesis` in every context (TTS itself
 * is the owner's phone check, 12.1.5): on by default for the host only; a
 * player can turn it on; lines are spoken on phase changes; only the
 * host's device sends `host:narration`, only where the room listens
 * (briefing, round results) and only while its toggle is on; a stalled
 * line is reported stopped by the client timeout, inside the server cap.
 */

test.setTimeout(240_000);

test('12.1: narrator defaults, lines on phase changes, the host-only speaking signal and its timeout', async ({ browser }) => {
  const sentAt = new Map<Agent, { at: number; speaking: boolean }[]>();
  const { agents } = await startGame(
    browser,
    ['Maya', 'Theo', 'Ana'],
    { draw: 20, slide: 1, vote: 30, guess: 5 },
    {
      start: false,
      setup: async (a) => {
        await stubSpeech(a.ctx);
        const log: { at: number; speaking: boolean }[] = [];
        sentAt.set(a, log);
        a.page.on('websocket', (ws) =>
          ws.on('framesent', (f) => {
            const m = JSON.parse(String(f.payload)) as { type: string; speaking?: boolean };
            if (m.type === 'host:narration') log.push({ at: Date.now(), speaking: m.speaking! });
          }),
        );
      },
    },
  );
  try {
    const [host, theo, ana] = agents as [Agent, Agent, Agent];
    const toggle = (a: Agent) => a.page.getByTestId('room').locator('header').getByTestId('narrator-toggle');

    // 12.1.2: on for the host, off for everyone else, by default.
    await expect(toggle(host)).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle(theo)).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle(ana)).toHaveAttribute('aria-pressed', 'false');
    await host.page.evaluate(() => scrollTo(0, 0));
    await shot(host.page, '12-toggle-lobby-host');

    // A player turns it on: it says so, and the choice is kept on the device.
    await toggle(theo).click();
    await expect(toggle(theo)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await spoken(theo.page)).length).toBe(1);
    expect(await theo.page.evaluate(() => localStorage.getItem('sketchy:narrator'))).toBe('on');
    // Lobby taps primed speech (a silent utterance) without saying anything on the other phones.
    expect(await spoken(ana.page)).toEqual([]);

    // ---- the briefing: the room listens to the host's narrator ----
    await host.page.getByTestId('start').click();
    await expect(host.page.getByTestId('briefing')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => narrationFrames(host.frames), { timeout: 10_000 }).toEqual([true, false]);
    const hostLines = await spoken(host.page);
    expect(hostLines.length).toBe(1);
    // Theo (turned on) hears a line too; Ana (off by default) hears nothing.
    await expect.poll(async () => (await spoken(theo.page)).length).toBe(2);
    expect(await spoken(ana.page)).toEqual([]);
    // Lines are public-state only: none names the category before the briefing showed it, none the word.
    const r1 = await roles(agents);
    for (const line of [...hostLines, ...(await spoken(theo.page))]) expect(line.text.toLowerCase()).not.toContain(r1.word.toLowerCase());

    // Tapping the narrator toggle (off, then on) on the host's briefing is not a 0004 hold. Turning it on says
    // "narrator online", which the room hears as narration like any line.
    await toggle(host).tap();
    await expect(toggle(host)).toHaveAttribute('aria-pressed', 'false');
    await toggle(host).tap();
    await expect(toggle(host)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => narrationFrames(host.frames)).toEqual([true, false, true, false]);
    expect(host.frames.sent.filter((m) => m.type === 'host:hold'), 'toggle taps are not holds').toEqual([]);
    // Control: a tap elsewhere on the host's briefing is a hold, so the check above can fail.
    await host.page.getByTestId('briefing').locator('h2').first().tap();
    await expect.poll(() => host.frames.sent.filter((m) => m.type === 'host:hold').length).toBe(1);

    // ---- the draw: spoken, but the room does not listen here, so no frames ----
    await host.page.getByTestId('host-continue').click();
    await expect(host.page.getByTestId('draw')).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await spoken(host.page)).length).toBe(3);
    expect(narrationFrames(host.frames)).toEqual([true, false, true, false]);

    // ---- round results with a stalled engine: the client timeout reports it stopped ----
    await stallSpeech(host.page, true);
    await playRound(agents, host.id);
    // The results line's start and stop (a further line, say a resume after a blip, may add more pairs).
    await expect.poll(() => narrationFrames(host.frames).length, { timeout: NARRATION_CAP_MS + 5_000 }).toBeGreaterThanOrEqual(6);
    const log = sentAt.get(host)!;
    // Starts and stops always alternate.
    expect(log.map((e) => e.speaking)).toEqual(log.map((_, i) => i % 2 === 0));
    const stalledFor = log[5]!.at - log[4]!.at;
    // Never reported by the engine: stopped by the budget, which is over the margin and inside the server cap.
    expect(stalledFor).toBeGreaterThan(1_500);
    expect(stalledFor).toBeLessThanOrEqual(NARRATION_CAP_MS + 500);
    await stallSpeech(host.page, false);
    await host.page.evaluate(() => scrollTo(0, 0));
    await shot(host.page, '12-toggle-results-host');

    // Only the host ever sends the signal.
    expect(narrationFrames(theo.frames)).toEqual([]);
    expect(narrationFrames(ana.frames)).toEqual([]);
    expect((await spoken(theo.page)).length).toBeGreaterThan(2);

    // ---- the host mutes: no lines and no frames from then on ----
    await toggle(host).click();
    await expect(toggle(host)).toHaveAttribute('aria-pressed', 'false');
    expect(await host.page.evaluate(() => localStorage.getItem('sketchy:narrator'))).toBe('off');
    const linesBefore = (await spoken(host.page)).length;
    const framesBefore = narrationFrames(host.frames).length;
    const theoBefore = (await spoken(theo.page)).length;
    await host.page.getByTestId('host-continue').click();
    await expect.poll(() => lastState(host.frames).round?.no ?? 0, { timeout: 20_000 }).toBe(2);
    await expect(host.page.getByTestId('briefing')).toBeVisible({ timeout: 20_000 });
    // Theo still narrates the new briefing; the host stays quiet.
    await expect.poll(async () => (await spoken(theo.page)).length).toBeGreaterThan(theoBefore);
    expect((await spoken(host.page)).length).toBe(linesBefore);
    expect(narrationFrames(host.frames).length).toBe(framesBefore);

    // A reload keeps the device's choice.
    await host.page.reload();
    await expect(toggle(host)).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await closeAll(agents);
  }
});

test('12.1.3: a touch primes speech, a reload needs a new tap, and priming stops once speech has played', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  try {
    await stubSpeech(ctx);
    const page = await ctx.newPage();
    await page.goto('/');
    expect((await engineState(page)).unlocked).toBe(false);

    // The Create tap (a touch, so no pointerdown activation) unlocks it with a silent line.
    await page.getByRole('button', { name: 'Create a room' }).tap();
    await expect(page).toHaveURL(/\/join\/[A-Z]{4}$/);
    await expect.poll(async () => (await engineState(page)).unlocked).toBe(true);
    expect((await engineState(page)).primers).toBeGreaterThanOrEqual(1);
    // Never tried outside an activation (a touch's pointerdown has none; iOS would ignore that attempt for good).
    expect((await engineState(page)).blocked).toEqual([]);
    expect(await spoken(page)).toEqual([]);

    // A reload is a fresh page: locked again until the next tap (the Join tap here).
    await page.reload();
    expect((await engineState(page)).unlocked).toBe(false);
    const form = page.getByTestId('join-form');
    await form.getByLabel('Code name').fill('Maya');
    await form.locator('[data-color="red"]').tap();
    await form.getByRole('button', { name: 'Join the mission' }).tap();
    await expect(page.getByTestId('lobby')).toBeVisible();
    await expect.poll(async () => (await engineState(page)).unlocked).toBe(true);

    // Primed: the host's toggle taps speak out loud (off, then on: "narrator online").
    const toggle = page.getByTestId('room').locator('header').getByTestId('narrator-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.tap();
    await toggle.tap();
    await expect.poll(async () => (await spoken(page)).length).toBe(1);
    // Once primed, taps stop sending silent primers.
    const primers = (await engineState(page)).primers;
    await toggle.tap();
    await toggle.tap();
    await expect.poll(async () => (await spoken(page)).length).toBe(2);
    expect((await engineState(page)).primers).toBe(primers);
  } finally {
    await ctx.close();
  }
});
