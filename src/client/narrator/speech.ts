/**
 * The browser's `speechSynthesis`, made dependable on phones (stage
 * 12.1.3, `SPEC.md` §10). Everything degrades to silence: no engine, a
 * blocked engine or a missing voice never throws and never blocks play.
 *
 * - iOS speaks only after speech has started once inside a user
 *   activation. Activation comes from `touchend`, `click` and `keydown`
 *   (not `pointerdown`, which a touch does not activate on), so each of
 *   those speaks a silent utterance until one is seen to start or end;
 *   only then is the page primed. Create a room, Join, or any tap does it.
 * - Voices load asynchronously (`voiceschanged`); a line waits up to
 *   `VOICE_WAIT_MS` for them, then speaks with the engine's default, and
 *   later lines stop waiting until voices actually arrive.
 * - An installed iOS PWA can go silent after the phone sleeps: when the
 *   page becomes visible again the queue is cleared and the next tap
 *   primes it again.
 */

import { chooseVoice } from './settings';

/** Speaking rate: a touch quicker than default, for snappy briefings. */
export const SPEECH_RATE = 1.05;
const VOICE_WAIT_MS = 750;
/** Chrome can drop a `speak` made in the same task as a `cancel`. */
const AFTER_CANCEL_MS = 60;
/** The events that carry user activation, touch included. */
const ACTIVATIONS = ['touchend', 'click', 'keydown'] as const;

export interface SayHooks {
  /** The engine was handed the line (after any wait for voices). */
  readonly onStart: (id: number) => void;
  /** It ended, failed or was cut off; may never come, so callers keep their own timeout. */
  readonly onEnd: (id: number) => void;
}

class Speech {
  private readonly synth: SpeechSynthesis | null;
  private voice: SpeechSynthesisVoice | null = null;
  /** Speech has been seen to start or end since the page last became visible. */
  private primed = false;
  /** A wait for voices timed out with none: don't wait again until `voiceschanged`. */
  private noVoices = false;
  private nextId = 1;
  /** The newest `say`: an older one still waiting for voices is dropped. */
  private latest = 0;

  constructor() {
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined' ? window.speechSynthesis : null;
    if (!this.synth) return;
    this.loadVoice();
    try {
      this.synth.addEventListener('voiceschanged', () => this.loadVoice());
    } catch {
      // An engine without events: the voice found now (or the default) it is.
    }
    const prime = () => this.prime();
    for (const type of ACTIVATIONS) document.addEventListener(type, prime, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      // After sleep the engine may be stuck mid-queue or need a fresh gesture.
      this.primed = false;
      try {
        this.synth?.cancel();
      } catch {
        /* nothing to clear */
      }
    });
  }

  get supported(): boolean {
    return this.synth !== null;
  }

  private loadVoice(): void {
    try {
      const voices = this.synth?.getVoices() ?? [];
      this.voice = chooseVoice(voices);
      if (voices.length > 0) this.noVoices = false;
    } catch {
      this.voice = null;
    }
  }

  private markPrimed = (): void => {
    this.primed = true;
  };

  /** Inside a user activation: unlock speech with a silent utterance (iOS). Repeats on each activation until one plays. */
  prime(): void {
    const synth = this.synth;
    if (!synth || this.primed) return;
    try {
      synth.resume();
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.onstart = this.markPrimed;
      u.onend = this.markPrimed;
      synth.speak(u);
    } catch {
      /* stays silent; the next activation tries again */
    }
  }

  /** Speak `text`, cutting off anything still talking, so stale lines never pile up behind a new screen. Returns its id. */
  say(text: string, hooks: SayHooks): number | null {
    const synth = this.synth;
    if (!synth) return null;
    const id = this.nextId++;
    this.latest = id;
    let busy = false;
    try {
      busy = synth.speaking || synth.pending;
      if (busy) synth.cancel();
    } catch {
      busy = false;
    }
    const go = () => {
      if (this.latest !== id) return;
      try {
        const u = new SpeechSynthesisUtterance(text);
        if (this.voice) u.voice = this.voice;
        u.lang = this.voice?.lang ?? 'en-US';
        u.rate = SPEECH_RATE;
        const done = () => hooks.onEnd(id);
        u.onstart = this.markPrimed;
        u.onend = () => {
          this.primed = true;
          done();
        };
        u.onerror = done;
        hooks.onStart(id);
        synth.speak(u);
      } catch {
        hooks.onEnd(id);
      }
    };
    this.whenVoices(() => (busy ? window.setTimeout(go, AFTER_CANCEL_MS) : go()));
    return id;
  }

  /** Stop talking now. */
  cancel(): void {
    this.latest = 0;
    try {
      this.synth?.cancel();
    } catch {
      /* already quiet */
    }
  }

  private whenVoices(fn: () => void): void {
    const synth = this.synth;
    let ready = false;
    try {
      ready = this.noVoices || this.voice !== null || (synth?.getVoices().length ?? 0) > 0;
    } catch {
      ready = true;
    }
    if (ready || !synth) return fn();
    let fired = false;
    const finish = (timedOut: boolean) => {
      if (fired) return;
      fired = true;
      window.clearTimeout(timer);
      try {
        synth.removeEventListener('voiceschanged', onVoices);
      } catch {
        /* never added */
      }
      this.loadVoice();
      if (timedOut && this.voice === null) this.noVoices = true;
      fn();
    };
    const onVoices = () => finish(false);
    const timer = window.setTimeout(() => finish(true), VOICE_WAIT_MS);
    try {
      synth.addEventListener('voiceschanged', onVoices);
    } catch {
      /* the timeout covers it */
    }
  }
}

let instance: Speech | null = null;

/** The page's one speech engine, created on first use (never during server-side or unit runs). */
export function speech(): Speech {
  instance ??= new Speech();
  return instance;
}
