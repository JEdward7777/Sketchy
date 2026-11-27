import { expect, test } from '@playwright/test';
import { shot } from './round-helpers';
import {
  DARK_MS,
  PIXEL_7,
  SIZES,
  assertFramesSecret,
  closeAgent,
  closeAll,
  lastState,
  layoutProblems,
  openAgent,
  roles,
  skipBriefing,
  startGame,
  type Agent,
} from './fairness-helpers';

/**
 * Phase 11 review round 1: the pause screen with its fullest contents fits
 * small portrait phones and short landscape ones (SIZES) with nothing
 * overlapping, chip names never squeezed to nothing and the card inside the
 * viewport. Two cases: the host with a pending "Rejoin as…" request (0024)
 * and a dark agent to remove; then, after the host drops, an agent with
 * the 0010 claim on the pause screen.
 */

const TIMERS = { draw: 120, slide: 1, vote: 30, guess: 5 };

async function fits(page: Agent['page'], label: string): Promise<void> {
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    expect(await layoutProblems(page, '.pause-card', '.pause-main > *, .pause-side > *'), `${label} at ${w}×${h}`).toEqual([]);
    if (w === 740) await shot(page, `f11-${label}-${w}x${h}`);
  }
  await page.setViewportSize(PIXEL_7);
}

test('the pause screen fits small and landscape phones: host with a rejoin request, agent with the host claim', async ({ browser }) => {
  test.setTimeout(180_000);
  const { code, agents } = await startGame(browser, ['Ava', 'Bea', 'Cy'], TIMERS);
  let device: Agent | null = null;
  try {
    const [host, ...others] = agents as [Agent, ...Agent[]];
    const r1 = await roles(agents);
    await skipBriefing(host);
    for (const p of agents) await expect(p.page.getByTestId('draw')).toBeVisible({ timeout: 30_000 });
    // A non-faker drops (a faker drop would scrub, §7); the round pauses with two agents left.
    const gone = others.find((a) => a !== r1.faker)!;
    await closeAgent(gone);
    await expect(host.page.getByTestId('paused')).toBeVisible({ timeout: DARK_MS });

    // A borrowed phone asks to rejoin as them mid-round: the host's pause screen has the request.
    device = await openAgent(browser, gone.name, gone.color);
    await device.page.goto(`/join/${code}`);
    await device.page.getByTestId('rejoin-as').getByRole('button', { name: "That's me" }).click();
    await expect(device.page.getByTestId('rejoin-pending')).toContainText(gone.name);
    const pause = host.page.getByTestId('paused');
    await expect(pause.getByTestId('rejoin-requests')).toBeVisible();
    await expect(pause.getByTestId('pause-dark')).toContainText(gone.name);
    // The heading says they went dark; the chip carries no second tag.
    await expect(pause.getByTestId('pause-dark').locator('.tag-offline')).toHaveCount(0);
    await fits(host.page, 'pause-host-request');

    // Let in: the round resumes with the borrowed phone in the seat.
    await pause.getByRole('button', { name: 'Let in' }).click();
    await expect(host.page.getByTestId('paused')).toHaveCount(0, { timeout: 15_000 });
    await expect(device.page.getByTestId('draw')).toBeVisible();

    // The host's phone dies: below 3 again, and the claim is on the pause screen (after a scrub if the host was faker).
    await closeAgent(host);
    const agent = agents.find((a) => a.open && a !== gone)!;
    const claim = agent.page.getByTestId('paused').getByTestId('claim-host');
    await expect(claim).toBeVisible({ timeout: DARK_MS + 10_000 });
    await fits(agent.page, 'pause-claim');
    await claim.getByRole('button', { name: 'Take over as host' }).click();
    await expect(agent.page.getByTestId('paused').getByTestId('host-end-ask')).toBeVisible();
    expect(lastState(agent.frames).hostId).toBe(agent.id);
    assertFramesSecret([...agents, device]);
  } finally {
    await closeAll(device ? [...agents, device] : agents);
  }
});
