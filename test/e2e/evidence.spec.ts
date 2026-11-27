import { expect, test, type Page } from '@playwright/test';
import { createRoom, domStrings, hasWord, join, recordFrames, shot, stringValues, type Frames } from './round-helpers';
import { isBareWord, isWholeLiteral } from './secrecy-helpers';

/**
 * Phase 9 (plan 09 Verification): four contexts against `wrangler dev`
 * with a short Custom preset (2 s slides). Every WebSocket frame per
 * context is recorded; roles and the word come from each context's own
 * `private` frames, never from the DOM under test.
 *
 * Deterministic whoever the room picks: the context closed during the
 * draw is always a non-faker, non-host one (closing the faker would
 * cancel the round, §7), so it is a "went dark" card on every other phone.
 *
 * Round 1: at sampled mid-slide instants every context shows the same
 * slide, the one `startsAt + i × perSlide` gives; a vote (and a change)
 * in one context shows as a chip in all; no context is offered its own
 * card; a lock during the slideshow is final; free browse flips by
 * buttons, swipe and keys; the last connected lock ends browse long
 * before its timer. Round 2: everyone locks mid-slideshow and voting ends
 * at once (0016). Throughout: slideshow `state` frames change only with
 * votes or presence (no per-slide messages), no `state` carries strokes,
 * and no DOM shows the word (beyond strings the faker saw too) or a role.
 */

interface Agent {
  readonly name: string;
  readonly page: Page;
  readonly frames: Frames;
  id: string;
}

type Phase = { name: string; startsAt?: number; perSlideMs?: number; endsAt?: number };
type StateMsg = { type: 'state'; state: { seq: number; phase: Phase; round: { no: number; cards: string[] | null; votes: Record<string, string>; locked: string[]; roster: string[] } | null; players: { id: string; connected: boolean }[]; paused: unknown } };

const states = (f: Frames) => f.received.filter((m) => m.type === 'state') as unknown as StateMsg[];
const lastState = (f: Frames) => states(f).at(-1)!.state;
const hasPrivate = (f: Frames) => f.received.some((m) => m.type === 'private');
const lastPrivate = (f: Frames) =>
  (f.received.filter((m) => m.type === 'private').at(-1) as { view: { you: { id: string }; round: { no: number; role: string; word?: string } | null } }).view;

async function drag(page: Page, testId: string, from: [number, number], to: [number, number]): Promise<void> {
  const box = (await page.getByTestId(testId).boundingBox())!;
  await page.mouse.move(box.x + from[0] * box.width, box.y + from[1] * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0] * box.width, box.y + to[1] * box.height, { steps: 10 });
  await page.mouse.up();
}

const CLOCK_SKEW_MS = 7_000;
/** NAME_MAX_LENGTH (20) characters: the 568×320 check needs a name that must ellipsize. */
const LONG_NAME = 'Dee Longfellow-Smith';

const evidence = (p: Page) => p.getByTestId('evidence');
const chip = (p: Page, target: string, voter: string) => p.locator(`[data-testid="suspect"][data-target="${target}"] .vote-chip[data-voter="${voter}"]`);

/** Briefing → draw: the host continues, every live context draws a line and files it. */
async function playDraw(live: Agent[], host: Agent, before?: () => Promise<void>): Promise<void> {
  for (const p of live) await expect(p.page.getByTestId('briefing')).toBeVisible({ timeout: 30_000 });
  await host.page.getByTestId('host-continue').click();
  for (const p of live) await expect(p.page.getByTestId('draw')).toBeVisible();
  if (before) await before();
  for (const p of live) {
    await drag(p.page, 'draw-canvas', [0.2, 0.3], [0.8, 0.7]);
    await p.page.getByTestId('draw-done').click();
  }
}

test('evidence: synced slideshow, live public votes, lock-in, browse, dark card, 0016 early end', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctxs = await Promise.all([0, 1, 2, 3].map(() => browser.newContext()));
  try {
    // A missing control fails fast with its name instead of hanging until the test timeout.
    for (const c of ctxs) c.setDefaultTimeout(15_000);
    // Ava's device clock runs 7 s fast: the measured clock offset must still put her on the same slide.
    await ctxs[0]!.addInitScript((skew) => {
      const real = Date.now.bind(Date);
      Date.now = () => real() + skew;
    }, CLOCK_SKEW_MS);
    const pages = await Promise.all(ctxs.map((c) => c.newPage()));
    const agents: Agent[] = ['Ava', 'Bea', 'Cy', LONG_NAME].map((name, i) => ({ name, page: pages[i]!, frames: recordFrames(pages[i]!), id: '' }));
    const [host] = agents as [Agent];

    const code = await createRoom(host.page);
    await join(host.page, 'Ava', 'red');
    for (const [p, color] of [[agents[1]!, 'blue'], [agents[2]!, 'green'], [agents[3]!, 'purple']] as const) {
      await p.page.goto(`/join/${code}`);
      await join(p.page, p.name, color);
    }
    await host.page.getByTestId('pick-timers').getByRole('radio', { name: 'Custom' }).click();
    const custom = host.page.getByTestId('custom-timers');
    await custom.getByLabel(/^Draw/).fill('10');
    await custom.getByLabel(/^Per slide/).fill('2');
    await custom.getByLabel(/^Vote/).fill('40');
    await custom.getByLabel(/^Guess/).fill('5');
    await custom.getByRole('button', { name: 'Save timers' }).click();
    await expect(agents[3]!.page.getByTestId('settings-timers')).toContainText('slide 2 s');
    await host.page.getByTestId('start').click();

    // ---- round 1: briefing, roles from own private frames ----
    for (const p of agents) await expect(p.page.getByTestId('briefing')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => agents.every((p) => hasPrivate(p.frames) && lastPrivate(p.frames).round)).toBe(true);
    for (const p of agents) p.id = lastPrivate(p.frames).you.id;
    const roleOf = (p: Agent) => lastPrivate(p.frames).round!.role;
    const faker1 = agents.find((p) => roleOf(p) === 'faker')!;
    const word = lastPrivate(agents.find((p) => roleOf(p) === 'agent')!.frames).round!.word!;
    expect(word).toBeTruthy();
    const dark = agents.slice(1).find((p) => p !== faker1)!;
    const live = agents.filter((p) => p !== dark);

    // Close the dark context once the draw is up, before it files anything.
    await playDraw(live, host, async () => {
      await ctxs[agents.indexOf(dark)]!.close();
    });

    // ---- slideshow ----
    for (const p of live) await expect(evidence(p.page)).toHaveAttribute('data-phase', 'slideshow', { timeout: 30_000 });
    const show = lastState(host.frames);
    const { startsAt, perSlideMs, endsAt } = show.phase as Required<Phase>;
    const cards = show.round!.cards!;
    expect(cards).toHaveLength(4);
    expect(perSlideMs).toBe(2_000);
    expect(endsAt).toBe(startsAt + cards.length * 2 * perSlideMs);

    // DOM samples per round: the word differs between rounds, so each round's strings are the other's control.
    const rounds: Map<Agent, string[][]>[] = [new Map(live.map((p) => [p, []]))];
    let samples = rounds[0]!;
    const sample = async () => {
      for (const p of live) samples.get(p)!.push(await domStrings(p.page));
    };

    // Sampled instants, 0.6–1.4 s into a slide: every context shows the slide the clock says.
    let synced = 0;
    for (let k = 0; k < 4; k++) {
      const into = (Date.now() - startsAt) % perSlideMs;
      if (into < 600) await host.page.waitForTimeout(600 - into);
      else if (into > 1_400) await host.page.waitForTimeout(perSlideMs - into + 600);
      const expected = Math.floor((Date.now() - startsAt) / perSlideMs);
      if (expected >= cards.length * 2) break;
      const shown = await Promise.all(live.map((p) => p.page.getByTestId('slide').getAttribute('data-slide')));
      expect(shown, `instant ${k}`).toEqual(live.map(() => String(expected)));
      const artists = await Promise.all(live.map((p) => p.page.getByTestId('evidence-card').getAttribute('data-artist')));
      expect(new Set(artists).size).toBe(1);
      expect(artists[0]).toBe(cards[expected % cards.length]);
      // The current segment's fill matches the time into the slide (±15%), in every context.
      for (const p of live) {
        const scale = await p.page.getByTestId('slide-fill').evaluate((el) => {
          const m = getComputedStyle(el).transform.match(/matrix\(([^,]+)/);
          return m ? Number(m[1]) : 1;
        });
        const within = ((Date.now() - startsAt) % perSlideMs) / perSlideMs;
        expect(Math.abs(scale - within), `${p.name} fill ${scale} vs ${within}`).toBeLessThan(0.15);
      }
      synced++;
      if (k === 0) await shot(live[1]!.page, '01-slideshow');
      if (k === 1 && process.env.SKETCHY_SHOTS) {
        await live[0]!.page.setViewportSize({ width: 915, height: 412 });
        await shot(live[0]!.page, '01-slideshow-landscape');
        await live[0]!.page.setViewportSize({ width: 412, height: 839 });
      }
      if (k === 1) await sample();
    }
    expect(synced).toBeGreaterThanOrEqual(2);

    // Votes during the slideshow, the faker's included; one changes; each shows in every context.
    const [v1, v2, v3] = live as [Agent, Agent, Agent];
    const firstPick = (me: Agent) => live.find((p) => p !== me)!;
    for (const me of live) {
      await me.page.locator(`[data-testid="suspect"][data-target="${firstPick(me).id}"] [data-testid="suspect-vote"]`).click();
      for (const other of live) await expect(chip(other.page, firstPick(me).id, me.id)).toHaveCount(1);
    }
    // v1 changes to the dark card holder: the chip moves everywhere.
    await v1.page.locator(`[data-testid="suspect"][data-target="${dark.id}"] [data-testid="suspect-vote"]`).click();
    for (const other of live) {
      await expect(chip(other.page, dark.id, v1.id)).toHaveCount(1);
      await expect(chip(other.page, firstPick(v1).id, v1.id)).toHaveCount(0);
    }
    // No self-vote is offered: your own suspect row has no button.
    for (const me of live) {
      await expect(me.page.locator(`[data-testid="suspect"][data-target="${me.id}"] [data-testid="suspect-vote"]`)).toHaveCount(0);
      await expect(me.page.locator(`[data-testid="suspect"][data-target="${me.id}"]`)).toHaveCount(1);
    }
    // v3 locks during the slideshow: final, buttons gone, a sealed chip everywhere.
    await v3.page.getByTestId('lock-in').click();
    await expect(v3.page.getByTestId('lock-final')).toBeVisible();
    await expect(v3.page.getByTestId('suspect-vote')).toHaveCount(0);
    for (const other of live) await expect(chip(other.page, firstPick(v3).id, v3.id)).toHaveAttribute('data-locked', 'true');
    await shot(v3.page, '02-slideshow-locked');
    expect(lastState(host.frames).phase.name).toBe('slideshow');
    await sample();

    // ---- browse ----
    // Every vote intent so far was sent while the slideshow was up (none follow until browse is seen).
    const slideshowVoteSends = live.flatMap((q) => q.frames.sent).filter((m) => m.type === 'vote:set' || m.type === 'vote:lock').length;
    for (const p of live) await expect(evidence(p.page)).toHaveAttribute('data-phase', 'browse', { timeout: 30_000 });
    await expect(v1.page.getByTestId('vote-countdown')).toBeVisible();
    const browseEnds = lastState(host.frames).phase.endsAt!;
    expect(browseEnds).toBe(endsAt + 40_000);
    const pos = () => v1.page.getByTestId('browse-card').getAttribute('data-card');
    expect(await pos()).toBe('0');
    await v1.page.getByTestId('browse-next').click();
    expect(await pos()).toBe('1');
    await v1.page.getByTestId('browse-prev').click();
    await v1.page.getByTestId('browse-prev').click();
    expect(await pos()).toBe(String(cards.length - 1));
    await v1.page.keyboard.press('ArrowRight');
    expect(await pos()).toBe('0');
    // A swipe left flips forward and is not a vote, even when it ends on the drawing.
    const sentVotes = () => v1.frames.sent.filter((m) => m.type === 'vote:set').length;
    const before = sentVotes();
    await drag(v1.page, 'browse-card', [0.8, 0.5], [0.1, 0.5]);
    expect(await pos()).toBe('1');
    await v1.page.waitForTimeout(200);
    expect(sentVotes()).toBe(before);

    // Every context: the dark card says so; its own card offers no vote; tapping another drawing votes.
    for (const me of live) {
      for (let i = 0; i < cards.length; i++) {
        const card = me.page.getByTestId('evidence-card');
        const artist = await card.getAttribute('data-artist');
        if (artist === dark.id) {
          await expect(card).toHaveAttribute('data-content', 'dark');
          await expect(card).toContainText('Agent went dark');
          if (me === v2) await shot(me.page, '03-browse-dark-card');
        } else {
          await expect(card).toHaveAttribute('data-content', 'drawing');
          await expect(card.getByTestId('evidence-canvas')).toHaveAttribute('data-strokes', '1');
        }
        if (artist === me.id) await expect(card.getByTestId('evidence-vote')).toHaveCount(0);
        await me.page.getByTestId('browse-next').click();
      }
    }
    // v2 taps a drawing (not its own, not the dark one) to change its vote.
    for (;;) {
      const artist = await v2.page.getByTestId('evidence-card').getAttribute('data-artist');
      if (artist !== v2.id && artist !== dark.id && artist !== firstPick(v2).id) break;
      await v2.page.getByTestId('browse-next').click();
    }
    const tapped = (await v2.page.getByTestId('evidence-card').getAttribute('data-artist'))!;
    await v2.page.getByTestId('evidence-vote').click();
    for (const other of live) await expect(chip(other.page, tapped, v2.id)).toHaveCount(1);
    await expect(v2.page.getByTestId('evidence-vote')).toHaveAttribute('aria-pressed', 'true');
    await shot(v2.page, '04-browse-voted');
    // The canvas backing store is its layout size in device pixels (sharp, not the slide-in's scaled box).
    for (const p of live) {
      // Step past the went-dark card (no canvas) if it is up.
      while ((await p.page.getByTestId('evidence-card').getAttribute('data-content')) !== 'drawing') await p.page.getByTestId('browse-next').click();
      // The observer sizes the store after layout: poll until it has.
      await expect
        .poll(() =>
          p.page.getByTestId('evidence-canvas').evaluate((c: HTMLCanvasElement) => {
            const d = Math.min(window.devicePixelRatio || 1, 3);
            return c.width === Math.round(c.clientWidth * d) && c.height === Math.round(c.clientHeight * d) && c.clientWidth > 0;
          }),
        { message: p.name },
      )
      .toBe(true);
    }
    // A small landscape phone (568×320): the artist's name is not cut off and the hint pill stays off the drawing.
    await v2.page.setViewportSize({ width: 568, height: 320 });
    for (let i = 0; i < cards.length; i++) {
      const fit = await v2.page.getByTestId('evidence-card').evaluate((card) => {
        const name = card.querySelector('.evidence-name')!;
        const hint = card.querySelector('[data-testid="evidence-hint"]');
        const pic = card.querySelector('.evidence-pic')!.getBoundingClientRect();
        const h = hint?.getBoundingClientRect();
        const overlap = h ? !(h.bottom <= pic.top || h.top >= pic.bottom || h.right <= pic.left || h.left >= pic.right) : false;
        const css = getComputedStyle(name);
        const n = name.getBoundingClientRect();
        const tag = card.querySelector('.evidence-tag')!.getBoundingClientRect();
        return {
          text: name.textContent,
          fits: name.scrollWidth <= name.clientWidth,
          ellipsis: css.textOverflow === 'ellipsis' && css.overflowX === 'hidden' && css.whiteSpace === 'nowrap',
          inside: n.left >= tag.left && n.right <= tag.right,
          overlap,
        };
      });
      // A short name fits whole; a long one is cut with an ellipsis inside its tag, never spilling out.
      if (fit.text === LONG_NAME) expect(fit.ellipsis && fit.inside, `long name on card ${i}`).toBe(true);
      else expect(fit.fits, `name truncated on card ${i}`).toBe(true);
      expect(fit.overlap, `hint over the drawing on card ${i}`).toBe(false);
      await v2.page.getByTestId('browse-next').click();
    }
    await v2.page.evaluate(() => window.scrollTo(0, 0));
    await shot(v2.page, '06-browse-568x320');
    await v2.page.setViewportSize({ width: 412, height: 839 });
    if (process.env.SKETCHY_SHOTS) {
      await v2.page.setViewportSize({ width: 915, height: 412 });
      await v2.page.evaluate(() => window.scrollTo(0, 0));
      await shot(v2.page, '05-browse-landscape');
      await v2.page.setViewportSize({ width: 412, height: 839 });
    }
    await sample();

    // Lock v1, then v2 last: the last connected lock ends browse at once, long before its timer.
    // A double tap sends one lock, and the room refuses nothing.
    await v1.page.getByTestId('lock-in').dblclick();
    await expect(v1.page.getByTestId('lock-final')).toBeVisible();
    expect(lastState(host.frames).phase.name).toBe('browse');
    expect(v1.frames.sent.filter((m) => m.type === 'vote:lock')).toHaveLength(1);
    await v2.page.getByTestId('lock-in').click();
    for (const p of live) await expect(p.page.getByTestId('unmask')).toBeVisible({ timeout: 5_000 });
    const unmask1 = lastState(host.frames).phase;
    expect(unmask1.endsAt! - 5_000).toBeLessThan(browseEnds - 20_000);

    // ---- frames: no per-slide messages, no strokes in state ----
    for (const p of live) {
      const all = states(p.frames);
      const slides = all.filter((m) => m.state.phase.name === 'slideshow');
      expect(slides.length).toBeGreaterThan(0);
      for (let i = 1; i < slides.length; i++) {
        const [a, b] = [slides[i - 1]!.state, slides[i]!.state];
        expect(b.phase, p.name).toEqual(a.phase);
        const changed =
          JSON.stringify(a.round!.votes) !== JSON.stringify(b.round!.votes) ||
          JSON.stringify(a.round!.locked) !== JSON.stringify(b.round!.locked) ||
          JSON.stringify(a.players) !== JSON.stringify(b.players) ||
          JSON.stringify(a.paused) !== JSON.stringify(b.paused);
        expect(changed, `${p.name}: slideshow state ${i} changes nothing a vote or presence would`).toBe(true);
      }
      // Fewer slideshow states than slides (cards × 2): nothing was sent per slide.
      // At most: the opening state, one per vote intent, one presence change.
      expect(slides.length).toBeLessThanOrEqual(1 + slideshowVoteSends + 1);
      expect(slides.length).toBeLessThan(cards.length * 2);
      for (const m of p.frames.received) {
        expect(['welcome', 'state', 'private', 'pong', 'drawing', 'error'], m.type as string).toContain(m.type);
        if (m.type === 'state') {
          const json = JSON.stringify(m);
          expect(json.includes('"strokes"') || json.includes('"points"'), `${p.name}: strokes in state`).toBe(false);
        }
      }
      expect(p.frames.received.filter((m) => m.type === 'error'), p.name).toEqual([]);
    }

    // Everything faker 1 received before the result made the word public (unmask is the last state checked here).
    const faker1Frames = faker1.frames.received.length;

    // ---- round 2: everyone locks mid-slideshow, voting ends at once (0016) ----
    for (const p of live) await expect(p.page.getByTestId('results')).toBeVisible({ timeout: 20_000 });
    await host.page.getByTestId('host-continue').click();
    for (const p of live) await expect(p.page.getByTestId('briefing')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => live.every((p) => lastPrivate(p.frames).round?.no === lastState(p.frames).round?.no)).toBe(true);
    const faker2 = live.find((p) => roleOf(p) === 'faker')!;
    const word2 = lastPrivate(live.find((p) => roleOf(p) === 'agent')!.frames).round!.word!;
    samples = new Map(live.map((p) => [p, []]));
    rounds.push(samples);
    await playDraw(live, host);
    for (const p of live) await expect(evidence(p.page)).toHaveAttribute('data-phase', 'slideshow', { timeout: 30_000 });
    const show2 = lastState(host.frames).phase as Required<Phase>;
    expect(lastState(host.frames).round!.cards).toContain(dark.id);
    for (const me of live) {
      await me.page.locator(`[data-testid="suspect"][data-target="${firstPick(me).id}"] [data-testid="suspect-vote"]`).click();
      // Sample before the last lock: that lock ends voting, and the unmask screen (faker public) is not this check's.
      if (me === live.at(-1)) await sample();
      await me.page.getByTestId('lock-in').click();
    }
    for (const p of live) await expect(p.page.getByTestId('unmask')).toBeVisible({ timeout: 5_000 });
    const unmask2 = lastState(host.frames).phase;
    // Voting ended before the second pass would have: the slideshow was cut short.
    expect(unmask2.endsAt! - 5_000).toBeLessThan(show2.endsAt);

    // ---- secrecy: frames, then DOM ----
    // No string value in any frame a faker received during their round carries that round's word (the room
    // `code` excepted: a 4-letter word can equal it by chance). So the faker's DOM is a sound control below.
    for (const [faker, w, frames] of [[faker1, word, faker1.frames.received.slice(0, faker1Frames)], [faker2, word2, faker2.frames.received]] as const) {
      for (const m of frames) for (const { key, value } of stringValues(m)) if (key !== 'code') expect(hasWord(value, w), `${faker.name}: ${m.type}.${key}`).toBe(false);
    }
    const checkDom = (r: number, faker: Agent, w: string) => {
      const mine = rounds[r]!;
      const fakerStrings = new Set(mine.get(faker)!.flat());
      const agentStrings = new Set(live.filter((p) => p !== faker).flatMap((p) => mine.get(p)!.flat()));
      const otherRound = new Set([...rounds[1 - r]!.values()].flat(2));
      for (const p of live) {
        for (const strings of mine.get(p)!) {
          for (const s of strings) {
            expect(s.includes('You are the faker'), `${p.name} shows the faker line`).toBe(false);
            // Interface text may mention fakers (the page description does); only text shown to both roles is allowed.
            if (/faker/i.test(s)) expect(fakerStrings.has(s) && agentStrings.has(s), `${p.name} shows a role: ${s}`).toBe(true);
            if (!hasWord(s, w)) continue;
            expect(isBareWord(s, w), `${p.name} shows the bare word: "${s}"`).toBe(false);
            // The word can coincide with interface text ("change"): fine only if the faker saw the same string,
            // the other round (another word) showed it, or it is a whole literal in the client source.
            expect(fakerStrings.has(s) || otherRound.has(s) || isWholeLiteral(s), `${p.name} shows the word in "${s}"`).toBe(true);
          }
        }
      }
    };
    checkDom(0, faker1, word);
    checkDom(1, faker2, word2);
    for (const p of live) expect(p.frames.received.filter((m) => m.type === 'error'), p.name).toEqual([]);
  } finally {
    await Promise.all(ctxs.map((x) => x.close().catch(() => {})));
  }
});
