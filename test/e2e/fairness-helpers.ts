import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createRoom, domStrings, hasWord, join, stringValues, type Frames } from './round-helpers';
import { isBareWord, isWholeLiteral } from './secrecy-helpers';

/**
 * Helpers for the phase-11 fairness E2E (fairness*.spec.ts): N contexts in
 * one room with a short Custom preset, closing a context (a phone that dies)
 * and reopening one with the same stored token (the same phone coming back),
 * roles and words from each context's own `private` frames, and the
 * recorded-frame secrecy check. Every scenario is written relative to
 * whoever the room picked as faker.
 */

export const FAKER_LINE = 'You are the faker!';
/** `BLIP_GRACE_MS` plus slack: how long a closed context takes to show as gone dark. */
export const DARK_MS = 25_000;

export interface Agent {
  readonly name: string;
  readonly color: string;
  ctx: BrowserContext;
  page: Page;
  /** Every frame of every page this agent has had, reopened ones included. */
  readonly frames: Frames;
  id: string;
  open: boolean;
}

export type State = {
  seq: number;
  code: string;
  hostId: string | null;
  phase: { name: string; endsAt?: number };
  paused: { since: number } | null;
  players: { id: string; name: string; connected: boolean; removed: boolean; seated: boolean; score: number }[];
  progress: { completed: number; total: number } | null;
  round: { no: number; roster: string[]; faker: string | null; cards: string[] | null; result: { word: string } | null } | null;
};
type PrivateRound = { no: number; role: 'agent' | 'faker'; word?: string; category: string };
type PrivateView = { you: { id: string }; round: PrivateRound | null };

export const states = (f: Frames) => f.received.filter((m) => m.type === 'state').map((m) => (m as unknown as { state: State }).state);
export const lastState = (f: Frames) => states(f).at(-1)!;
export const privates = (f: Frames) => f.received.filter((m) => m.type === 'private').map((m) => (m as unknown as { view: PrivateView }).view);
export const lastPrivate = (f: Frames) => privates(f).at(-1);

/** A recorder whose arrays are shared by every page an agent opens. */
function sharedRecorder(page: Page, frames: Frames): void {
  const parse = (payload: string | Buffer) => JSON.parse(String(payload)) as Record<string, unknown>;
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => frames.received.push(parse(f.payload)));
    ws.on('framesent', (f) => frames.sent.push(parse(f.payload)));
  });
}

export async function openAgent(browser: Browser, name: string, color: string): Promise<Agent> {
  const frames: Frames = { received: [], sent: [] };
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(15_000);
  const page = await ctx.newPage();
  sharedRecorder(page, frames);
  return { name, color, ctx, page, frames, id: '', open: true };
}

/** Timers for `custom-timers` in seconds. */
export interface Timers {
  draw: number;
  slide: number;
  vote: number;
  guess: number;
}

/** A room with `names.length` agents (the first is the host), Custom timers and 1 cycle, started. `setup` runs on each context before it opens a page. */
export async function startGame(
  browser: Browser,
  names: readonly string[],
  timers: Timers,
  opts: { start?: boolean; setup?: (a: Agent) => Promise<void> } = {},
): Promise<{ code: string; agents: Agent[] }> {
  const colors = ['red', 'blue', 'green', 'purple', 'orange', 'teal'];
  const agents = await Promise.all(names.map((n, i) => openAgent(browser, n, colors[i]!)));
  // Before any page loads: init scripts (a stubbed speech engine, stored settings) apply from the first navigation.
  if (opts.setup) for (const a of agents) await opts.setup(a);
  const host = agents[0]!;
  const code = await createRoom(host.page);
  await join(host.page, host.name, host.color);
  for (const a of agents.slice(1)) {
    await a.page.goto(`/join/${code}`);
    await join(a.page, a.name, a.color);
  }
  await host.page.getByTestId('pick-cycles').getByRole('radio', { name: '1' }).click();
  await host.page.getByTestId('pick-timers').getByRole('radio', { name: 'Custom' }).click();
  const custom = host.page.getByTestId('custom-timers');
  await custom.getByLabel(/^Draw/).fill(String(timers.draw));
  await custom.getByLabel(/^Per slide/).fill(String(timers.slide));
  await custom.getByLabel(/^Vote/).fill(String(timers.vote));
  await custom.getByLabel(/^Guess/).fill(String(timers.guess));
  await custom.getByRole('button', { name: 'Save timers' }).click();
  await expect(agents.at(-1)!.page.getByTestId('settings-timers')).toContainText(`draw ${timers.draw} s`);
  for (const a of agents) a.id = lastPrivate(a.frames)!.you.id;
  if (opts.start !== false) await host.page.getByTestId('start').click();
  return { code, agents };
}

/** A context joining with the join form while a game is under way (a late joiner). */
export async function joinLate(browser: Browser, code: string, name: string, color: string): Promise<Agent> {
  const a = await openAgent(browser, name, color);
  await a.page.goto(`/join/${code}`);
  const form = a.page.getByTestId('join-form');
  await expect(form).toBeVisible();
  await form.getByLabel('Code name').fill(name);
  await form.locator(`[data-color="${color}"]`).click();
  await form.getByRole('button', { name: 'Join the mission' }).click();
  await expect.poll(() => lastPrivate(a.frames)?.you.id ?? '').not.toBe('');
  a.id = lastPrivate(a.frames)!.you.id;
  return a;
}

/** The phone dies: the context closes. Returns its stored token so the same phone can come back. */
export async function closeAgent(a: Agent): Promise<string> {
  const code = lastState(a.frames).code;
  const raw = await a.page.evaluate((c) => localStorage.getItem(`sketchy:token:${c}`), code);
  const token = (JSON.parse(raw!) as { token: string }).token;
  await a.ctx.close();
  a.open = false;
  return token;
}

/** The same phone comes back: a new context with the stored token opens the room and rejoins by token. */
export async function reopenAgent(browser: Browser, a: Agent, token: string): Promise<void> {
  const code = lastState(a.frames).code;
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(15_000);
  await ctx.addInitScript(
    ({ code, token }) => {
      localStorage.setItem(`sketchy:token:${code}`, JSON.stringify({ token, at: Date.now() }));
    },
    { code, token },
  );
  const page = await ctx.newPage();
  sharedRecorder(page, a.frames);
  a.ctx = ctx;
  a.page = page;
  a.open = true;
  await page.goto(`/join/${code}`);
}

/**
 * The roles of the first round numbered above `after`, from each open seated
 * context's own `private` frames (never from `state`).
 */
export async function roles(agents: readonly Agent[], after = 0): Promise<{ no: number; faker: Agent | null; word: string; seated: Agent[] }> {
  const open = agents.filter((a) => a.open);
  let no = 0;
  await expect
    .poll(
      () => {
        no = lastState(open[0]!.frames).round?.no ?? 0;
        const roster = lastState(open[0]!.frames).round?.roster ?? [];
        const seated = open.filter((a) => roster.includes(a.id));
        return no > after && seated.length > 0 && seated.every((a) => lastPrivate(a.frames)?.round?.no === no);
      },
      { timeout: 40_000 },
    )
    .toBe(true);
  const roster = lastState(open[0]!.frames).round!.roster;
  const seated = open.filter((a) => roster.includes(a.id));
  const faker = seated.find((a) => lastPrivate(a.frames)!.round!.role === 'faker') ?? null;
  const word = lastPrivate(seated.find((a) => a !== faker)!.frames)!.round!.word!;
  return { no, faker, word, seated };
}

export async function drag(page: Page): Promise<void> {
  const box = (await page.getByTestId('draw-canvas').boundingBox())!;
  await page.mouse.move(box.x + 0.2 * box.width, box.y + 0.3 * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + 0.8 * box.width, box.y + 0.7 * box.height, { steps: 8 });
  await page.mouse.up();
}

/** Press and hold an envelope (the briefing's, or the draw screen's mini one); returns the letter's line, then lets go. */
export async function peek(page: Page, testId: 'envelope' | 'envelope-mini' = 'envelope-mini'): Promise<string> {
  const box = (await page.getByTestId(testId).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const line = page.getByTestId('envelope-line');
  await expect(line).toBeVisible();
  const text = (await line.textContent())!;
  await page.mouse.up();
  await expect(page.getByTestId('envelope-letter')).toHaveCount(0);
  return text;
}

/**
 * Play the current round from the draw to its results: every open seated
 * agent draws and files, each votes for the faker (the faker for the first
 * other agent) and locks, nobody guesses. The host (if open) skips the
 * briefing; the results are left on screen.
 */
export async function playRound(agents: readonly Agent[], hostId: string | null, after = 0): Promise<{ no: number; faker: Agent | null; word: string; seated: Agent[] }> {
  const r = await roles(agents, after);
  const players = r.seated;
  const host = agents.find((a) => a.open && a.id === hostId);
  if (host) {
    const cont = host.page.getByTestId('host-continue');
    if (await cont.isVisible().catch(() => false)) await cont.click().catch(() => {});
  }
  for (const p of players) {
    await expect(p.page.getByTestId('draw')).toBeVisible({ timeout: 30_000 });
    await drag(p.page);
    await p.page.getByTestId('draw-done').click();
  }
  for (const p of players) await expect(p.page.getByTestId('evidence')).toBeVisible({ timeout: 30_000 });
  for (const p of players) {
    const target = p === r.faker ? players.find((q) => q !== p)! : r.faker!;
    await p.page.locator(`[data-testid="suspect"][data-target="${target.id}"] [data-testid="suspect-vote"]`).click();
    await p.page.getByTestId('lock-in').click();
  }
  for (const p of players) await expect(p.page.getByTestId('results')).toBeVisible({ timeout: 40_000 });
  return r;
}

/**
 * The recorded-frame secrecy check over every round seen: a non-faker's
 * `private` carries the word and the agent role, only the faker's carries
 * the faker role; `round.faker` is null in `state` until unmask; and no
 * string value the faker received carries the word before the state that
 * resolves the round (the room `code` excepted).
 */
export function assertFramesSecret(agents: readonly Agent[]): void {
  const truth = new Map<number, { word: string | null; faker: string | null }>();
  for (const a of agents) {
    for (const v of privates(a.frames)) {
      if (!v.round) continue;
      const t = truth.get(v.round.no) ?? { word: null, faker: null };
      if (v.round.role === 'faker') {
        expect(v.round.word, 'a faker view never carries a word').toBeUndefined();
        expect(t.faker === null || t.faker === v.you.id, `round ${v.round.no} has one faker`).toBe(true);
        t.faker = v.you.id;
      } else {
        expect(t.word === null || t.word === v.round.word).toBe(true);
        t.word = v.round.word ?? null;
      }
      truth.set(v.round.no, t);
    }
  }
  for (const a of agents) {
    // Who this context was when each frame arrived: rejoins keep the id.
    for (const s of states(a.frames)) {
      if (!s.round) continue;
      const before = ['dealing', 'briefing', 'draw', 'slideshow', 'browse', 'scrubbed'].includes(s.phase.name);
      if (before) expect(s.round.faker, `round ${s.round.no} faker hidden in ${s.phase.name}`).toBeNull();
      const t = truth.get(s.round.no);
      if (t?.word && !s.round.result) {
        const leak = stringValues(s).filter((x) => x.key !== 'code' && hasWord(x.value, t.word!));
        expect(leak, `state for round ${s.round.no} carries the word`).toEqual([]);
      }
    }
    for (const [no, t] of truth) {
      if (t.faker !== a.id || !t.word) continue;
      let resolved = false;
      for (const m of a.frames.received) {
        if (m.type === 'state') {
          const s = (m as unknown as { state: State }).state;
          if (s.round && s.round.no > no) break;
          if (s.round?.no === no && s.round.result) resolved = true;
        }
        if (resolved) break;
        const leak = stringValues(m).filter((x) => x.key !== 'code' && hasWord(x.value, t.word!));
        expect(leak, `the faker of round ${no} received the word`).toEqual([]);
      }
    }
  }
}

/**
 * No DOM string outside a held envelope shows the faker line; one that is
 * just the word fails, and one holding it passes only as a whole literal
 * of the client source (the deck has words like "envelope").
 */
export async function assertDomSecret(pages: readonly Page[], word: string): Promise<void> {
  for (const page of pages) {
    await expect(page.getByTestId('envelope-letter')).toHaveCount(0);
    for (const s of await domStrings(page)) {
      expect(s.includes(FAKER_LINE), `DOM shows the faker line: ${s}`).toBe(false);
      expect(isBareWord(s, word), `DOM shows the word: ${s}`).toBe(false);
      if (hasWord(s, word)) expect(isWholeLiteral(s), `DOM string holds the word: ${s}`).toBe(true);
    }
  }
}

export async function closeAll(agents: readonly Agent[]): Promise<void> {
  await Promise.all(agents.map((a) => a.ctx.close().catch(() => {})));
}

/** The host taps Continue on the briefing if it is still up (it also continues by itself after BRIEFING_BEAT_MS). */
export async function skipBriefing(host: Agent): Promise<void> {
  await host.page.getByTestId('host-continue').click({ timeout: 3_000 }).catch(() => {});
}

/** The Playwright Pixel 7 viewport the leg runs at. */
export const PIXEL_7 = { width: 412, height: 839 };
/** Small portrait phones, a short landscape phone and a landscape phone with a notch's worth of width. */
export const SIZES = [
  [320, 568],
  [360, 640],
  [568, 320],
  [740, 360],
] as const;

/**
 * What is wrong with the layout of `root` at the current viewport: the box
 * wider than or outside the viewport, any two `boxes` overlapping, a chip
 * name squeezed to nothing, or a chip's parts spilling out of the chip.
 */
export async function layoutProblems(page: Page, root: string, boxes: string): Promise<string[]> {
  await page.waitForTimeout(150);
  return page.evaluate(
    ({ root, boxes }) => {
      const out: string[] = [];
      const el = document.querySelector(root);
      if (!el) return [`no ${root}`];
      const r = el.getBoundingClientRect();
      if (r.left < -0.5 || r.right > innerWidth + 0.5) out.push(`${root} spans ${r.left}–${r.right} of ${innerWidth}`);
      const list = Array.from(document.querySelectorAll(boxes)).filter((b) => b.getBoundingClientRect().width > 0);
      // Guard against a selector that matches nothing, which would pass vacuously.
      if (list.length < 3) out.push(`only ${list.length} boxes match ${boxes}`);
      if (el.querySelectorAll('.chip').length === 0) out.push(`no chips in ${root}`);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!.getBoundingClientRect();
          const b = list[j]!.getBoundingClientRect();
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w > 1 && h > 1) out.push(`overlap: ${list[i]!.className || list[i]!.tagName} / ${list[j]!.className || list[j]!.tagName}`);
        }
      }
      for (const chip of Array.from(el.querySelectorAll('.chip'))) {
        const c = chip.getBoundingClientRect();
        const name = chip.querySelector('.chip-name') as HTMLElement | null;
        if (name && name.clientWidth === 0) out.push(`chip name squeezed: ${name.textContent}`);
        for (const part of Array.from(chip.querySelectorAll('.chip-name, .chip-tags, .chip-actions'))) {
          const p = part.getBoundingClientRect();
          if (p.width > 0 && (p.left < c.left - 1 || p.right > c.right + 1 || p.top < c.top - 1 || p.bottom > c.bottom + 1)) {
            out.push(`spills out of its chip: ${part.className} "${part.textContent}"`);
          }
        }
      }
      return out;
    },
    { root, boxes },
  );
}
