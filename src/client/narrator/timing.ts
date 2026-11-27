/**
 * The host's "narrator speaking" signal (stage 12.1.4, decision 0004 rule
 * 2): `host:narration {speaking}` around each line, so the server's 0004
 * Continue fill waits for the narrator. Pure (timers injected), so the unit
 * leg pins it.
 *
 * A stalled utterance must never stall the room. Speech engines sometimes
 * never fire `end` (iOS after sleep, a cancelled queue), so each line gets
 * a client timeout from `speechBudgetMs`, after which it counts as stopped;
 * the server's own `NARRATION_CAP_MS` cap backs that up if even the "stop"
 * frame is lost.
 */

import { NARRATION_CAP_MS } from '../../shared/core/rules';

/** Words per second at rate 1: typical synthesized English runs about 2.5–3. */
const WORDS_PER_SECOND = 2.5;
/** The engine's pause at each sentence or clause mark. */
const PAUSE_MS = 250;
/** Startup latency and voice differences. */
export const SPEECH_MARGIN_MS = 1_500;

/**
 * How long a line may take before it counts as stopped:
 * `words / (WORDS_PER_SECOND × rate) + marks × PAUSE_MS + SPEECH_MARGIN_MS`,
 * never above the server's cap.
 */
export function speechBudgetMs(text: string, rate = 1): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  const marks = (text.match(/[.,!?;:…—]/g) ?? []).length;
  const ms = (words / (WORDS_PER_SECOND * rate)) * 1000 + marks * PAUSE_MS + SPEECH_MARGIN_MS;
  return Math.min(NARRATION_CAP_MS, Math.ceil(ms));
}

export interface SignalDeps {
  /** True when this device may send the signal now: it is the host, in a phase where the room listens. */
  readonly canSend: () => boolean;
  readonly send: (speaking: boolean) => void;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

/**
 * Tracks the newest utterance. `begin` sends `speaking: true` (when allowed);
 * the stop is sent once that utterance ends, errors, is cancelled or runs past
 * its budget, whichever is first, and only if this device sent the start.
 * An older utterance ending (cut off by a newer one) is ignored; its open
 * start is closed with a stop just before the newer line's start.
 */
export class SpeakingSignal {
  private current: number | null = null;
  private sentStart = false;
  private timer: unknown = null;

  constructor(private readonly deps: SignalDeps) {}

  begin(id: number, budgetMs: number): void {
    this.clear();
    // A start still open from a line this one cut off is closed first, so starts and stops always pair.
    if (this.sentStart) {
      this.sentStart = false;
      this.deps.send(false);
    }
    this.current = id;
    if (this.deps.canSend()) {
      this.sentStart = true;
      this.deps.send(true);
    }
    this.timer = this.deps.setTimer(() => this.end(id), budgetMs);
  }

  end(id: number): void {
    if (this.current !== id) return;
    this.current = null;
    this.clear();
    if (this.sentStart) {
      this.sentStart = false;
      this.deps.send(false);
    }
  }

  /** Whatever is speaking counts as stopped (narrator turned off, screen left). */
  stop(): void {
    if (this.current !== null) this.end(this.current);
  }

  get speaking(): boolean {
    return this.current !== null;
  }

  private clear(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }
}
