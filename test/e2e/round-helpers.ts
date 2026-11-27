import { expect, type Page } from '@playwright/test';
import { PLAYER_COLORS, SPY_ICONS } from '../../src/shared/core/rules';
import { isWholeLiteral } from './secrecy-helpers';

/**
 * Helpers for the phase-8 round E2E (round.spec.ts): lobby setup, a
 * per-page WebSocket frame recorder, the DOM text scan used by the secrecy
 * checks, and optional screenshots.
 */

export async function createRoom(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a room' }).click();
  await expect(page).toHaveURL(/\/join\/[A-Z]{4}$/);
  return page.url().split('/').at(-1)!;
}

export async function join(page: Page, name: string, color: string): Promise<void> {
  const form = page.getByTestId('join-form');
  await expect(form).toBeVisible();
  await form.getByLabel('Code name').fill(name);
  await form.locator(`[data-color="${color}"]`).click();
  await form.getByRole('button', { name: 'Join the mission' }).click();
  await expect(page.getByTestId('lobby')).toBeVisible();
}

/** Every JSON frame a page's WebSockets sent and received, in order. Attach before the page navigates. */
export interface Frames {
  readonly received: Record<string, unknown>[];
  readonly sent: Record<string, unknown>[];
}

export function recordFrames(page: Page): Frames {
  const frames: Frames = { received: [], sent: [] };
  const parse = (payload: string | Buffer) => {
    if (typeof payload !== 'string') throw new Error('binary frame');
    return JSON.parse(payload) as Record<string, unknown>;
  };
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => frames.received.push(parse(f.payload)));
    ws.on('framesent', (f) => frames.sent.push(parse(f.payload)));
  });
  return frames;
}

/** Every string value in a JSON value with its key, depth first. Keys themselves are not values. */
export function stringValues(v: unknown, key = ''): { key: string; value: string }[] {
  if (typeof v === 'string') return [{ key, value: v }];
  if (Array.isArray(v)) return v.flatMap((x) => stringValues(x, key));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => stringValues(x, k));
  return [];
}

/** True when `text` contains `word` as a whole word, ignoring case (so "cat" is not found in "category"). */
export function hasWord(text: string, word: string): boolean {
  const esc = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(text.toLowerCase());
}

/**
 * Attributes whose values a player can see or hear: the text a screen
 * reader announces or a tooltip, placeholder or image shows. `domStrings`
 * reads only these; enumerated markup like `aria-live="polite"`, `role`,
 * `class` or `data-*` is not shown to anyone, and a deck word ("polite")
 * can equal it by chance (O-21, resolved).
 */
export const SHOWN_ATTRIBUTES = ['aria-label', 'aria-description', 'aria-valuetext', 'aria-roledescription', 'aria-placeholder', 'title', 'alt', 'placeholder'] as const;

/** Every text node, form value and shown attribute (`SHOWN_ATTRIBUTES`) in the page's DOM. */
export async function domStrings(page: Page): Promise<string[]> {
  return page.evaluate((shown) => {
    const out: string[] = [];
    const walk = (n: Node) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = n.textContent?.trim();
        if (t) out.push(t);
        return;
      }
      if (!(n instanceof Element)) return;
      for (const name of shown) {
        const v = n.getAttribute(name);
        if (v?.trim()) out.push(v);
      }
      if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) out.push(n.value);
      for (const c of Array.from(n.childNodes)) walk(c);
    };
    walk(document.documentElement);
    return out;
  }, SHOWN_ATTRIBUTES as readonly string[]);
}

/**
 * Attributes whose values are fixed keywords of HTML or ARIA, so they can
 * never carry game data, whatever the word happens to be.
 */
const KEYWORD_ATTRIBUTES = new Set(['aria-live', 'aria-atomic', 'aria-relevant', 'aria-busy', 'aria-hidden', 'aria-modal', 'aria-pressed', 'aria-expanded', 'aria-haspopup', 'aria-current', 'aria-checked', 'aria-selected', 'aria-disabled', 'aria-orientation', 'role', 'type', 'inputmode', 'autocomplete', 'autocapitalize', 'autocorrect', 'enterkeyhint', 'dir', 'lang', 'spellcheck', 'draggable', 'translate', 'loading', 'decoding', 'rel', 'method', 'scope']);

/** Player color and icon ids, which appear in markup (`data-color`, CSS variables) whatever the word. */
const MARKUP_IDS = new RegExp(`(^|[^a-z0-9])(${[...PLAYER_COLORS, ...SPY_ICONS].join('|')})(?=$|[^a-z0-9])`, 'g');

/**
 * The strict check for the faker's own page, which never knew the word:
 * no text, form value or attribute — `data-*`, `class`, `id`, `style` and
 * hidden ones included — holds it, except HTML/ARIA keyword attributes.
 */
export async function assertFakerDomClean(page: Page, word: string): Promise<void> {
  const found = await page.evaluate((keywords) => {
    const skip = new Set(keywords);
    const out: { attr: boolean; value: string }[] = [];
    const walk = (n: Node) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = n.textContent?.trim();
        if (t) out.push({ attr: false, value: t });
        return;
      }
      if (!(n instanceof Element)) return;
      for (const a of Array.from(n.attributes)) if (!skip.has(a.name) && a.value.trim()) out.push({ attr: true, value: a.value });
      if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) out.push({ attr: false, value: n.value });
      for (const c of Array.from(n.childNodes)) walk(c);
    };
    walk(document.documentElement);
    return out;
  }, [...KEYWORD_ATTRIBUTES]);
  const leaks = found
    .filter(({ attr, value }) => {
      if (!attr) return hasWord(value, word) && !isWholeLiteral(value);
      // Each token may be interface markup (a class or test id in the client source) or a player's color or
      // icon id ("sunglasses" is also a deck word); what is left must not hold the word.
      const rest = value
        .split(/\s+/)
        .filter((t) => !isWholeLiteral(t))
        .join(' ')
        .replace(MARKUP_IDS, ' ');
      return hasWord(rest, word);
    })
    .map((x) => x.value);
  expect(leaks, `the faker's page holds the word "${word}"`).toEqual([]);
}

/** Screenshots for the owner, only when `SKETCHY_SHOTS` names a directory. */
export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.SKETCHY_SHOTS;
  if (!dir) return;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${dir}/${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

/**
 * The markup of the element `testId`, with what may differ between players
 * whatever their role taken out: their names, digits (countdowns, ids,
 * counts), and the host-only footer. Two players' results must be equal
 * whether either is the faker.
 */
export async function roleBlindMarkup(page: Page, testId: string, names: readonly string[]): Promise<string> {
  const html = await page.getByTestId(testId).evaluate((el) => {
    const copy = el.cloneNode(true) as Element;
    for (const f of Array.from(copy.querySelectorAll('[data-testid="briefing-footer"]'))) f.remove();
    return copy.outerHTML;
  });
  let out = html.replace(/\d+/g, '0');
  for (const n of names) out = out.split(n).join('NAME');
  return out;
}
