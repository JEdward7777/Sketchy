/**
 * The slideshow's current slide as React state (stage 9.2): recomputed
 * from `slideView` at each slide boundary by a timer aimed at it, plus a
 * slow safety tick that picks up a new clock offset. Nothing arrives from
 * the room per slide (harness/AGENTS.md §5).
 */

import { useEffect, useState } from 'react';
import type { ClockOffset } from '../../shared/clock-offset';
import { serverClock, type Paused } from './countdown';
import { slideView, type SlideView, type SlideshowTiming } from './evidence-model';

/** Lands just past the boundary, so the recomputed slide is the new one. */
const BOUNDARY_SLACK_MS = 15;
const SAFETY_TICK_MS = 1_000;

export function useSlide(timing: SlideshowTiming, cards: number, clock: ClockOffset | null, paused: Paused | null): SlideView {
  const [tick, setTick] = useState(0);
  const view = slideView(timing, cards, serverClock(Date.now(), clock), paused);
  const wait = Math.min(SAFETY_TICK_MS, Math.max(0, view.untilNext) + BOUNDARY_SLACK_MS);
  useEffect(() => {
    const id = window.setTimeout(() => setTick((n) => n + 1), wait);
    return () => window.clearTimeout(id);
  }, [tick, wait, view.slide]);
  return view;
}
