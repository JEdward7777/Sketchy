/**
 * Final-results placement (stage 2.8, decision 0007 item 4): standard
 * competition ranking. Tied players share a place and the next place skips
 * by the number tied (1, 1, 3), so nobody is placed below someone they tied.
 */

import type { PlayerId } from './scoring';

export interface Standing {
  readonly id: PlayerId;
  readonly score: number;
}

export interface Placed extends Standing {
  /** 1-based; equal scores share a place. */
  readonly place: number;
}

/**
 * Highest score first. Equal scores keep their input order (the sort is
 * stable), so the caller decides the display order within a tie.
 */
export function placements(standings: readonly Standing[]): Placed[] {
  const sorted = standings.slice().sort((a, b) => b.score - a.score);
  const out: Placed[] = [];
  sorted.forEach((s, i) => {
    const prev = out[i - 1];
    const place = prev !== undefined && prev.score === s.score ? prev.place : i + 1;
    out.push({ ...s, place });
  });
  return out;
}
