import { expect, test } from '@playwright/test';
import { shot } from './round-helpers';
import {
  DARK_MS,
  FAKER_LINE,
  assertDomSecret,
  assertFramesSecret,
  closeAgent,
  closeAll,
  joinLate,
  lastPrivate,
  lastState,
  peek,
  playRound,
  reopenAgent,
  roles,
  skipBriefing,
  startGame,
  type Agent,
} from './fairness-helpers';

/**
 * Phase 11 (plan 11 Verification, stages 11.7.3 and 11.7.4): who is seated
 * when. A removed agent keeps a greyed score and is reinstated from the
 * next round after coming back (0019); a late joiner waits on deck and is
 * seated from the next round (0020 item 4). Several contexts against
 * `wrangler dev` with a short Custom preset; roles from each context's own
 * `private` frames.
 */

const TIMERS = { draw: 120, slide: 1, vote: 30, guess: 5 };

test('11.7.3: the host removes an agent who went dark; the score stays, greyed; they come back and are seated next round', async ({ browser }) => {
  test.setTimeout(300_000);
  const { agents } = await startGame(browser, ['Ava', 'Bea', 'Cy', 'Dee'], TIMERS);
  try {
    const host = agents[0]!;
    const r1 = await playRound(agents, host.id);
    await host.page.getByTestId('host-continue').click();

    // Round 2: an agent who is neither the faker nor the host drops mid-draw.
    const r2 = await roles(agents, r1.no);
    await skipBriefing(host);
    for (const p of r2.seated) await expect(p.page.getByTestId('draw')).toBeVisible({ timeout: 30_000 });
    const gone = r2.seated.find((a) => a !== r2.faker && a !== host)!;
    const score = lastState(host.frames).players.find((p) => p.id === gone.id)!.score;
    const token = await closeAgent(gone);

    // The host removes them from the draw screen, through the header's host menu.
    const menu = host.page.getByTestId('host-menu');
    await expect(menu).toHaveAccessibleName(/1 waiting on you/, { timeout: DARK_MS });
    await menu.click();
    const tools = host.page.getByTestId('host-tools');
    await tools.getByRole('button', { name: `Remove ${gone.name}` }).click();
    await expect(tools.locator(`[data-player="${gone.id}"]`)).toHaveAttribute('data-state', 'removed');
    await expect(tools.locator(`[data-player="${gone.id}"] [data-testid="chip-score"]`)).toHaveText(`${score} ${score === 1 ? 'pt' : 'pts'}`);
    await shot(host.page, 'f07-host-removed');
    await tools.getByTestId('host-menu-close').click();

    // The round goes on with the other three; the removed agent's score shows greyed.
    const rest = agents.filter((a) => a.open);
    const r2done = await playRound(rest, host.id, r1.no);
    expect(r2done.no).toBe(r2.no);
    for (const p of rest) {
      const row = p.page.locator(`[data-testid="score-row"][data-player="${gone.id}"]`);
      await expect(row).toHaveAttribute('data-removed', 'true');
      await expect(row).toHaveAttribute('data-score', String(score));
      expect(Number(await row.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(1);
    }
    await shot(host.page, 'f08-results-removed-greyed');

    // Their phone comes back with its token between rounds: reinstated with the same score. They sat in
    // round 2 until removed (0019 item 4), so the results are theirs too and no on-deck line shows.
    await reopenAgent(browser, gone, token);
    await expect(gone.page.getByTestId('results')).toBeVisible();
    await expect(gone.page.getByTestId('on-deck')).toHaveCount(0);
    await expect.poll(() => lastState(gone.frames).players.find((p) => p.id === gone.id)).toMatchObject({ removed: false, connected: true, score });
    expect(lastPrivate(gone.frames)!.you.id).toBe(gone.id);
    await shot(gone.page, 'f09-returned-results');

    await host.page.getByTestId('host-continue').click();
    const r3 = await roles(agents, r2.no);
    expect(r3.seated).toContain(gone);
    await expect(gone.page.getByTestId('briefing')).toBeVisible();
    await expect(gone.page.getByTestId('on-deck')).toHaveCount(0);
    expect(await peek(gone.page, 'envelope')).toBe(gone === r3.faker ? FAKER_LINE : r3.word);
    await assertDomSecret(agents.map((a) => a.page), r3.word);
    assertFramesSecret(agents);
  } finally {
    await closeAll(agents);
  }
});

test('11.7.4: a late joiner waits on deck, then plays from the next round', async ({ browser }) => {
  test.setTimeout(240_000);
  const { code, agents } = await startGame(browser, ['Ava', 'Bea', 'Cy'], TIMERS);
  let late: Agent | null = null;
  try {
    const host = agents[0]!;
    const r1 = await roles(agents);
    await skipBriefing(host);
    for (const p of agents) await expect(p.page.getByTestId('draw')).toBeVisible({ timeout: 30_000 });

    late = await joinLate(browser, code, 'Lou', 'orange');
    await expect(late.page.getByTestId('draw-ondeck')).toBeVisible();
    await expect(late.page.getByTestId('on-deck')).toContainText('on deck');
    expect(lastPrivate(late.frames)!.round).toBeNull();
    const s = lastState(late.frames);
    expect(s.round!.roster).not.toContain(late.id);
    expect(s.players.find((p) => p.id === late!.id)).toMatchObject({ seated: false, connected: true, score: 0 });
    // Late joiners never change the game length (0020 item 2).
    expect(s.progress).toEqual({ completed: 0, total: 3 });
    await assertDomSecret([late.page], r1.word);
    await shot(late.page, 'f10-late-on-deck');

    const everyone = [...agents, late];
    await playRound(everyone, host.id);
    await expect(late.page.getByTestId('results')).toBeVisible();
    await expect(late.page.getByTestId('on-deck')).toContainText('next round');

    await host.page.getByTestId('host-continue').click();
    const r2 = await roles(everyone, r1.no);
    expect(r2.seated).toContain(late);
    await expect(late.page.getByTestId('briefing')).toBeVisible();
    await expect(late.page.getByTestId('on-deck')).toHaveCount(0);
    expect(await peek(late.page, 'envelope')).toBe(late === r2.faker ? FAKER_LINE : r2.word);
    expect(lastState(late.frames).progress).toEqual({ completed: 1, total: 3 });
    // Seated now: the late joiner draws like everyone else.
    await skipBriefing(host);
    await expect(late.page.getByTestId('draw')).toBeVisible({ timeout: 30_000 });
    await assertDomSecret(everyone.map((a) => a.page), r2.word);
    assertFramesSecret(everyone);
  } finally {
    await closeAll(late ? [...agents, late] : agents);
  }
});
