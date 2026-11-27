import type { BrowserContext, Page } from '@playwright/test';
import type { Frames } from './round-helpers';

/**
 * Helpers for the phase-12 E2E (narrator.spec.ts, rules.spec.ts): a fake
 * `speechSynthesis` installed by an init script, which records every line
 * and ends each after `SPOKEN_MS`, or never while `stall` is set; and the
 * frames a test cares about.
 */

export const SPOKEN_MS = 400;

export interface Spoken {
  readonly text: string;
  readonly volume: number;
  readonly at: number;
}

/**
 * Install the fake engine in every page of `ctx`. Headless Chromium's own
 * engine may have no voices and never end a line. The fake behaves like the
 * awkward phones:
 * - **iOS unlock:** until one `speak` happens inside a user activation
 *   (`navigator.userActivation.isActive`), every line is silently dropped
 *   (recorded in `blocked`, no events), as iOS Safari does.
 * - **Late voices:** `getVoices()` is empty until `VOICES_AFTER_MS`, then
 *   `voiceschanged` fires.
 * - **Async errors:** `cancel()` reports the cut-off line's `onerror` on a
 *   later task, as Chrome and Safari do.
 * - Lines (the silent primer included) fire `onstart`, then `onend` after
 *   `SPOKEN_MS` (the primer at once), or never while `stall` is set.
 */
export const VOICES_AFTER_MS = 300;

export async function stubSpeech(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript(
    ({ spokenMs, voicesAfterMs }: { spokenMs: number; voicesAfterMs: number }) => {
      type U = {
        text: string;
        volume: number;
        rate: number;
        lang: string;
        voice: unknown;
        onstart: ((e: unknown) => void) | null;
        onend: ((e: unknown) => void) | null;
        onerror: ((e: unknown) => void) | null;
      };
      const log = { spoken: [] as { text: string; volume: number; at: number }[], blocked: [] as string[], stall: false, unlocked: false };
      (window as unknown as { __tts: typeof log }).__tts = log;
      class FakeUtterance implements U {
        volume = 1;
        rate = 1;
        lang = '';
        voice: unknown = null;
        onstart: U['onstart'] = null;
        onend: U['onend'] = null;
        onerror: U['onerror'] = null;
        constructor(public text: string) {}
      }
      let current: U | null = null;
      let voices: unknown[] = [];
      const synth = Object.assign(new EventTarget(), {
        get speaking() {
          return current !== null;
        },
        pending: false,
        paused: false,
        getVoices: () => voices,
        speak(u: U) {
          if (!log.unlocked) {
            if (!navigator.userActivation.isActive) {
              log.blocked.push(u.text);
              return;
            }
            log.unlocked = true;
          }
          log.spoken.push({ text: u.text, volume: u.volume, at: Date.now() });
          if (log.stall && u.volume > 0) return;
          current = u;
          setTimeout(() => {
            if (current === u) u.onstart?.({});
          }, 0);
          setTimeout(
            () => {
              if (current !== u) return;
              current = null;
              u.onend?.({});
            },
            u.volume === 0 ? 5 : spokenMs,
          );
        },
        cancel() {
          const u = current;
          current = null;
          if (u) setTimeout(() => u.onerror?.({ error: 'canceled' }), 0);
        },
        resume() {},
        pause() {},
      });
      setTimeout(() => {
        voices = [{ name: 'Samantha', lang: 'en-US', localService: true, default: true, voiceURI: 'samantha' }];
        synth.dispatchEvent(new Event('voiceschanged'));
      }, voicesAfterMs);
      Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true, writable: true });
    },
    { spokenMs: SPOKEN_MS, voicesAfterMs: VOICES_AFTER_MS },
  );
}

/** What the fake engine has seen on `page`: unlocked yet, and the lines dropped before that. */
export async function engineState(page: Page): Promise<{ unlocked: boolean; blocked: string[]; primers: number }> {
  return page.evaluate(() => {
    const t = (window as unknown as { __tts: { unlocked: boolean; blocked: string[]; spoken: Spoken[] } }).__tts;
    return { unlocked: t.unlocked, blocked: [...t.blocked], primers: t.spoken.filter((s) => s.volume === 0).length };
  });
}

/** The lines a page has spoken out loud (the silent priming utterance excluded). */
export async function spoken(page: Page): Promise<Spoken[]> {
  const all = await page.evaluate(() => (window as unknown as { __tts: { spoken: Spoken[] } }).__tts.spoken);
  return all.filter((s) => s.volume > 0);
}

/** From now on, lines on `page` never end by themselves (a stalled engine). */
export async function stallSpeech(page: Page, stall: boolean): Promise<void> {
  await page.evaluate((s) => {
    (window as unknown as { __tts: { stall: boolean } }).__tts.stall = s;
  }, stall);
}

/** `host:narration` frames a context sent, in order. */
export function narrationFrames(f: Frames): boolean[] {
  return f.sent.filter((m) => m.type === 'host:narration').map((m) => m.speaking as boolean);
}

/** Every frame a context sent except clock pings: the game intents. */
export function intents(f: Frames): Record<string, unknown>[] {
  return f.sent.filter((m) => m.type !== 'ping');
}
