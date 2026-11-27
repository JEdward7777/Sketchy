/**
 * The narrator in the room (stage 12.1, `SPEC.md` §10): speaks a line from
 * picker.ts on each phase change, and the draw's "ten seconds", while this
 * device's toggle is on; the host's device also sends the 0004 "speaking"
 * signal (timing.ts). It never blocks play: nothing waits on speech except
 * the server's Continue fill, which a client timeout and the server's cap
 * both bound.
 *
 * Reads `PublicState` only: the line is the same on the faker's phone.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ClockOffset } from '../../shared/clock-offset';
import type { PublicState } from '../../shared/core/views';
import { serverClock } from '../game/countdown';
import type { RoomConnection } from '../net/connection';
import { browserStorage } from '../net/token-store';
import { baseline, drawLastAt, lineFor, narrate, PhrasePicker, type NarrationEvent } from './picker';
import { narratorOn, setNarratorOn } from './settings';
import { speech, SPEECH_RATE } from './speech';
import { SpeakingSignal, speechBudgetMs } from './timing';

const listeners = new Set<() => void>();
/** The mounted room's narrator, so the toggle can speak its confirmation inside the tap. */
let activeSay: ((event: NarrationEvent) => void) | null = null;

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** This device's narrator setting (§3: on by default for the host only). */
export function useNarratorOn(isHost: boolean): boolean {
  return useSyncExternalStore(subscribe, () => narratorOn(browserStorage(), isHost));
}

/** The toggle: remembered on this device; turning it on says so (and is the gesture that unlocks iOS speech). */
export function setNarrator(on: boolean): void {
  setNarratorOn(browserStorage(), on);
  for (const fn of listeners) fn();
  if (on) activeSay?.('toggleOn');
}

export function narratorSupported(): boolean {
  return speech().supported;
}

export function useNarrator(state: PublicState | null, you: string | null, clock: ClockOffset | null, conn: RoomConnection): void {
  const isHost = state !== null && you !== null && state.hostId === you;
  const on = useNarratorOn(isHost);
  const live = useRef({ state, isHost });
  live.current = { state, isHost };
  const picker = useMemo(() => new PhrasePicker(Math.random), []);

  const signal = useMemo(
    () =>
      new SpeakingSignal({
        // Only the host, and only where the room listens (briefing and round results, unpaused): no frames elsewhere.
        canSend: () => {
          const { state: s, isHost: host } = live.current;
          return host && s !== null && s.paused === null && (s.phase.name === 'briefing' || s.phase.name === 'results');
        },
        send: (speaking) => void conn.send({ type: 'host:narration', speaking }),
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (h) => window.clearTimeout(h as number),
      }),
    [conn],
  );

  const speak = useCallback(
    (line: string | null) => {
      if (!line) return;
      speech().say(line, {
        onStart: (id) => signal.begin(id, speechBudgetMs(line, SPEECH_RATE)),
        onEnd: (id) => signal.end(id),
      });
    },
    [signal],
  );

  // Phase changes. The first state this device sees says nothing (a join or reload mid-game).
  const prev = useRef<PublicState | null>(null);
  useEffect(() => {
    if (!state) return;
    const before = prev.current;
    prev.current = baseline(before, state);
    if (on && you !== null) speak(narrate(before, state, picker));
  }, [state, on, you, speak, picker]);

  // Reconcile (0004 rule 2): the room thinks this host's narrator is speaking, but this page is not (a reload,
  // a reconnect, a resume, a stop frame lost). Say it stopped, so the fill never waits out the server cap for nothing.
  const phase = state?.phase;
  const staleSpeaking =
    isHost && state !== null && state.paused === null && (phase?.name === 'briefing' || phase?.name === 'results') && phase.hostSpeaking;
  useEffect(() => {
    if (staleSpeaking && !signal.speaking) conn.send({ type: 'host:narration', speaking: false });
  }, [staleSpeaking, state, signal, conn]);

  // "Ten seconds": timed from the draw's public deadline, re-armed after a pause.
  const drawAt = state && you !== null && on ? drawLastAt(state) : null;
  useEffect(() => {
    if (drawAt === null) return;
    const delay = drawAt - serverClock(Date.now(), clock);
    if (delay <= 0) return;
    const t = window.setTimeout(() => {
      const s = live.current.state;
      if (s && drawLastAt(s) === drawAt) speak(lineFor('drawLast', s, picker));
    }, delay);
    return () => window.clearTimeout(t);
  }, [drawAt, clock, speak, picker]);

  // Registered whether on or off: the toggle's "narrator online" is spoken inside the tap that turns it on.
  useEffect(() => {
    const say = (event: NarrationEvent) => {
      const s = live.current.state;
      if (s) speak(lineFor(event, s, picker));
    };
    activeSay = say;
    return () => {
      if (activeSay === say) activeSay = null;
    };
  }, [speak, picker]);

  useEffect(() => {
    if (!on) return;
    return () => {
      // Turned off or the room left: quiet now, and the room hears that the narrator stopped.
      speech().cancel();
      signal.stop();
    };
  }, [on, signal]);
}
