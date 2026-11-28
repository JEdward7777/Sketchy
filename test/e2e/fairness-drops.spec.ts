import { expect, test } from '@playwright/test';
import { domStrings, shot } from './round-helpers';
import {
  DARK_MS,
  FAKER_LINE,
  PIXEL_7,
  SIZES,
  assertDomSecret,
  assertFramesSecret,
  closeAgent,
  closeAll,
  joinLate,
  lastPrivate,
  lastState,
  layoutProblems,
  peek,
  playRound,
  reopenAgent,
  roles,
  skipBriefing,
  startGame,
  states,
  type Agent,
} from './fairness-helpers';

/**
 * Phase 11 (plan 11 Verification, stages 11.7.1, 11.7.2, 11.7.5 and the
 * 0010 host claim): drops, reloads and returns across several browser
 * contexts against `wrangler dev` with a short Custom preset. A long draw
 * (120 s) keeps each drop inside the draw; who drops is picked from the
 * contexts' own `private` frames, so each test holds whoever the room
 * picks as faker.
 */

const TIMERS = { draw: 120, slide: 1, vote: 30, guess: 5 };

const noScrub = (agents: readonly Agent[]) => agents.every((a) => states(a.frames).every((s) => s.phase.name !== 'scrubbed'));
const everDark = (agents: readonly Agent[], id: string) => agents.some((a) => states(a.frames).some((s) => s.players.some((p) => p.id === id && !p.connected)));

/** Skip the briefing from the host's screen when the host is here; otherwise it continues by itself. */
async function toDraw(agents: readonly Agent[], seated: readonly Agent[]): Promise<void> {
  const host = agents.find((a) => a.open && a.id === lastState(a.frames).hostId);
  if (host) await skipBriefing(host);
  for (const p of seated) await expect(p.page.getByTestId('draw')).toBeVisible({ timeout: 30_000 });
}

test('11.7.1: a reload mid-draw returns the same player, score and envelope; a faker reload inside the grace keeps the round', async ({ browser }) => {
  test.setTimeout(240_000);
  const { agents } = await startGame(browser, ['Ava', 'Bea', 'Cy'], TIMERS);
  try {
    const host = agents[0]!;
    // Round 1 first, so the scores carried across the reload are not all zero.
    const r1 = await playRound(agents, host.id);
    await host.page.getByTestId('host-continue').click();
    const r2 = await roles(agents, r1.no);
    await toDraw(agents, r2.seated);
    const before = lastState(host.frames).players;
    expect(before.some((p) => p.score > 0)).toBe(true);

    // An agent (not the faker) reloads mid-draw.
    const agent = r2.seated.find((a) => a !== r2.faker)!;
    await agent.page.reload();
    await expect(agent.page.getByTestId('draw')).toBeVisible();
    expect(lastPrivate(agent.frames)!.you.id).toBe(agent.id);
    expect(lastState(agent.frames).players.find((p) => p.id === agent.id)!.score).toBe(before.find((p) => p.id === agent.id)!.score);
    expect(await peek(agent.page)).toBe(r2.word);
    await shot(agent.page, 'f01-reloaded-agent-draw');

    // The faker reloads too, inside the blip grace: the round goes on, the envelope still says faker.
    const faker = r2.faker!;
    await faker.page.reload();
    await expect(faker.page.getByTestId('draw')).toBeVisible();
    expect(lastPrivate(faker.frames)!.you.id).toBe(faker.id);
    expect(await peek(faker.page)).toBe(FAKER_LINE);
    for (const a of agents) {
      const s = lastState(a.frames);
      expect(s.phase.name).toBe('draw');
      expect(s.round!.no).toBe(r2.no);
      expect(s.players.map((p) => p.score)).toEqual(before.map((p) => p.score));
    }
    expect(noScrub(agents)).toBe(true);
    // A reload inside the grace never shows as a disconnect (0012 item 2).
    expect(everDark(agents, agent.id) || everDark(agents, faker.id)).toBe(false);

    for (const p of r2.seated) await p.page.getByTestId('draw-done').click();
    for (const p of agents) await expect(p.page.getByTestId('evidence')).toBeVisible({ timeout: 30_000 });
    await assertDomSecret(agents.map((a) => a.page), r2.word);
    assertFramesSecret(agents);
  } finally {
    await closeAll(agents);
  }
});

test('11.7.2: the faker drops during the draw; the round is scrubbed and the next round picks a fresh faker', async ({ browser }) => {
  test.setTimeout(180_000);
  const { agents } = await startGame(browser, ['Ava', 'Bea', 'Cy', 'Dee'], TIMERS);
  try {
    const r1 = await roles(agents);
    await toDraw(agents, r1.seated);
    const faker = r1.faker!;
    await closeAgent(faker);
    const rest = agents.filter((a) => a.open);

    for (const p of rest) await expect(p.page.getByTestId('scrubbed')).toBeVisible({ timeout: DARK_MS });
    const scrubbed = lastState(rest[0]!.frames);
    expect(scrubbed.round!.faker).toBeNull();
    expect(scrubbed.progress).toEqual({ completed: 0, total: 4 });
    for (const p of rest) {
      await expect(p.page.getByTestId('scrubbed-countdown')).toBeVisible();
      // Generic wording (0012 item 3): the cancel screen names nobody and never says "faker".
      const card = await p.page.locator('.scrubbed-card').evaluate((el) => el.textContent ?? '');
      for (const a of agents) expect(card).not.toContain(a.name);
      expect(card.toLowerCase()).not.toContain('faker');
      const all = (await domStrings(p.page)).join('\n');
      expect(all).not.toContain(FAKER_LINE);
    }
    await assertDomSecret(rest.map((a) => a.page), r1.word);
    await shot(rest[0]!.page, 'f02-scrubbed');

    // The next round: a fresh random faker from the connected roster (0020 item 3), never the dropped one.
    const r2 = await roles(agents, r1.no);
    expect(r2.faker).not.toBeNull();
    expect(r2.faker).not.toBe(faker);
    for (const p of rest) await expect(p.page.getByTestId('briefing')).toBeVisible();
    expect(lastState(rest[0]!.frames).progress).toEqual({ completed: 0, total: 4 });
    assertFramesSecret(agents);
  } finally {
    await closeAll(agents);
  }
});

test('11.7.5: dropping below 3 pauses the round; a late joiner shows the restart wait; a rejoin resumes', async ({ browser }) => {
  test.setTimeout(180_000);
  const { code, agents } = await startGame(browser, ['Ava', 'Bea', 'Cy'], TIMERS);
  let late: Agent | null = null;
  // A big-screen display watches too (12.4): it shows the pause and its end, and is never counted as an agent.
  const tvCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, isMobile: false, hasTouch: false });
  try {
    const tv = await tvCtx.newPage();
    await tv.goto(`/display/${code}`);
    const r1 = await roles(agents);
    await toDraw(agents, r1.seated);
    await expect(tv.getByTestId('display')).toHaveAttribute('data-phase', 'draw');
    // Not the faker (that would scrub the round, §7), and the host when no one else is left.
    const host = agents[0]!;
    const gone = agents.find((a) => a !== r1.faker && a !== host) ?? agents.find((a) => a !== r1.faker)!;
    // Focus sits on Done before the pause; it comes back there on resume.
    await host.page.getByTestId('draw-done').focus();
    const token = await closeAgent(gone);
    const rest = agents.filter((a) => a.open);

    for (const p of rest) {
      const pause = p.page.getByTestId('paused');
      await expect(pause).toBeVisible({ timeout: DARK_MS });
      await expect(pause).toHaveAttribute('data-kind', 'round');
      await expect(pause.getByTestId('pause-dark')).toContainText(gone.name);
      // Only the host (or a claimed host) can end it from here.
      const isHost = lastState(p.frames).hostId === p.id;
      await expect(pause.getByTestId('host-end-ask')).toHaveCount(isHost ? 1 : 0);
      // The screen underneath, the header and its host menu are inert: their controls cannot be reached.
      expect(await p.page.locator('.game-frame').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
      expect(await p.page.locator('header').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
    }
    await expect(tv.getByTestId('display-paused')).toBeVisible();
    await expect(tv.getByTestId('display-paused')).toContainText('Mission paused');
    await shot(tv, 'display-11-paused');
    // Frozen: the draw countdown does not move (0011 item 3).
    const t0 = await rest[0]!.page.getByTestId('countdown').textContent();
    await rest[0]!.page.waitForTimeout(2_500);
    expect(await rest[0]!.page.getByTestId('countdown').textContent()).toBe(t0);
    await shot(rest[0]!.page, 'f03-paused');
    // Focus moves onto the pause screen, so a screen reader announces it.
    expect(await rest[0]!.page.evaluate(() => document.activeElement?.id)).toBe('pause-title');

    // A newcomer arrives: the pause screen now shows the 0025 restart wait.
    late = await joinLate(browser, code, 'Lou', 'orange');
    await expect(late.page.getByTestId('paused')).toBeVisible();
    for (const p of rest) await expect(p.page.getByTestId('pause-restart')).toContainText(/standing by/);
    await shot(rest[0]!.page, 'f04-paused-restart-wait');

    // The dropped agent's phone comes back with its token well inside RESTART_WAIT_MS: the same round resumes.
    await reopenAgent(browser, gone, token);
    for (const p of [...rest, gone, late]) await expect(p.page.getByTestId('paused')).toHaveCount(0, { timeout: 15_000 });
    for (const p of [...rest, gone]) await expect(p.page.getByTestId('draw')).toBeVisible();
    await expect(tv.getByTestId('display-paused')).toHaveCount(0);
    await expect.poll(() => host.page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('draw-done');
    expect(lastState(gone.frames).round!.no).toBe(r1.no);
    expect(await peek(gone.page)).toBe(r1.word);
    await expect(late.page.getByTestId('on-deck')).toBeVisible();
    expect(lastPrivate(late.frames)!.round).toBeNull();
    expect(noScrub([...agents, late])).toBe(true);
    await assertDomSecret([...rest, late].map((a) => a.page), r1.word);
    assertFramesSecret([...agents, late]);
  } finally {
    await tvCtx.close().catch(() => {});
    await closeAll(late ? [...agents, late] : agents);
  }
});

test('0010: while the host is gone, a connected agent takes over; the new host can remove the old one', async ({ browser }) => {
  test.setTimeout(180_000);
  const { agents } = await startGame(browser, ['Ava', 'Bea', 'Cy', 'Dee'], TIMERS);
  try {
    const r1 = await roles(agents);
    await toDraw(agents, r1.seated);
    const [host, bea, ...others] = agents as [Agent, Agent, ...Agent[]];
    await closeAgent(host);
    // Whatever the phase (a faker host's drop scrubs the round), every connected agent is offered the role.
    for (const p of [bea, ...others]) await expect(p.page.getByTestId('claim-host')).toBeVisible({ timeout: DARK_MS });
    await shot(bea.page, 'f05-claim-host');
    await bea.page.getByTestId('claim-host').getByRole('button', { name: 'Take over as host' }).click();
    for (const p of [bea, ...others]) await expect(p.page.getByTestId('claim-host')).toHaveCount(0);
    await expect.poll(() => lastState(bea.frames).hostId).toBe(bea.id);
    for (const p of others) await expect(p.page.getByTestId('host-menu')).toHaveCount(0);

    // The new host's menu: the old host went dark, so Remove is offered and keeps their score.
    const menu = bea.page.getByTestId('host-menu');
    await expect(menu).toHaveAccessibleName(/waiting on you/);
    await menu.click();
    const tools = bea.page.getByTestId('host-tools');
    await expect(tools).toBeVisible();
    await shot(bea.page, 'f06-host-menu');
    for (const [w, h] of SIZES) {
      await bea.page.setViewportSize({ width: w, height: h });
      expect(await layoutProblems(bea.page, '.host-dialog', '.host-dialog-body > *'), `host dialog at ${w}×${h}`).toEqual([]);
    }
    await bea.page.setViewportSize(PIXEL_7);
    await tools.getByRole('button', { name: `Remove ${host.name}` }).click();
    await expect.poll(() => lastState(bea.frames).players.find((p) => p.id === host.id)!.removed).toBe(true);
    await expect(tools.locator(`[data-player="${host.id}"]`)).toHaveAttribute('data-state', 'removed');
    await tools.getByTestId('host-menu-close').click();
    await expect(tools).toBeHidden();
    assertFramesSecret(agents);
  } finally {
    await closeAll(agents);
  }
});
