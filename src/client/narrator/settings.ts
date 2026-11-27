/**
 * The narrator's per-device choices (stages 12.1.2–12.1.3, `SPEC.md` §3,
 * §10): whether it is on, and which voice it uses. Pure, so the unit leg
 * pins them; speech.ts wires them to the browser.
 */

import type { KeyValueStorage } from '../net/token-store';

export const NARRATOR_KEY = 'sketchy:narrator';

/**
 * On by default for the host, off for everyone else (§3, §10), until this
 * device picks: an explicit choice is kept in `localStorage` and wins in
 * every room. Storage that throws (private modes) means the default.
 */
export function narratorOn(storage: KeyValueStorage | null, isHost: boolean): boolean {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(NARRATOR_KEY) ?? null;
  } catch {
    stored = null;
  }
  if (stored === 'on') return true;
  if (stored === 'off') return false;
  return isHost;
}

export function setNarratorOn(storage: KeyValueStorage | null, on: boolean): void {
  try {
    storage?.setItem(NARRATOR_KEY, on ? 'on' : 'off');
  } catch {
    // Not kept: the toggle still works for this page's life.
  }
}

/** The part of `SpeechSynthesisVoice` the choice reads. */
export interface VoiceLike {
  readonly name: string;
  readonly lang: string;
  readonly localService: boolean;
  readonly default: boolean;
}

/** Voices known to sound natural, best first: iOS/macOS, Android/Chrome, Windows/Edge. */
const PREFERRED = [/\b(premium|enhanced)\b/i, /^Samantha\b/i, /^Google US English$/i, /\b(Aria|Jenny|Guy)\b.*Natural/i, /^Daniel\b/i, /^Karen\b/i, /^Google UK English/i];
/** Novelty voices on Apple platforms that would turn the briefing into a joke. */
const NOVELTY = /\b(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Ralph|Fred|Kathy)\b/i;

/**
 * A clear English voice: a known good one, then the device's default if it
 * is English, then on-device US English, then any English, then null (the
 * engine's own default). On-device voices are preferred because network
 * voices can stall offline.
 */
export function chooseVoice<V extends VoiceLike>(voices: readonly V[]): V | null {
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang) && !NOVELTY.test(v.name));
  for (const re of PREFERRED) {
    const hit = english.find((v) => re.test(v.name));
    if (hit) return hit;
  }
  return (
    english.find((v) => v.default) ??
    english.find((v) => v.localService && /^en[-_]US$/i.test(v.lang)) ??
    english.find((v) => /^en[-_]US$/i.test(v.lang)) ??
    english[0] ??
    null
  );
}
